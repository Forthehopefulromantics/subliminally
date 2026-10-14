# The Subliminally Journal

A server-rendered blog at `/blog` with a private admin at `/blog-admin`.
**It is off everywhere until `BLOG_ENABLED=true` is set on an environment.**
Merging this branch to `main` does not publish it: with the variable unset,
every blog route, the blog sitemap and the admin API answer a bare 404.

## How it fits the existing app
| Concern | Choice |
| --- | --- |
| Hosting | Vercel (static root + `api/` functions), as before |
| Blog code | **One** new function, `api/blog.js` (the project already has 12, the Hobby limit) + `lib/blog/*` |
| Pages | Server-rendered HTML from Supabase on each request. Crawlable, no client JS needed to read |
| Admin | `/blog-admin` (`js/blog-admin.js`), Supabase sign-in, talks only to `/api/blog?op=…` |
| Auth | Server verifies the Supabase token (`lib/supabase-auth.js`) **and** looks the user up in `blog_admins`. No client flag is trusted |
| Data | `blog_posts`, `blog_categories`, `blog_admins`, storage bucket `blog-images` (`supabase/migrations/20261014_blog.sql`) |
| Existing app edits | `vercel.json` (rewrites), `js/boot.js` (+1 line so `/#build` opens the builder on a cold load), `.vercelignore`, `package.json` (test script) |

## Environment variables
| Variable | Where | Purpose |
| --- | --- | --- |
| `BLOG_ENABLED` | Preview only, until launch | Master switch. Anything but `true` = blog does not exist |
| `BLOG_INDEXABLE` | Production, at launch only | Lets search engines index. Also requires `VERCEL_ENV=production` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | existing | For staging use the **staging** project's values (Preview scope) |
| `SUPABASE_ANON_KEY` | new | Public anon key of the same project; injected into the admin login page |
| `BLOG_SITE_URL` | optional | Defaults to `https://www.subliminallybyfthr.com` (canonicals, OG, sitemap) |

## Privacy model
1. **Switch**: `BLOG_ENABLED` unset → 404 for everything.
2. **Access protection**: staging is a Vercel Preview deployment; enable Vercel Authentication on Preview so the whole deployment (pages, assets, APIs) needs a Vercel login. This is the real lock.
3. **noindex**: all non-production responses send `X-Robots-Tag: noindex, nofollow` and a meta robots tag. Secondary only.
4. **Drafts**: public reads filter to live articles in the database query; RLS gives anon read of live rows only. Preview HTML is only produced by the admin API after the token and `blog_admins` checks.
5. **Sitemap**: `/blog-sitemap.xml` is a 404 unless the blog is indexable, and then lists live posts only. The existing `sitemap.xml` and `robots.txt` are untouched.

## Admin
`/blog-admin` → sign in → dashboard (status, dates, last edited) → editor.
Editor: title, slug, category, tags, Markdown body with toolbar (including
Evidence / Experience / Belief / Example / Try-it boxes), images (upload to
Supabase Storage), SEO and social fields, author, sources, FAQ, CTA, private
notes, device-framed preview (iPhone / iPad / desktop), and a site preview
(homepage, category, article, with drafts). Autosave works for drafts; **live
articles are never autosaved** (explicit Save only). Publish / schedule /
unpublish / archive / delete (drafts and archived only).

**`[[VERIFY: …]]` markers** flag claims needing editorial verification. They
show highlighted in the preview, never to readers, and **block publishing**
until removed. Missing summary, meta description, or featured-image alt text
also block publishing.

Scheduling needs no cron: a scheduled article becomes visible when its time
passes, because visibility is evaluated on every request.

## Staging setup (one-time)
1. Create a separate Supabase project for staging (do not reuse production).
2. Run `supabase/migrations/20261014_blog.sql` in it. Make yourself admin:
   `insert into public.blog_admins (user_id) select id from auth.users where email = 'you@example.com';`
   (Create that user first under Auth → Users.)
3. Vercel → Project → Settings → Environment Variables, **Preview scope only**:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (staging values), `BLOG_ENABLED=true`.
   Leave everything else on Preview pointing at non-live services (Stripe test mode, no marketing email keys) so previews cannot charge or email real people.
4. Vercel → Settings → Deployment Protection: Vercel Authentication on for Preview.
5. Seed the ten drafts into **staging**:
   `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… BLOG_SEED_TARGET_CONFIRM=<staging host> node scripts/seed-blog.mjs --apply`
   (Dry run without `--apply`. Existing articles are never overwritten.)
6. Push `feature/subliminally-journal`; Vercel builds the Preview. Visit `<preview-url>/blog-admin`.

## Local development and tests
```
BLOG_ENABLED=true BLOG_STORE=file BLOG_STORE_FILE=/tmp/blog.json node scripts/blog-dev-server.mjs 3000
npm run test:blog
```
The file store refuses to run on Vercel. Artwork: `NODE_PATH=/opt/node-tools/node_modules node scripts/make-blog-art.mjs`.

## Launch checklist (only after "Publish the blog")
1. Resolve every `[[VERIFY]]` marker; confirm each citation (volume, pages, add links).
2. Read and edit all ten articles; review images and alt text.
3. Apply the migration to the production Supabase project; add yourself to `blog_admins`; upload or confirm images.
4. Set `SUPABASE_ANON_KEY` and `BLOG_ENABLED=true` on Production; redeploy.
5. Publish articles one by one from the admin.
6. Add a "Journal" link to the site nav/footer; add `/blog` and `/blog/category/*` to `sitemap.xml` or reference `/blog-sitemap.xml`.
7. Set `BLOG_INDEXABLE=true` on Production and redeploy; check `X-Robots-Tag` on a live article.
8. Submit `/blog-sitemap.xml` to Search Console.
9. Smoke-test the app (login, builder, playback, billing) on production.
