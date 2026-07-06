# Capsule Today — Deploy & Go-Live Checklist (web dashboards only)

No command line needed. Everything is done through github.com, vercel.com, and
supabase.com in the browser. Do Part 1 to update the live pages; do Parts 2–4 once
to enable Facebook / Instagram posting.

---

## Part 1 — Publish the latest site + studio (GitHub web → Vercel auto-deploys)

The live site is served by Vercel from this GitHub repo:
- `/`         → `index.html` (public website)
- `/studio/`  → `studio/index.html` (newsroom studio)

Every commit to `main` auto-deploys. To ship the newest build via the GitHub website:

1. Go to **github.com → your Capsule Today repo**.
2. Update the two page files (do each one):
   - Click `index.html` → the **pencil (Edit)** icon → select all, delete, and paste the
     full contents of this folder's `index.html` → **Commit changes** to `main`.
   - Open the `studio` folder → `index.html` → **pencil** → replace with this folder's
     `studio/index.html` → **Commit changes**.
   - *(Faster if you prefer: repo home → **Add file → Upload files**, drag `index.html`
     and the `studio/` folder in, then **Commit changes**. Uploading a folder replaces
     matching files.)*
3. Vercel sees the commit and auto-deploys (~1 min). Check progress at **vercel.com →
   your project → Deployments**. When the newest one is "Ready," `/` and `/studio/` are
   the latest.

---

## Part 2 — Turn on the posting service (Supabase dashboard, in-browser)

The studio's "Test connection" / publishing calls a server-side **Edge Function**. Until
it exists you'll see "Could not reach the publishing service." Create it in the browser:

1. Go to **supabase.com → your project → Edge Functions** (left sidebar).
2. Click **Create a function** (or **Deploy a new function → Via editor**).
3. Name it exactly: **`social-publish`** (the studio calls `/functions/v1/social-publish`).
4. In the code editor, **delete the sample code** and paste the entire contents of
   `supabase/functions/social-publish/index.ts` from this folder.
5. Click **Deploy**. Wait for the green "deployed" status.
6. If there's a **"Verify JWT" / "Enforce JWT"** toggle, leave it **ON** — the studio
   sends your signed-in token, so only your newsroom can publish.

To update the function later, open it here again, paste the new `index.ts`, redeploy.

---

## Part 3 — Connect Facebook & Instagram (in the studio UI)

1. Open the live studio at `your-site/studio/` and sign in.
2. Go to the **Connections** tab.
3. Paste:
   - **Facebook Page ID**
   - **Long-lived Page access token** (stored only in this browser; sent per-request to
     the function; never written to the public site/database)
   - **Instagram Business account ID** (optional, needed for IG)
4. Click **Test connection** → expect: `Connected ✓ — Page: … · IG: @…`.

### Getting a long-lived Page token
Recommended = a **System User token** (doesn't expire), all in Meta's website:
1. business.facebook.com → **Business settings → Users → System users** → add one.
2. Assign your **Page** to it (full control).
3. **Generate new token** → pick your Meta app → scopes:
   `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`,
   `instagram_basic`, `instagram_content_publish`. Expiration: **Never**.

Find the IDs (Graph API Explorer at developers.facebook.com/tools/explorer):
- Page ID: `GET /me/accounts`
- IG Business account ID: `GET /me/accounts?fields=instagram_business_account`

---

## Part 4 — Make image + video posting work (Supabase Storage, in-browser)

Instagram and Facebook **video** require a public media URL, so uploads must land in
Storage:

1. Supabase → **Storage** → **New bucket** named **`media`**, mark it **Public**.
2. Open the bucket's **Configuration**: set file-size limit **≥50 MB** and allowed MIME
   types to include `image/*` and `video/mp4` (or leave MIME empty = allow any).
3. Storage policies — Supabase → **Storage → Policies** (or SQL editor):
   ```sql
   create policy "media public read" on storage.objects for select using (bucket_id = 'media');
   create policy "media auth write"  on storage.objects for insert to authenticated with check (bucket_id = 'media');
   ```
4. In the studio: compose a post → toggle **Facebook** / **Instagram** → **Publish**.
   Photos post immediately; **Reels/video** take a few seconds while Meta processes them.

---

## Notes & caveats
- Shared-secret alternative to pasting per-browser: Supabase → **Edge Functions →
  social-publish → Secrets** (or Project Settings → Edge Functions → Secrets), add
  `META_PAGE_ID`, `META_PAGE_TOKEN`, `META_IG_USER_ID`. The function uses Studio-supplied
  creds first, then these.
- To publish for accounts beyond your own test users, Meta may require **App Review** for
  `pages_manage_posts` + `instagram_content_publish`. A System User token on your own Page
  usually works without full review.
- A locally-added (data-URL) video is NOT sent to Meta — it must be uploaded to Storage so
  it has a public `https:` URL.
- Reader passwords use a lightweight client-side hash — demo-grade, not real security.
