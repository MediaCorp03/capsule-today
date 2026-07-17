# Capsule Today — v2

Dhaka-based bilingual (Bangla + English) bite-sized media brand.

## Contents

| Path | What it is |
|---|---|
| `index.html` | The public website (self-contained, no build step) |
| `studio/index.html` | Capsule Studio — the newsroom that manages the website |

## Deploy (Vercel)

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** this repo. No framework, no build command — it's static HTML.
3. Domains: `capsuletoday.com` → site loads at the root, studio at `capsuletoday.com/studio`.

## Notes

- Content (articles, archive, ad settings) is currently stored in the browser's
  local storage — studio edits appear on the website in the **same browser** only.
  Wiring to Supabase (shared, real publishing) is the planned next step.
- Both files are fully self-contained: fonts, scripts and styles are inlined.
