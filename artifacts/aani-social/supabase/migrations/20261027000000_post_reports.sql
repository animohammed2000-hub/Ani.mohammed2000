-- =====================================================================
-- Post reports (إبلاغ عن المنشورات)
-- Backs the post action dropdown "Report" option for non-owner users.
-- Idempotent: safe to run multiple times.
-- =====================================================================

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reported_user_id uuid references public.profiles(id) on delete set null,
  reason text not null default 'محتوى غير مناسب',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint aani_reports_post_reporter_unique unique (post_id, reporter_id)
);

create index if not exists aani_reports_status_idx
  on public.reports (status, created_at desc);
create index if not exists aani_reports_post_idx on public.reports (post_id);

alter table public.reports enable row level security;

do $$
begin
  -- A reporter can read back their own reports (used to detect duplicates).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and policyname = 'aani_reports_select_own') then
    create policy aani_reports_select_own on public.reports
      for select using (auth.uid() = reporter_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and policyname = 'aani_reports_insert_own') then
    create policy aani_reports_insert_own on public.reports
      for insert with check (auth.uid() = reporter_id);
  end if;

  -- Reporters may withdraw their own report.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and policyname = 'aani_reports_delete_own') then
    create policy aani_reports_delete_own on public.reports
      for delete using (auth.uid() = reporter_id);
  end if;

  -- Moderators (service role bypasses RLS) may triage reports; authenticated
  -- users never see other people's reports.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reports' and policyname = 'aani_reports_update_own') then
    create policy aani_reports_update_own on public.reports
      for update using (auth.uid() = reporter_id) with check (auth.uid() = reporter_id);
  end if;
end $$;

grant select, insert, update, delete on public.reports to authenticated;

alter table public.reports replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      execute 'alter publication supabase_realtime add table public.reports';
    exception
      when duplicate_object then null;
      when undefined_object then null;
      when others then null;
    end;
  end if;
end $$;
