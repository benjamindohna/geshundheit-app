-- Migration 004: allergens, health_profile, observation_descriptions, action_plan_items, action_plan_summary

create table if not exists allergens (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  name text not null,
  severity text not null,
  common_foods text[] default '{}',
  updated_at timestamptz default now()
);

create table if not exists health_profile (
  id uuid primary key default gen_random_uuid(),
  summary text,
  body_age integer,
  updated_at timestamptz default now()
);

create table if not exists observation_descriptions (
  display_name text primary key,
  description text not null
);

create table if not exists action_plan_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  value text,
  label text,
  note text,
  prescription_required boolean default false,
  updated_at timestamptz default now()
);

create table if not exists action_plan_summary (
  id uuid primary key default gen_random_uuid(),
  summary text not null,
  updated_at timestamptz default now()
);

-- RLS (permissive — auth handled by the app)
alter table allergens enable row level security;
alter table health_profile enable row level security;
alter table observation_descriptions enable row level security;
alter table action_plan_items enable row level security;
alter table action_plan_summary enable row level security;

create policy "Allow all" on allergens for all using (true) with check (true);
create policy "Allow all" on health_profile for all using (true) with check (true);
create policy "Allow all" on observation_descriptions for all using (true) with check (true);
create policy "Allow all" on action_plan_items for all using (true) with check (true);
create policy "Allow all" on action_plan_summary for all using (true) with check (true);
