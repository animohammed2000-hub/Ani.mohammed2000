-- Additive schema for Aani's stories, bookmarks, reposts, and notifications.
-- Review the target project's existing tables and RLS policies before applying.
-- This file is not run automatically by the Replit app.

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

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  type text not null,
  content text not null default '',
  reference_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  media_url text,
  media_type text not null default 'text',
  caption text,
  is_close_friends boolean not null default false,
  duration_seconds integer not null default 5
    check (duration_seconds between 1 and 60),
  timed_texts jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create table if not exists public.story_likes (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint aani_story_likes_story_user_unique unique (story_id, user_id)
);

create index if not exists aani_stories_user_expiry_idx
  on public.stories (user_id, expires_at);
create index if not exists aani_notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

alter table public.bookmarks enable row level security;
alter table public.reposts enable row level security;
alter table public.notifications enable row level security;
alter table public.stories enable row level security;
alter table public.story_likes enable row level security;

grant select, insert, delete on public.bookmarks to authenticated;
grant select, insert, delete on public.reposts to authenticated;
grant select, insert, update on public.notifications to authenticated;
grant select, insert, delete on public.stories to authenticated;
grant select, insert, delete on public.story_likes to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bookmarks'
      and policyname = 'aani_bookmarks_select_own'
  ) then
    create policy aani_bookmarks_select_own on public.bookmarks
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bookmarks'
      and policyname = 'aani_bookmarks_insert_own'
  ) then
    create policy aani_bookmarks_insert_own on public.bookmarks
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'bookmarks'
      and policyname = 'aani_bookmarks_delete_own'
  ) then
    create policy aani_bookmarks_delete_own on public.bookmarks
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reposts'
      and policyname = 'aani_reposts_select_own'
  ) then
    create policy aani_reposts_select_own on public.reposts
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reposts'
      and policyname = 'aani_reposts_insert_own'
  ) then
    create policy aani_reposts_insert_own on public.reposts
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'reposts'
      and policyname = 'aani_reposts_delete_own'
  ) then
    create policy aani_reposts_delete_own on public.reposts
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'aani_notifications_select_own'
  ) then
    create policy aani_notifications_select_own on public.notifications
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'aani_notifications_insert_as_actor'
  ) then
    create policy aani_notifications_insert_as_actor on public.notifications
      for insert to authenticated
      with check (
        actor_id = (select auth.uid())
        and user_id <> (select auth.uid())
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'aani_notifications_update_own'
  ) then
    create policy aani_notifications_update_own on public.notifications
      for update to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stories'
      and policyname = 'aani_stories_select_visible'
  ) then
    create policy aani_stories_select_visible on public.stories
      for select to authenticated
      using (
        user_id = (select auth.uid())
        or not is_close_friends
        or exists (
          select 1
          from public.follows as outgoing
          join public.follows as incoming
            on incoming.follower_id = outgoing.following_id
           and incoming.following_id = outgoing.follower_id
          where outgoing.follower_id = (select auth.uid())
            and outgoing.following_id = stories.user_id
        )
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stories'
      and policyname = 'aani_stories_insert_own'
  ) then
    create policy aani_stories_insert_own on public.stories
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stories'
      and policyname = 'aani_stories_delete_own'
  ) then
    create policy aani_stories_delete_own on public.stories
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'story_likes'
      and policyname = 'aani_story_likes_select_own'
  ) then
    create policy aani_story_likes_select_own on public.story_likes
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'story_likes'
      and policyname = 'aani_story_likes_insert_own'
  ) then
    create policy aani_story_likes_insert_own on public.story_likes
      for insert to authenticated with check (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'story_likes'
      and policyname = 'aani_story_likes_delete_own'
  ) then
    create policy aani_story_likes_delete_own on public.story_likes
      for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end
$$;
