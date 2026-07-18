// Vercel serverless function: server-rendered per-article <head> tags.
// Social scrapers (WhatsApp/Facebook/Twitter) and search crawlers do NOT run
// JavaScript, so they only ever see the static HTML head. This function fetches
// the article from Supabase and rewrites the head's title/description/OG/Twitter
// tags to the article's own headline + cover image before serving. The same HTML
// still boots the SPA for humans (it reads the /a/<id> path and renders normally).

const SUPABASE_URL = 'https://oqxbqwlgydgauxhbobqw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xeGJxd2xneWRnYXV4aGJvYnF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMDUxNjAsImV4cCI6MjA5OTg4MTE2MH0.p8LsBM3ijI_AWsrCZ0pk0479FaxI4y5rfoJ7fxtLss4';
const TABLE = 'ct_site';
const ROW = 'live';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function fetchPiece(id) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/${TABLE}?id=eq.${ROW}&select=data`,
      { headers: { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON } }
    );
    if (!r.ok) return null;
    const rows = await r.json();
    const pieces = (rows && rows[0] && rows[0].data && rows[0].data.pieces) || [];
    return pieces.find(p => p && p.id === id) || null;
  } catch (e) { return null; }
}

function injectMeta(html, m) {
  const T = esc(m.title), D = esc(m.desc), U = esc(m.url), I = esc(m.image);
  // Title
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${T}</title>`);
  // Simple name/property content swaps
  const swap = (attr, key, val) => {
    const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(">)`, 'i');
    if (re.test(html)) { html = html.replace(re, `$1${val}$2`); return; }
    // insert before </head> if missing
    const tag = `<meta ${attr}="${key}" content="${val}">`;
    html = html.replace(/<\/head>/i, `  ${tag}\n</head>`);
  };
  swap('name', 'description', D);
  swap('property', 'og:type', m.type);
  swap('property', 'og:title', T);
  swap('property', 'og:description', D);
  swap('property', 'og:url', U);
  swap('property', 'og:image', I);
  swap('property', 'og:image:secure_url', I);
  swap('property', 'og:image:alt', T);
  swap('name', 'twitter:title', T);
  swap('name', 'twitter:description', D);
  swap('name', 'twitter:image', I);
  // Canonical
  html = html.replace(/(<link rel="canonical" href=")[^"]*(">)/i, `$1${U}$2`);
  // Drop fixed 1200x630 dims when using a real article cover (unknown size)
  if (m.stripDims) {
    html = html.replace(/\s*<meta property="og:image:(?:width|height)" content="[^"]*">/gi, '');
  }
  return html;
}

module.exports = async (req, res) => {
  const rawId = (req.query && req.query.id) || '';
  const id = Array.isArray(rawId) ? rawId[0] : String(rawId);
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = req.headers.host;
  const origin = `${proto}://${host}`;

  // Base shell (static file — never rewritten, so no loop)
  let html;
  try {
    const hr = await fetch(`${origin}/index.html`);
    html = await hr.text();
  } catch (e) {
    res.statusCode = 302;
    res.setHeader('Location', '/');
    return res.end();
  }

  const piece = id ? await fetchPiece(id) : null;
  const title = piece ? (piece.tEn || piece.tBn || '').trim() : '';
  const dek = piece ? (piece.dEn || piece.dBn || '').trim() : '';
  const cover = piece && piece.cover ? piece.cover : '';

  let meta;
  if (title) {
    meta = {
      type: 'article',
      title: `${title} — Capsule Today`,
      desc: (dek || "Capsule Today — Dhaka's bilingual bite-sized newsroom.").replace(/\s+/g, ' ').slice(0, 200),
      url: `${origin}/a/${encodeURIComponent(id)}`,
      image: cover || `${origin}/og-cover.png`,
      stripDims: !!cover,
    };
  } else {
    // Unknown/unpublished id — fall back to site defaults (still valid page)
    meta = {
      type: 'website',
      title: 'Capsule Today — Every story. Two lenses. One capsule.',
      desc: "Capsule Today is Dhaka's bilingual bite-sized newsroom — every story in Bangla and English across Bangladesh, the world, culture, business, and only-in-Bangladesh.",
      url: `${origin}/a/${encodeURIComponent(id)}`,
      image: `${origin}/og-cover.png`,
      stripDims: false,
    };
  }

  html = injectMeta(html, meta);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // CDN-cache the rendered page briefly so we don't hit Supabase on every visit
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.statusCode = 200;
  res.end(html);
};
