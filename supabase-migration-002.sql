-- Migration 002: document classification, labels and search keywords
alter table documents add column if not exists categories text[] default '{}';
alter table documents add column if not exists label text;
alter table documents add column if not exists keywords text[] default '{}';
