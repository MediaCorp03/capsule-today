// Capsule Today — social publishing Edge Function
// Deploy: supabase functions deploy social-publish
// Set secrets (Project Settings → Edge Functions → Secrets, or `supabase secrets set`):
//   META_PAGE_ID         your Facebook Page ID
//   META_PAGE_TOKEN      long-lived Page access token (never goes to the browser)
//   META_IG_USER_ID      your Instagram Business account ID (optional, for IG)
//
// The Studio calls this with the signed-in user's JWT, so only your newsroom can publish.

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

  // ---- Verify (Test connection) ----
  if (p.action === "verify") {
    const verify: Record<string, unknown> = {};
    if (!PAGE_ID || !PAGE_TOKEN) return json({ ok: true, verify: { error: "Enter a Page ID and Page access token." } });
    try {
      const pr = await fetch(`${GRAPH}/${PAGE_ID}?fields=name&access_token=${encodeURIComponent(PAGE_TOKEN)}`);
      const pd = await pr.json().catch(() => ({}));
      if (!pr.ok || !pd.name) { verify.error = (pd.error && pd.error.message) || "Could not verify the Page — check the ID and token."; return json({ ok: true, verify }); }
      verify.page = { name: pd.name };
      if (IG_USER_ID) {
        const ir = await fetch(`${GRAPH}/${IG_USER_ID}?fields=username&access_token=${encodeURIComponent(PAGE_TOKEN)}`);
        const idd = await ir.json().catch(() => ({}));
        if (ir.ok && idd.username) verify.ig = { username: idd.username };
      }
    } catch (_) { verify.error = "Could not reach the Graph API."; }
    return json({ ok: true, verify });
  }

  const caption = [p.title, p.dek, p.source ? `Source: ${p.source}` : "", "#CapsuleToday"]
    .filter(Boolean).join("\n\n");
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
    } else if (isVideo) {
      const { ok, data } = await postForm(`${GRAPH}/${PAGE_ID}/videos`, {
        file_url: videoUrl, description: caption, access_token: PAGE_TOKEN,
      });
      result.facebook = { ok, data };
    } else if (imageUrl) {
      const { ok, data } = await postForm(`${GRAPH}/${PAGE_ID}/photos`, {
        url: imageUrl, caption, access_token: PAGE_TOKEN,
      });
      result.facebook = { ok, data };
    } else {
      const { ok, data } = await postForm(`${GRAPH}/${PAGE_ID}/feed`, {
        message: caption, access_token: PAGE_TOKEN,
      });
      result.facebook = { ok, data };
    }
  }

  // ---- Instagram (requires a public image or video URL) ----
  if (wantIg) {
    if (!IG_USER_ID || !PAGE_TOKEN) {
      result.instagram = { ok: false, error: "META_IG_USER_ID / META_PAGE_TOKEN not set" };
    } else if (!imageUrl && !videoUrl) {
      result.instagram = { ok: false, error: "Instagram needs an image or video — add media to the post." };
    } else {
      const containerParams: Record<string, string> = isVideo
        ? { media_type: "REELS", video_url: videoUrl, caption, access_token: PAGE_TOKEN }
        : { image_url: imageUrl, caption, access_token: PAGE_TOKEN };
      const create = await postForm(`${GRAPH}/${IG_USER_ID}/media`, containerParams);
      if (!create.ok || !create.data.id) {
        result.instagram = { ok: false, error: "container failed", data: create.data };
      } else {
        // Video/Reels containers process asynchronously — wait before publishing.
        const ready = isVideo ? await waitForContainer(create.data.id, PAGE_TOKEN) : { ok: true };
        if (!ready.ok) {
          result.instagram = { ok: false, error: ready.error };
        } else {
          const publish = await postForm(`${GRAPH}/${IG_USER_ID}/media_publish`, {
            creation_id: create.data.id, access_token: PAGE_TOKEN,
          });
          result.instagram = { ok: publish.ok, data: publish.data };
        }
      }
    }
  }

  return json({ ok: true, result });
});
