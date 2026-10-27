-- =====================================================================
-- Post controls (خيارات المنشور)
-- Backs the three-dot post menu:
--   * owner:  close / reopen comments          -> posts.comments_disabled
--             attach a music / audio track     -> posts.audio_url, posts.audio_title
--   * viewer: "مهتم" / "غير مهتم" feedback     -> post_feedback
-- Idempotent: safe to run multiple times.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Owner-controlled flags on posts
-- ---------------------------------------------------------------------
alter table public.posts
  add column if not exists comments_disabled boolean not null default false;

alter table public.posts
  add column if not exists audio_url text;

alter table public.posts
  add column if not exists audio_title text;

-- The feed already sorts by created_at; nothing to index for the new columns.

-- ---------------------------------------------------------------------
-- 2. Viewer feedback ("مهتم" / "غير مهتم")
-- ---------------------------------------------------------------------
create table if not exists public.post_feedback (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  feedback text not null check (feedback in ('interested', 'not_interested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One opinion per user per post: the client upserts on this pair.
  constraint aani_post_feedback_post_user_unique unique (post_id, user_id)
);

create index if not exists aani_post_feedback_user_idx
  on public.post_feedback (user_id, updated_at desc);
create index if not exists aani_post_feedback_post_idx
  on public.post_feedback (post_id);

alter table public.post_feedback enable row level security;

do $$
begin
  -- A user only ever reads their own feedback (used to restore menu state).
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'post_feedback'
      and policyname = 'aani_post_feedback_select_own'
  ) then
    create policy aani_post_feedback_select_own on public.post_feedback
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'post_feedback'
      and policyname = 'aani_post_feedback_insert_own'
  ) then
    create policy aani_post_feedback_insert_own on public.post_feedback
      for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'post_feedback'
      and policyname = 'aani_post_feedback_update_own'
  ) then
    create policy aani_post_feedback_update_own on public.post_feedback
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  -- Clearing a preference removes the row.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'post_feedback'
      and policyname = 'aani_post_feedback_delete_own'
  ) then
    create policy aani_post_feedback_delete_own on public.post_feedback
      for delete using (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update, delete on public.post_feedback to authenticated;

-- ---------------------------------------------------------------------
-- 3. Keep updated_at fresh on re-vote
-- ---------------------------------------------------------------------
create or replace function public.aani_touch_post_feedback()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists aani_post_feedback_touch on public.post_feedback;
create trigger aani_post_feedback_touch
  before update on public.post_feedback
  for each row execute function public.aani_touch_post_feedback();

-- ---------------------------------------------------------------------
-- 4. Comments respects the owner's switch
-- ---------------------------------------------------------------------
-- The client hides the panel when posts.comments_disabled is true; this
-- guard makes the rule authoritative at the database level too.
drop policy if exists aani_comments_insert_open on public.comments;
create policy aani_comments_insert_open on public.comments
  for insert with check (
    auth.uid() = user_id
    and not exists (
      select 1 from public.posts p
      where p.id = comments.post_id
        and p.comments_disabled = true
    )
  );
