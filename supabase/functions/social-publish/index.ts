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

  const PAGE_ID = Deno.env.get("META_PAGE_ID") || "";
  const PAGE_TOKEN = Deno.env.get("META_PAGE_TOKEN") || "";
  const IG_USER_ID = Deno.env.get("META_IG_USER_ID") || "";

  let p: any = {};
  try { p = await req.json(); } catch (_) { return json({ error: "bad json" }, 400); }

  const caption = [p.title, p.dek, p.source ? `Source: ${p.source}` : "", "#CapsuleToday"]
    .filter(Boolean).join("\n\n");
  const imageUrl: string = p.imageUrl || "";
  const wantFb = !!(p.channels && p.channels.fb);
  const wantIg = !!(p.channels && p.channels.ig);

  const result: Record<string, unknown> = {};

  // ---- Facebook Page ----
  if (wantFb) {
    if (!PAGE_ID || !PAGE_TOKEN) {
      result.facebook = { ok: false, error: "META_PAGE_ID / META_PAGE_TOKEN not set" };
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

  // ---- Instagram (requires a public image URL) ----
  if (wantIg) {
    if (!IG_USER_ID || !PAGE_TOKEN) {
      result.instagram = { ok: false, error: "META_IG_USER_ID / META_PAGE_TOKEN not set" };
    } else if (!imageUrl) {
      result.instagram = { ok: false, error: "Instagram needs an image — add one to the capsule." };
    } else {
      const create = await postForm(`${GRAPH}/${IG_USER_ID}/media`, {
        image_url: imageUrl, caption, access_token: PAGE_TOKEN,
      });
      if (!create.ok || !create.data.id) {
        result.instagram = { ok: false, error: "container failed", data: create.data };
      } else {
        const publish = await postForm(`${GRAPH}/${IG_USER_ID}/media_publish`, {
          creation_id: create.data.id, access_token: PAGE_TOKEN,
        });
        result.instagram = { ok: publish.ok, data: publish.data };
      }
    }
  }

  return json({ ok: true, result });
});
