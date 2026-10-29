-- Add persistent threaded comments, attachments, likes, and dislikes.
-- Existing comments and reactions are preserved.

begin;

alter table public.comments
  add column if not exists parent_id uuid,
  add column if not exists image_url text;

alter table public.comments
  drop constraint if exists comments_content_check,
  drop constraint if exists comments_content_or_image_check;

alter table public.comments
  add constraint comments_content_or_image_check
  check (
    char_length(content) <= 2000
    and (
      char_length(btrim(content)) > 0
      or nullif(btrim(image_url), '') is not null
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.comments'::regclass
      and conname = 'comments_parent_id_fkey'
  ) then
    alter table public.comments
      add constraint comments_parent_id_fkey
      foreign key (parent_id)
      references public.comments (id)
      on delete set null;
  end if;
end
$$;

create index if not exists comments_parent_created_at_idx
  on public.comments (parent_id, created_at)
  where parent_id is not null;

create or replace function public.aani_validate_comment_parent()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.parent_id is not null and not exists (
    select 1
    from public.comments parent
    where parent.id = new.parent_id
      and parent.post_id = new.post_id
  ) then
    raise exception 'Reply must belong to the same post as its parent'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists aani_validate_comment_parent on public.comments;
create trigger aani_validate_comment_parent
  before insert or update of parent_id, post_id on public.comments
  for each row execute function public.aani_validate_comment_parent();

create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create unique index if not exists comment_likes_comment_user_uidx
  on public.comment_likes (comment_id, user_id);

create table if not exists public.comment_dislikes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comments enable row level security;
alter table public.comment_likes enable row level security;
alter table public.comment_dislikes enable row level security;

drop policy if exists "Signed-in users can read comments" on public.comments;
create policy "Signed-in users can read comments"
  on public.comments for select to authenticated
  using (true);
drop policy if exists "Users can create comments as themselves" on public.comments;
create policy "Users can create comments as themselves"
  on public.comments for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can delete their own comments" on public.comments;
create policy "Users can delete their own comments"
  on public.comments for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Signed-in users can read comment likes" on public.comment_likes;
create policy "Signed-in users can read comment likes"
  on public.comment_likes for select to authenticated
  using (true);
drop policy if exists "Users can like comments as themselves" on public.comment_likes;
create policy "Users can like comments as themselves"
  on public.comment_likes for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can remove their own comment likes" on public.comment_likes;
create policy "Users can remove their own comment likes"
  on public.comment_likes for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Signed-in users can read comment dislikes" on public.comment_dislikes;
create policy "Signed-in users can read comment dislikes"
  on public.comment_dislikes for select to authenticated
  using (true);
drop policy if exists "Users can dislike comments as themselves" on public.comment_dislikes;
create policy "Users can dislike comments as themselves"
  on public.comment_dislikes for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can remove their own comment dislikes" on public.comment_dislikes;
create policy "Users can remove their own comment dislikes"
  on public.comment_dislikes for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.aani_clear_opposite_comment_reaction()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'comment_likes' then
    delete from public.comment_dislikes
    where comment_id = new.comment_id and user_id = new.user_id;
  else
    delete from public.comment_likes
    where comment_id = new.comment_id and user_id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists aani_comment_likes_exclusive on public.comment_likes;
create trigger aani_comment_likes_exclusive
  after insert on public.comment_likes
  for each row execute function public.aani_clear_opposite_comment_reaction();

drop trigger if exists aani_comment_dislikes_exclusive on public.comment_dislikes;
create trigger aani_comment_dislikes_exclusive
  after insert on public.comment_dislikes
  for each row execute function public.aani_clear_opposite_comment_reaction();

grant select, insert, delete on public.comments to authenticated;
grant select, insert, delete on public.comment_likes to authenticated;
grant select, insert, delete on public.comment_dislikes to authenticated;

alter table public.comments replica identity full;
alter table public.comment_likes replica identity full;
alter table public.comment_dislikes replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.comment_likes;
    exception
      when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.comment_dislikes;
    exception
      when duplicate_object then null;
    end;
  end if;
end
$$;

commit;
