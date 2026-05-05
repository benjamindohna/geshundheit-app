-- Migration 006: allergen_food_notes cache table
create table if not exists allergen_food_notes (
  display_name text primary key,
  food_note    text not null,
  updated_at   timestamptz default now()
);

alter table allergen_food_notes enable row level security;
create policy "Allow all" on allergen_food_notes for all using (true) with check (true);
