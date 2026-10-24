-- Aani Supabase schema and migration.
-- Safe to re-run: this adds the new app fields/tables and policies without
-- deleting existing profile or post rows.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  full_name text,
  avatar_url text,
  bio text not null default '',
  display_name text not null default 'New member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists display_name text not null default 'New member';
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Backfill rows created by the previous Social Feed schema.
update public.profiles as p
set full_name = coalesce(
  nullif(btrim(p.full_name), ''),
  nullif(btrim(p.display_name), ''),
  nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
  'Member'
)
from auth.users as u
where p.id = u.id
  and (p.full_name is null or btrim(p.full_name) = '');

update public.profiles
set username = replace(id::text, '-', '')
where username is null or btrim(username) = '';

alter table public.profiles alter column username set not null;
alter table public.profiles alter column full_name set not null;
alter table public.profiles drop constraint if exists profiles_username_format_check;
alter table public.profiles
  add constraint profiles_username_format_check
  check (username ~ '^[a-z0-9_.]{3,32}$');
create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null default '',
  media_url text,
  type text not null default 'text',
  created_at timestamptz not null default now()
);

alter table public.posts add column if not exists media_url text;
alter table public.posts add column if not exists type text not null default 'text';
alter table public.posts alter column content set default '';

-- The previous schema required non-empty text and capped it at 500 characters.
-- Media-only posts are now valid; existing content is preserved.
alter table public.posts drop constraint if exists posts_content_check;
alter table public.posts drop constraint if exists posts_content_length_check;
alter table public.posts
  add constraint posts_content_length_check
  check (
    char_length(content) <= 2000
    and (char_length(btrim(content)) > 0 or media_url is not null)
  );
alter table public.posts drop constraint if exists posts_type_check;
alter table public.posts
  add constraint posts_type_check
  check (type in ('text', 'photo', 'reel'));
alter table public.posts drop constraint if exists posts_media_type_check;
alter table public.posts
  add constraint posts_media_type_check
  check (
    (type = 'text' and media_url is null)
    or (type in ('photo', 'reel') and media_url is not null)
  );

create index if not exists posts_created_at_idx
  on public.posts (created_at desc);
create index if not exists posts_user_created_at_idx
  on public.posts (user_id, created_at desc);

create table if not exists public.likes (
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self_check check (follower_id <> following_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint messages_not_self_check check (sender_id <> recipient_id)
);

create index if not exists comments_post_created_at_idx
  on public.comments (post_id, created_at);
create index if not exists follows_following_idx
  on public.follows (following_id, follower_id);
create index if not exists messages_sender_created_at_idx
  on public.messages (sender_id, created_at);
create index if not exists messages_recipient_created_at_idx
  on public.messages (recipient_id, created_at);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.likes enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Signed-in users can read profiles" on public.profiles;
create policy "Signed-in users can read profiles"
  on public.profiles for select to authenticated
  using (true);
drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Signed-in users can read posts" on public.posts;
create policy "Signed-in users can read posts"
  on public.posts for select to authenticated
  using (true);
drop policy if exists "Users can create their own posts" on public.posts;
create policy "Users can create their own posts"
  on public.posts for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can delete their own posts" on public.posts;
create policy "Users can delete their own posts"
  on public.posts for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Signed-in users can read likes" on public.likes;
create policy "Signed-in users can read likes"
  on public.likes for select to authenticated
  using (true);
drop policy if exists "Users can like posts as themselves" on public.likes;
create policy "Users can like posts as themselves"
  on public.likes for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Users can remove their own likes" on public.likes;
create policy "Users can remove their own likes"
  on public.likes for delete to authenticated
  using (user_id = (select auth.uid()));

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

drop policy if exists "Signed-in users can read follows" on public.follows;
create policy "Signed-in users can read follows"
  on public.follows for select to authenticated
  using (true);
drop policy if exists "Users can follow as themselves" on public.follows;
create policy "Users can follow as themselves"
  on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()) and follower_id <> following_id);
drop policy if exists "Users can unfollow as themselves" on public.follows;
create policy "Users can unfollow as themselves"
  on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));

drop policy if exists "Users can read their own messages" on public.messages;
create policy "Users can read their own messages"
  on public.messages for select to authenticated
  using (
    sender_id = (select auth.uid())
    or recipient_id = (select auth.uid())
  );
drop policy if exists "Users can send messages as themselves" on public.messages;
create policy "Users can send messages as themselves"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and sender_id <> recipient_id
  );

grant select, insert, update on public.profiles to authenticated;
grant select, insert, delete on public.posts to authenticated;
grant select, insert, delete on public.likes to authenticated;
grant select, insert, delete on public.comments to authenticated;
grant select, insert, delete on public.follows to authenticated;
grant select, insert on public.messages to authenticated;

-- The bucket is public for media playback/rendering. Writes are still restricted
-- to the authenticated user's own UUID folder by the object policies below.
insert into storage.buckets (id, name, public)
values ('aani-media', 'aani-media', true)
on conflict (id) do nothing;

drop policy if exists "Aani media is readable by signed-in users" on storage.objects;
create policy "Aani media is readable by signed-in users"
  on storage.objects for select to authenticated
  using (bucket_id = 'aani-media');
drop policy if exists "Users can upload their own Aani media" on storage.objects;
create policy "Users can upload their own Aani media"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'aani-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can update their own Aani media" on storage.objects;
create policy "Users can update their own Aani media"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'aani-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'aani-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
drop policy if exists "Users can delete their own Aani media" on storage.objects;
create policy "Users can delete their own Aani media"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'aani-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Realtime only needs to broadcast new messages for the live chat flow.
alter table public.messages replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'messages'
     ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end;
$$;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_full_name text;
begin
  requested_username := lower(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'username', ''),
    '[^a-z0-9_.]',
    '',
    'g'
  ));
  if char_length(requested_username) < 3 then
    requested_username := replace(new.id::text, '-', '');
  end if;

  requested_full_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Member'
  );

  insert into public.profiles (id, username, full_name)
  values (
    new.id,
    left(requested_username, 32),
    left(requested_full_name, 120)
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();