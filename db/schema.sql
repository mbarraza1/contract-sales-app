create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'sales_rep' check (role in ('admin', 'manager', 'sales_rep')),
  created_at timestamptz not null default now()
);

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  website_url text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, normalized_name)
);

create table if not exists company_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists company_locations_unique_location_idx
  on company_locations(company_id, coalesce(address_line1, ''), coalesce(city, ''), coalesce(state, ''), coalesce(postal_code, ''));

create table if not exists gaf_listings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source_zip text not null,
  search_distance_miles integer not null default 25,
  distance_miles numeric(6, 2),
  gaf_profile_url text,
  certification_level text,
  badges text[] not null default '{}',
  specialties text[] not null default '{}',
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (company_id, source_zip, search_distance_miles)
);

create table if not exists company_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_count_estimate integer,
  annual_revenue_estimate numeric(14, 2),
  years_in_business integer,
  location_count integer,
  review_rating numeric(3, 2),
  review_count integer,
  recent_review_count_90d integer,
  hiring_signal_count integer,
  website_quality_score integer check (website_quality_score between 0 and 100),
  service_breadth_score integer check (service_breadth_score between 0 and 100),
  growth_signal_score integer check (growth_signal_score between 0 and 100),
  social_activity_score integer check (social_activity_score between 0 and 100),
  contact_confidence_score integer check (contact_confidence_score between 0 and 100),
  has_financing boolean,
  decision_maker_found boolean,
  residential_focus boolean,
  storm_damage_focus boolean,
  solar_service boolean,
  metal_roofing_service boolean,
  metrics_payload jsonb not null default '{}'::jsonb,
  sources_payload jsonb not null default '[]'::jsonb,
  calculated_at timestamptz not null default now()
);

create table if not exists company_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  full_name text,
  title text,
  email text,
  phone text,
  linkedin_url text,
  confidence_score integer check (confidence_score between 0 and 100),
  source_url text,
  created_at timestamptz not null default now()
);

create table if not exists company_sources (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source_type text not null,
  source_url text,
  title text,
  evidence text,
  captured_at timestamptz not null default now()
);

create table if not exists enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  provider text not null default 'perplexity',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  prompt_version text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_message text,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  source_zip text,
  search_distance_miles integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result_payload jsonb not null default '{}'::jsonb,
  error_message text
);

create table if not exists scoring_models (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  description text not null,
  weights jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists scoring_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  scoring_model_id uuid references scoring_models(id),
  total_score numeric(5, 2) not null,
  buying_likelihood_score numeric(5, 2) not null,
  company_size_score numeric(5, 2) not null,
  contactability_score numeric(5, 2) not null,
  reasons text[] not null default '{}',
  score_payload jsonb not null default '{}'::jsonb,
  scored_at timestamptz not null default now()
);

create table if not exists shared_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists companies_normalized_name_idx on companies(normalized_name);
create index if not exists company_locations_company_id_idx on company_locations(company_id);
create index if not exists gaf_listings_source_idx on gaf_listings(source_zip, search_distance_miles);
create index if not exists company_metrics_company_id_calculated_idx on company_metrics(company_id, calculated_at desc);
create index if not exists scoring_results_company_id_scored_idx on scoring_results(company_id, scored_at desc);

create or replace view ranked_companies_current as
select distinct on (c.id)
  c.id,
  c.name,
  c.website_url,
  c.phone,
  gl.source_zip,
  gl.search_distance_miles,
      gl.distance_miles,
      gl.gaf_profile_url,
      gl.certification_level,
  gl.badges,
  gl.specialties,
  sr.total_score,
  sr.buying_likelihood_score,
  sr.company_size_score,
  sr.contactability_score,
  sr.reasons,
  sr.scored_at
from companies c
left join gaf_listings gl on gl.company_id = c.id
left join scoring_results sr on sr.company_id = c.id
order by c.id, sr.scored_at desc nulls last;
