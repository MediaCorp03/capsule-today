// Capsule Today — social publishing Edge Function
// Deploy: supabase functions deploy social-publish
// Set secrets (Project Settings → Edge Functions → Secrets, or `supabase secrets set`):
//   META_PAGE_ID         your Facebook Page ID
//   META_PAGE_TOKEN      long-lived Facebook Page access token (never goes to the browser)
//   META_IG_USER_ID      your Instagram Business account ID (optional, for IG)
//   META_IG_TOKEN        Instagram access token (optional — falls back to META_PAGE_TOKEN)
//
// The Studio calls this with the signed-in user's JWT, so only your newsroom can publish.
//
// Packaging differs by platform (matches Capsule Today's real posts):
//   Instagram → media + full body as the caption (p.igCaption), then #CapsuleToday.
//   Facebook  → media + short teaser (p.fbMessage, e.g. "More details in the comment section.")
//               then the full body auto-posted as the FIRST COMMENT (p.fbComment).

const GRAPH = "https://graph.facebook.com/v19.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function postForm(url: string, params: Record<string, string>) {
  const body = new URLSearchParams(params);
  const r = await fetch(url, { method: "POST", body });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, data };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let p: any = {};
  try { p = await req.json(); } catch (_) { return json({ error: "bad json" }, 400); }

  // Credentials: prefer values passed from the (authenticated) Studio, fall back to env secrets.
  const creds = p.creds || {};
  const PAGE_ID = (creds.pageId || Deno.env.get("META_PAGE_ID") || "").trim();
  const PAGE_TOKEN = (creds.pageToken || Deno.env.get("META_PAGE_TOKEN") || "").trim();
  const IG_USER_ID = (creds.igUserId || Deno.env.get("META_IG_USER_ID") || "").trim();
  // Instagram may use a DIFFERENT token than the Facebook Page. Fall back to the Page token.
  const IG_TOKEN = (creds.igToken || Deno.env.get("META_IG_TOKEN") || PAGE_TOKEN || "").trim();

  // ---- Verify (Test connection) ----
  if (p.action === "verify") {
    const verify: Record<string, unknown> = {};
    if (!PAGE_ID || !PAGE_TOKEN) return json({ ok: true, verify: { error: "Enter a Facebook Page ID and Page access token." } });
    try {
      const pr = await fetch(`${GRAPH}/${PAGE_ID}?fields=name&access_token=${encodeURIComponent(PAGE_TOKEN)}`);
      const pd = await pr.json().catch(() => ({}));
      if (!pr.ok || !pd.name) { verify.error = (pd.error && pd.error.message) || "Could not verify the Page — check the ID and token."; return json({ ok: true, verify }); }
      verify.page = { name: pd.name };
      if (IG_USER_ID) {
        const ir = await fetch(`${GRAPH}/${IG_USER_ID}?fields=username&access_token=${encodeURIComponent(IG_TOKEN)}`);
        const idd = await ir.json().catch(() => ({}));
        if (ir.ok && idd.username) verify.ig = { username: idd.username };
        else verify.igError = (idd.error && idd.error.message) || "IG could not be verified — check the IG account ID and Instagram token.";
      }
    } catch (_) { verify.error = "Could not reach the Graph API."; }
    return json({ ok: true, verify });
  }

  // ---- Delete a live post ----
  // Facebook posts can be deleted via the Graph API. Instagram does NOT expose media deletion,
  // so we report that back so the Studio can tell the editor to remove it in the IG app.
  if (p.action === "delete") {
    const platform = p.platform;
    const postId = (p.postId || "").toString();
    const result: Record<string, unknown> = {};
    if (platform === "fb") {
      if (!postId || !PAGE_TOKEN) { result.ok = false; result.error = "Missing post id or Page token."; return json({ ok: true, result }); }
      try {
        const r = await fetch(`${GRAPH}/${postId}?access_token=${encodeURIComponent(PAGE_TOKEN)}`, { method: "DELETE" });
        const d = await r.json().catch(() => ({}));
        result.ok = r.ok && (d.success !== false);
        if (!result.ok) result.error = (d.error && d.error.message) || "Facebook delete failed.";
      } catch (_) { result.ok = false; result.error = "Could not reach the Graph API."; }
    } else if (platform === "ig") {
      result.ok = false; result.error = "Instagram media cannot be deleted through the API — remove it in the Instagram app.";
    } else {
      result.ok = false; result.error = "Unknown platform.";
    }
    return json({ ok: true, result });
  }

  // Default caption builder (used if the Studio didn't send platform-specific copy).
  const defaultCaption = [p.title, p.dek, p.source ? `Source: ${p.source}` : "", "#CapsuleToday"]
    .filter(Boolean).join("\n\n");
  const igCaption: string = (p.igCaption || defaultCaption);
  const fbMessage: string = (p.fbMessage || defaultCaption);
  const fbComment: string = (p.fbComment || "");
  const imageUrl: string = p.imageUrl || "";
  const videoUrl: string = p.videoUrl || "";
  const isVideo = !!videoUrl;
  const wantFb = !!(p.channels && p.channels.fb);
  const wantIg = !!(p.channels && p.channels.ig);

  const result: Record<string, unknown> = {};

  // Poll an IG media container until it finishes processing (video/Reels are async).
  async function waitForContainer(id: string, token: string) {
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`${GRAPH}/${id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
      const d = await r.json().catch(() => ({}));
      const s = d.status_code;
      if (s === "FINISHED") return { ok: true };
      if (s === "ERROR" || s === "EXPIRED") return { ok: false, error: "IG processing " + s };
      await new Promise((res) => setTimeout(res, 3000));
    }
    return { ok: false, error: "IG processing timed out" };
  }

  // ---- Facebook Page ----
  if (wantFb) {
    if (!PAGE_ID || !PAGE_TOKEN) {
      result.facebook = { ok: false, error: "META_PAGE_ID / META_PAGE_TOKEN not set" };
    } else {
      let fb;
      if (isVideo) {
        fb = await postForm(`${GRAPH}/${PAGE_ID}/videos`, { file_url: videoUrl, description: fbMessage, access_token: PAGE_TOKEN });
      } else if (imageUrl) {
        fb = await postForm(`${GRAPH}/${PAGE_ID}/photos`, { url: imageUrl, caption: fbMessage, access_token: PAGE_TOKEN });
      } else {
        fb = await postForm(`${GRAPH}/${PAGE_ID}/feed`, { message: fbMessage, access_token: PAGE_TOKEN });
      }
      result.facebook = { ok: fb.ok, data: fb.data };
      // Full body as the first comment on the post.
      const objId = fb.data && (fb.data.post_id || fb.data.id);
      if (fb.ok && objId && fbComment) {
        const c = await postForm(`${GRAPH}/${objId}/comments`, { message: fbComment, access_token: PAGE_TOKEN });
        (result.facebook as any).comment = { ok: c.ok, id: c.data && c.data.id };
      }
    }
  }

  // ---- Instagram (requires a public image or video URL) ----
  if (wantIg) {
    if (!IG_USER_ID || !IG_TOKEN) {
      result.instagram = { ok: false, error: "META_IG_USER_ID / Instagram token not set" };
    } else if (!imageUrl && !videoUrl) {
      result.instagram = { ok: false, error: "Instagram needs an image or video — add media to the post." };
    } else {
      const containerParams: Record<string, string> = isVideo
        ? { media_type: "REELS", video_url: videoUrl, caption: igCaption, access_token: IG_TOKEN }
        : { image_url: imageUrl, caption: igCaption, access_token: IG_TOKEN };
      const create = await postForm(`${GRAPH}/${IG_USER_ID}/media`, containerParams);
      if (!create.ok || !create.data.id) {
        result.instagram = { ok: false, error: "container failed", data: create.data };
      } else {
        // Video/Reels containers process asynchronously — wait before publishing.
        const ready = isVideo ? await waitForContainer(create.data.id, IG_TOKEN) : { ok: true };
        if (!ready.ok) {
          result.instagram = { ok: false, error: ready.error };
        } else {
          const publish = await postForm(`${GRAPH}/${IG_USER_ID}/media_publish`, {
            creation_id: create.data.id, access_token: IG_TOKEN,
          });
          result.instagram = { ok: publish.ok, data: publish.data };
        }
      }
    }
  }

  return json({ ok: true, result });
});
