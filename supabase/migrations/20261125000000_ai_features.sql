-- AI Intelligence Layer: Budgets, AI Insights Cache, and Receipt Extraction Metadata
-- Preserves all existing splitbill tables and user/trip records intact.

create table if not exists splitbill.group_budgets (
  trip_id text not null references splitbill.trips(id) on delete cascade,
  category text not null,
  monthly_limit bigint not null check (monthly_limit >= 0),
  updated_by text not null references splitbill.users(id),
  updated_at timestamptz not null default now(),
  primary key (trip_id, category)
);

create table if not exists splitbill.ai_audit_logs (
  id text primary key,
  trip_id text references splitbill.trips(id) on delete cascade,
  user_id text not null references splitbill.users(id),
  feature text not null,
  action text not null,
  confidence numeric(4,3),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_audit_logs_trip on splitbill.ai_audit_logs(trip_id, created_at desc);

alter table splitbill.group_budgets enable row level security;
alter table splitbill.ai_audit_logs enable row level security;

revoke all on splitbill.group_budgets, splitbill.ai_audit_logs from public, anon, authenticated;
grant select, insert, update, delete on splitbill.group_budgets to splitbill_api;
grant select, insert on splitbill.ai_audit_logs to splitbill_api;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'splitbill' and tablename = 'group_budgets' and policyname = 'server_api') then
    create policy server_api on splitbill.group_budgets for all to splitbill_api using (current_user = 'splitbill_api') with check (current_user = 'splitbill_api');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'splitbill' and tablename = 'ai_audit_logs' and policyname = 'server_api') then
    create policy server_api on splitbill.ai_audit_logs for all to splitbill_api using (current_user = 'splitbill_api') with check (current_user = 'splitbill_api');
  end if;
end $$;
