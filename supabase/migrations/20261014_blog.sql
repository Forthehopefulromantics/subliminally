-- The Subliminally Journal (blog).
--
-- NOT APPLIED to production. Apply to the STAGING Supabase project first.
-- Posts are read and written only through /api/blog, which verifies the caller
-- server-side. RLS is the second lock: anon can read published posts only, and
-- only a row in blog_admins can touch anything else.

create table if not exists public.blog_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.blog_admins enable row level security;
-- no policies: nobody but the service role can read or change who is an admin.

create or replace function public.is_blog_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.blog_admins where user_id = auth.uid());
$$;
revoke all on function public.is_blog_admin() from public;
grant execute on function public.is_blog_admin() to authenticated;

create table if not exists public.blog_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  description text not null default '',
  sort_order int not null default 0
);
alter table public.blog_categories enable row level security;
create policy blog_categories_read on public.blog_categories for select using (true);
create policy blog_categories_admin on public.blog_categories for all to authenticated
  using (public.is_blog_admin()) with check (public.is_blog_admin());

insert into public.blog_categories (slug, name, description, sort_order) values
  ('subliminals-101', 'Subliminals 101', 'Start here: what subliminals are, how they work, and how to make your own.', 1),
  ('affirmations', 'Affirmations', 'Writing affirmations that sound like you and that you can actually say.', 2),
  ('sleep-rituals', 'Sleep & Rituals', 'Nighttime listening, wind-down routines, and habits that stick.', 3),
  ('self-concept', 'Self-Concept', 'How you see yourself, and gentle ways to update the story.', 4),
  ('manifestation', 'Manifestation', 'Intention, belief, and practical action, kept honest.', 5),
  ('mind-science', 'Mind & Science', 'What research does and does not say, in plain language.', 6)
on conflict (slug) do nothing;

create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  subtitle text not null default '',
  summary text not null default '',
  body_md text not null default '',
  category text not null references public.blog_categories(slug) on update cascade,
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','scheduled','published','archived')),
  featured boolean not null default false,
  featured_image_url text,
  featured_image_alt text not null default '',
  pin_image_url text,
  author_name text not null default 'The Subliminally Team',
  author_bio text not null default '',
  seo_title text not null default '',
  seo_description text not null default '',
  og_title text not null default '',
  og_description text not null default '',
  og_image_url text,
  sources jsonb not null default '[]'::jsonb,
  faq jsonb not null default '[]'::jsonb,
  cta_key text not null default 'none' check (cta_key in ('none','builder','affirmations','sleep','habits','collections')),
  editorial_notes text not null default '',
  reading_minutes int not null default 1,
  published_at timestamptz,
  scheduled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index if not exists blog_posts_status_pub on public.blog_posts (status, published_at desc);
create index if not exists blog_posts_category on public.blog_posts (category);
alter table public.blog_posts enable row level security;

-- Readers (anon) see only what is live. A scheduled post goes live by the clock.
create policy blog_posts_public_read on public.blog_posts for select using (
  (status = 'published' and published_at <= now())
  or (status = 'scheduled' and scheduled_at <= now())
);
create policy blog_posts_admin_all on public.blog_posts for all to authenticated
  using (public.is_blog_admin()) with check (public.is_blog_admin());

-- Featured and shareable images. Public read (published articles embed them),
-- admin-only write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog-images', 'blog-images', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
create policy blog_images_admin_write on storage.objects for all to authenticated
  using (bucket_id = 'blog-images' and public.is_blog_admin())
  with check (bucket_id = 'blog-images' and public.is_blog_admin());

-- To make yourself an admin (run in the SQL editor, with your own email):
--   insert into public.blog_admins (user_id)
--   select id from auth.users where email = 'you@example.com';
