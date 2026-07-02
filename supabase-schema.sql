-- 在 Supabase Dashboard > SQL Editor 中执行一次。
create table if not exists public.dashboard_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_state enable row level security;
grant select, insert, update, delete on table public.dashboard_state to authenticated;
revoke all on table public.dashboard_state from anon;

drop policy if exists "read own dashboard" on public.dashboard_state;
create policy "read own dashboard" on public.dashboard_state
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "insert own dashboard" on public.dashboard_state;
create policy "insert own dashboard" on public.dashboard_state
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "update own dashboard" on public.dashboard_state;
create policy "update own dashboard" on public.dashboard_state
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.set_dashboard_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dashboard_state_updated_at on public.dashboard_state;
create trigger dashboard_state_updated_at
before update on public.dashboard_state
for each row execute function public.set_dashboard_updated_at();
