# Capsule Today

A Dhaka-based bilingual (Bangla + English) bite-sized media brand — public website + newsroom studio.

## Contents

| Path | What it is |
|------|------------|
| `index.html` | The **public website** — capsule feed, pillar pages, bilingual articles. Reads published posts from Supabase. |
| `studio/index.html` | **Capsule Studio** — the newsroom console. Compose social capsules, articles + 4-slide carousels, brand images with the two-lens effect, publish to website + Facebook + Instagram. Requires sign-in. |
| `supabase/functions/social-publish/` | Edge Function that posts to Facebook & Instagram (holds the Meta token server-side). |

Both pages are single self-contained HTML files — no build step. Just host them.

## Hosting (Vercel)

One Vercel project serves both:

- `capsuletoday.vercel.app/` → the website (`index.html`)
- `capsuletoday.vercel.app/studio/` → the studio (`studio/index.html`)

Connect this GitHub repo as a Vercel project with **Framework Preset: Other** and no build command — it's plain static HTML. Every push to `main` auto-deploys.

## Backend (Supabase)

The shared database/auth/storage live in a Supabase project (URL + anon key are baked into the two HTML files).

**One-time setup:**

1. **Posts table** (SQL editor):
   ```sql
   create table posts (
     id uuid primary key default gen_random_uuid(),
     kind text, lens text, pillar text, lang text,
     title text, dek text, source text,
     body jsonb default '[]',
     status text default 'published',
     sched_at text,
     created_at timestamptz default now()
   );
   alter table posts enable row level security;
   create policy "public read"  on posts for select using (true);
   create policy "auth insert"  on posts for insert to authenticated with check (true);
   create policy "auth update"  on posts for update to authenticated using (true);
   create policy "auth delete"  on posts for delete to authenticated using (true);
   ```

2. **Media storage** — create a public bucket `media`, then:
   ```sql
   create policy "media public read" on storage.objects for select using (bucket_id = 'media');
   create policy "media auth write"  on storage.objects for insert to authenticated with check (bucket_id = 'media');
   ```

3. **Newsroom login** — Authentication → Users → Add user (Auto Confirm). This is the Studio sign-in.

4. **Facebook / Instagram** — deploy the Edge Function and set its secrets:
   ```bash
   supabase functions deploy social-publish
   supabase secrets set META_PAGE_ID=... META_PAGE_TOKEN=... META_IG_USER_ID=...
   ```
   (Instagram publishing needs a public image URL — that's why media uploads go to Storage.)

## Brand

- **Concept:** every story through two lenses — one Serious (brown), one Witty (gold) — compressed into one capsule.
- **Two-lens image effect:** uploads are auto-rendered as a gold→brown→ink duotone with a subtle channel split.
- **Type:** Newsreader (display) · Hanken Grotesk (text) · Spline Sans Mono (labels) · Noto Serif/Sans Bengali (Bangla).
- **Palette:** Brown `#4E382E` · Gold `#D8A52A` · Ink `#15120C` · Ivory `#F6F3EC`.
