-- Migration 003: parent/child document relationships for multi-page PDF splitting
alter table documents add column if not exists parent_id uuid references documents(id) on delete cascade;
alter table documents add column if not exists page_start int;
alter table documents add column if not exists page_end int;
