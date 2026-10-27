-- =====================================================================
-- Aani: persistent interactions (likes, comments, reposts, shares, saves)
-- =====================================================================
-- Every interaction button in the app writes a real row and the counters on
-- public.posts are kept in sync by triggers, so:
--   * the same number is shown to every user
--   * the state survives refresh / re-render / reopening the app
--   * post_interaction_summaries() returns counters + "did I react" flags in
--     one round trip (and bypasses per-table select policies safely).
--
-- Safe to run multiple times.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Denormalised counters on posts
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists likes_count integer not null default 0,
  add column if not exists comments_count integer not null default 0,
  add column if not exists reposts_count integer not null default 0,
  add column if not exists shares_count integer not null default 0;

create index if not exists posts_likes_count_idx on public.posts (likes_count desc);
create index if not exists posts_comments_count_idx on public.posts (comments_count desc);

-- ---------------------------------------------------------------------
-- 2. Tables that store the interactions
-- ---------------------------------------------------------------------
create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint aani_bookmarks_post_user_unique unique (post_id, user_id)
);

create table if not exists public.reposts (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint aani_reposts_post_user_unique unique (post_id, user_id)
);

create table if not exists public.post_shares (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists aani_post_shares_post_user_unique
  on public.post_shares (post_id, user_id);
create index if not exists aani_post_shares_post_idx on public.post_shares (post_id);
create index if not exists aani_post_shares_user_idx on public.post_shares (user_id);
create index if not exists aani_bookmarks_user_idx on public.bookmarks (user_id);
create index if not exists aani_reposts_user_idx on public.reposts (user_id);

-- Notifications are best-effort; make sure the table exists for the client.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null default 'system',
  content text,
  reference_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists aani_notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- 3. Row level security
-- ---------------------------------------------------------------------
alter table public.bookmarks enable row level security;
alter table public.reposts enable row level security;
alter table public.post_shares enable row level security;
alter table public.notifications enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'post_shares' and policyname = 'aani_post_shares_select_own') then
    create policy aani_post_shares_select_own on public.post_shares
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'post_shares' and policyname = 'aani_post_shares_insert_own') then
    create policy aani_post_shares_insert_own on public.post_shares
      for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'post_shares' and policyname = 'aani_post_shares_delete_own') then
    create policy aani_post_shares_delete_own on public.post_shares
      for delete using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bookmarks' and policyname = 'aani_bookmarks_select_own') then
    create policy aani_bookmarks_select_own on public.bookmarks
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bookmarks' and policyname = 'aani_bookmarks_insert_own') then
    create policy aani_bookmarks_insert_own on public.bookmarks
      for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'bookmarks' and policyname = 'aani_bookmarks_delete_own') then
    create policy aani_bookmarks_delete_own on public.bookmarks
      for delete using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reposts' and policyname = 'aani_reposts_select_own') then
    create policy aani_reposts_select_own on public.reposts
      for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reposts' and policyname = 'aani_reposts_insert_own') then
    create policy aani_reposts_insert_own on public.reposts
      for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reposts' and policyname = 'aani_reposts_delete_own') then
    create policy aani_reposts_delete_own on public.reposts
      for delete using (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, delete on public.bookmarks to authenticated;
grant select, insert, delete on public.reposts to authenticated;
grant select, insert on public.post_shares to authenticated, anon;
grant select, update on public.notifications to authenticated;
grant insert on public.notifications to authenticated;

-- ---------------------------------------------------------------------
-- 4. Counter triggers (single source of truth for the numbers)
-- ---------------------------------------------------------------------
create or replace function public.aani_sync_post_counters()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post uuid;
  delta integer;
begin
  if tg_op = 'INSERT' then
    target_post := new.post_id;
    delta := 1;
  else
    target_post := old.post_id;
    delta := -1;
  end if;

  if target_post is null then
    return null;
  end if;

  if tg_table_name = 'likes' then
    update public.posts
      set likes_count = greatest(0, coalesce(likes_count, 0) + delta)
      where id = target_post;
  elsif tg_table_name = 'comments' then
    update public.posts
      set comments_count = greatest(0, coalesce(comments_count, 0) + delta)
      where id = target_post;
  elsif tg_table_name = 'reposts' then
    update public.posts
      set reposts_count = greatest(0, coalesce(reposts_count, 0) + delta)
      where id = target_post;
  elsif tg_table_name = 'post_shares' then
    update public.posts
      set shares_count = greatest(0, coalesce(shares_count, 0) + delta)
      where id = target_post;
  end if;

  return null;
end;
$$;

drop trigger if exists aani_likes_counter on public.likes;
create trigger aani_likes_counter
  after insert or delete on public.likes
  for each row execute function public.aani_sync_post_counters();

drop trigger if exists aani_comments_counter on public.comments;
create trigger aani_comments_counter
  after insert or delete on public.comments
  for each row execute function public.aani_sync_post_counters();

drop trigger if exists aani_reposts_counter on public.reposts;
create trigger aani_reposts_counter
  after insert or delete on public.reposts
  for each row execute function public.aani_sync_post_counters();

drop trigger if exists aani_post_shares_counter on public.post_shares;
create trigger aani_post_shares_counter
  after insert or delete on public.post_shares
  for each row execute function public.aani_sync_post_counters();

-- Backfill counters from the rows that already exist.
update public.posts p set
  likes_count = coalesce((select count(*) from public.likes l where l.post_id = p.id), 0),
  comments_count = coalesce((select count(*) from public.comments c where c.post_id = p.id), 0),
  reposts_count = coalesce((select count(*) from public.reposts r where r.post_id = p.id), 0),
  shares_count = coalesce((select count(*) from public.post_shares s where s.post_id = p.id), 0);

-- ---------------------------------------------------------------------
-- 5. One-shot summary RPC used by the client
-- ---------------------------------------------------------------------
create or replace function public.post_interaction_summaries(post_ids uuid[])
returns table (
  post_id uuid,
  like_count integer,
  comment_count integer,
  repost_count integer,
  share_count integer,
  liked boolean,
  bookmarked boolean,
  reposted boolean,
  shared boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id as post_id,
    coalesce(p.likes_count, 0) as like_count,
    coalesce(p.comments_count, 0) as comment_count,
    coalesce(p.reposts_count, 0) as repost_count,
    coalesce(p.shares_count, 0) as share_count,
    exists (
      select 1 from public.likes l
      where l.post_id = p.id and l.user_id = auth.uid()
    ) as liked,
    exists (
      select 1 from public.bookmarks b
      where b.post_id = p.id and b.user_id = auth.uid()
    ) as bookmarked,
    exists (
      select 1 from public.reposts r
      where r.post_id = p.id and r.user_id = auth.uid()
    ) as reposted,
    exists (
      select 1 from public.post_shares s
      where s.post_id = p.id and s.user_id = auth.uid()
    ) as shared
  from public.posts p
  where p.id = any(post_ids);
$$;

revoke all on function public.post_interaction_summaries(uuid[]) from public;
grant execute on function public.post_interaction_summaries(uuid[]) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 6. Realtime: push new interactions + counter updates to every client
-- ---------------------------------------------------------------------
do $$
declare
  target text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach target in array array['likes', 'comments', 'reposts', 'bookmarks', 'post_shares', 'posts']
    loop
      begin
        execute format('alter publication supabase_realtime add table public.%I', target);
      exception
        when duplicate_object then null;
        when undefined_object then null;
        when others then null;
      end;
    end loop;
  end if;
end $$;

commit;
