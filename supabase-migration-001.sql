-- Migration 001: add content_hash for duplicate detection
alter table documents add column if not exists content_hash text unique;
