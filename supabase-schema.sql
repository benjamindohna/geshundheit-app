-- Documents: uploaded health files (PDFs, JPEGs)
create table documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  storage_path text not null,
  file_type text not null,
  uploaded_at timestamptz default now(),
  processed_at timestamptz,
  extraction_status text default 'pending',
  extraction_error text
);

-- Observations: individual health values extracted from documents
create table observations (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  display_name text not null,
  loinc_code text,
  value numeric,
  value_text text,
  unit text,
  reference_range_low numeric,
  reference_range_high numeric,
  reference_range_text text,
  status text check (status in ('normal', 'borderline', 'abnormal', 'critical')),
  clinical_severity integer check (clinical_severity between 1 and 10),
  measured_at date not null,
  volatility text default 'medium' check (volatility in ('high', 'medium', 'low')),
  created_at timestamptz default now()
);

-- Analyses: stored Claude analysis results
create table analyses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  summary text,
  sport_recommendations jsonb,
  nutrition_recommendations jsonb,
  supplement_recommendations jsonb,
  test_recommendations jsonb
);

-- Row Level Security (permissive — auth handled by the app itself)
alter table documents enable row level security;
alter table observations enable row level security;
alter table analyses enable row level security;

create policy "Allow all" on documents for all using (true) with check (true);
create policy "Allow all" on observations for all using (true) with check (true);
create policy "Allow all" on analyses for all using (true) with check (true);
