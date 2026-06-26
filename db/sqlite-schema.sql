pragma foreign_keys = on;

create table if not exists organizations (
  id text primary key,
  name text not null unique,
  created_at text not null default (datetime('now'))
);

create table if not exists users (
  id text primary key,
  organization_id text references organizations(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  role text not null default 'sales_rep' check (role in ('admin', 'manager', 'sales_rep')),
  created_at text not null default (datetime('now'))
);

create table if not exists companies (
  id text primary key,
  organization_id text references organizations(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  website_url text,
  phone text,
  created_at text not null default (datetime('now')),
  updated_at text not null default (datetime('now')),
  unique (organization_id, normalized_name)
);

create table if not exists company_locations (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  address_line1 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  latitude real,
  longitude real,
  is_primary integer not null default 0,
  created_at text not null default (datetime('now'))
);

create unique index if not exists company_locations_unique_location_idx
  on company_locations(company_id, coalesce(address_line1, ''), coalesce(city, ''), coalesce(state, ''), coalesce(postal_code, ''));

create table if not exists gaf_listings (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  source_zip text not null,
  search_distance_miles integer not null default 25,
  distance_miles real,
  gaf_profile_url text,
  certification_level text,
  badges text not null default '[]',
  specialties text not null default '[]',
  raw_payload text not null default '{}',
  first_seen_at text not null default (datetime('now')),
  last_seen_at text not null default (datetime('now')),
  unique (company_id, source_zip, search_distance_miles)
);

create table if not exists company_metrics (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  employee_count_estimate integer,
  annual_revenue_estimate real,
  years_in_business integer,
  location_count integer,
  review_rating real,
  review_count integer,
  recent_review_count_90d integer,
  hiring_signal_count integer,
  website_quality_score integer check (website_quality_score between 0 and 100),
  service_breadth_score integer check (service_breadth_score between 0 and 100),
  growth_signal_score integer check (growth_signal_score between 0 and 100),
  social_activity_score integer check (social_activity_score between 0 and 100),
  contact_confidence_score integer check (contact_confidence_score between 0 and 100),
  has_financing integer,
  decision_maker_found integer,
  residential_focus integer,
  storm_damage_focus integer,
  solar_service integer,
  metal_roofing_service integer,
  metrics_payload text not null default '{}',
  sources_payload text not null default '[]',
  calculated_at text not null default (datetime('now'))
);

create table if not exists company_contacts (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  full_name text,
  title text,
  email text,
  phone text,
  linkedin_url text,
  confidence_score integer check (confidence_score between 0 and 100),
  source_url text,
  created_at text not null default (datetime('now'))
);

create table if not exists company_sources (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  source_type text not null,
  source_url text,
  title text,
  evidence text,
  captured_at text not null default (datetime('now'))
);

create table if not exists enrichment_jobs (
  id text primary key,
  company_id text references companies(id) on delete cascade,
  provider text not null default 'perplexity',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  prompt_version text not null,
  request_payload text not null default '{}',
  response_payload text not null default '{}',
  error_message text,
  queued_at text not null default (datetime('now')),
  started_at text,
  finished_at text
);

create table if not exists ingestion_runs (
  id text primary key,
  source text not null,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  source_zip text,
  search_distance_miles integer,
  started_at text not null default (datetime('now')),
  finished_at text,
  result_payload text not null default '{}',
  error_message text
);

create table if not exists scoring_models (
  id text primary key,
  version text not null unique,
  description text not null,
  weights text not null,
  created_at text not null default (datetime('now'))
);

create table if not exists scoring_results (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  scoring_model_id text references scoring_models(id),
  priority_score real not null,
  raw_score real,
  reasons text not null default '[]',
  score_payload text not null default '{}',
  scored_at text not null default (datetime('now'))
);

create table if not exists shared_notes (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  user_id text references users(id) on delete set null,
  body text not null,
  created_at text not null default (datetime('now'))
);

create table if not exists sales_rep_sessions (
  session_token text primary key,
  created_at text not null default (datetime('now')),
  last_seen_at text not null default (datetime('now'))
);

create table if not exists favorite_companies (
  session_token text not null references sales_rep_sessions(session_token) on delete cascade,
  company_id text not null references companies(id) on delete cascade,
  created_at text not null default (datetime('now')),
  primary key (session_token, company_id)
);

create index if not exists companies_normalized_name_idx on companies(normalized_name);
create index if not exists company_locations_company_id_idx on company_locations(company_id);
create index if not exists gaf_listings_source_idx on gaf_listings(source_zip, search_distance_miles);
create index if not exists company_metrics_company_id_calculated_idx on company_metrics(company_id, calculated_at desc);
create index if not exists scoring_results_company_id_scored_idx on scoring_results(company_id, scored_at desc);
create index if not exists favorite_companies_company_id_idx on favorite_companies(company_id);

drop view if exists ranked_companies_current;

create view ranked_companies_current as
select
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
  sr.priority_score,
  sr.raw_score,
  sr.reasons,
  sr.scored_at
from companies c
left join gaf_listings gl on gl.id = (
  select id
  from gaf_listings
  where company_id = c.id
  order by last_seen_at desc
  limit 1
)
left join scoring_results sr on sr.id = (
  select id
  from scoring_results
  where company_id = c.id
  order by scored_at desc
  limit 1
);
