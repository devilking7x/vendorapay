-- Vendora Pay AI — Supabase schema.
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Single key-value table backs the whole store dump; RLS disabled for the
-- service_role key used server-side (never expose it client-side).

create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
