-- Migration 005: is_allergen flag on observations
alter table observations add column if not exists is_allergen boolean default false;
