# Contractor Sales Intelligence

Shared sales-rep dashboard for ranking roofing contractors near ZIP `10013` within a 25-mile radius. The scoring model prioritizes companies that are most likely to buy first, then uses company size as the tie-breaker.

## What This MVP Includes

- A runnable Node dashboard with no required install step for demo mode.
- PostgreSQL schema for companies, GAF listings, enrichment metrics, sources, scoring models, and shared notes.
- Seed fixtures that mimic the data shape expected from GAF and Perplexity.
- A Coveo Search API collector for GAF ZIP `10013` / 25-mile residential contractor listings.
- Playwright fallback/profile-detail scraping for fields Coveo does not expose, such as website and full address.
- A daily worker entrypoint that runs the GAF scraper once per day.
- Explainable scoring logic:
  - 65 points: likely-to-buy score
  - 25 points: company size / account value
  - 10 points: contactability
- API endpoints for ranked companies, details, config, and market summary.
- Service scaffolds for GAF ingestion and Perplexity enrichment.

## Run Locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

The app uses this data order:

1. PostgreSQL, when `DATABASE_URL` is configured and contains records.
2. Latest GAF scraper cache at `storage/gaf-contractors-10013.json`.
3. Demo fixtures.

## Run the GAF Scraper

One-time scrape:

```bash
npm run scrape:gaf
```

Daily worker:

```bash
npm run worker:gaf-daily
```

By default, the daily worker runs once per day at `02:00` local time. Set `GAF_SCRAPE_RUN_ON_START=true` when you want the worker to scrape immediately on boot and then continue with the daily schedule.

Useful settings:

```text
SEED_ZIP=10013
SEARCH_DISTANCE_MILES=25
GAF_DATA_SOURCE=coveo
GAF_COVEO_TOKEN=
GAF_COVEO_PAGE_SIZE=100
GAF_SEARCH_LATITUDE=40.7157
GAF_SEARCH_LONGITUDE=-74
GAF_SCRAPE_MAX_PAGES=25
GAF_SCRAPE_PROFILE_DETAILS=true
GAF_PROFILE_CONCURRENCY=2
GAF_SCRAPE_DAILY_AT=02:00
```

The default `GAF_DATA_SOURCE=coveo` mirrors the Coveo Search V2 request used by the GAF page. If `GAF_COVEO_TOKEN` is blank, the job briefly opens the GAF page with Playwright and captures the public Coveo bearer token from the browser request, then fetches the contractor result pages directly from Coveo. Set `GAF_DATA_SOURCE=playwright` only to fall back to rendered-page card scraping.

The scraper writes a local cache file even when Postgres is not configured, so the dashboard can show real GAF records during local development. When `DATABASE_URL` is set, the same scrape is also upserted into PostgreSQL.

## Optional PostgreSQL Setup

Install dependencies first:

```bash
npm install
```

Create and migrate the database:

```bash
createdb contract_sales
DATABASE_URL=postgres://postgres:postgres@localhost:5432/contract_sales npm run db:schema
```

Start with the database enabled:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/contract_sales npm start
```

## Data Flow

```text
GAF contractor finder / Coveo Search API
  -> raw Coveo listing records
  -> optional GAF profile detail scrape via Playwright
  -> local cache for development
  -> company deduplication
  -> Perplexity enrichment jobs
  -> structured metrics with source URLs
  -> scoring run
  -> shared ranked dashboard
```

## Important Sales Metrics

- Company size: employees, revenue estimate, location count, review volume.
- Buying likelihood: recent activity, growth signals, service fit, purchase-need signals.
- Reputation: review rating, GAF status, awards, years in business.
- Contactability: phone, website, owner/contact discovery, email/contact form confidence.
- Source confidence: every enriched metric should keep source URLs and confidence.

## GAF Ingestion Note

The GAF collector uses the same Coveo Search API request shape that the GAF contractor finder sends from the browser. Playwright is still used as a fallback and to bootstrap the public Coveo token when one is not provided. Keep this job polite: run it daily, avoid high profile-page concurrency, and store raw source payloads so matching and scoring can be audited later.

## Next Implementation Steps

1. Add the Perplexity API key and save structured enrichment results into `company_metrics` and `company_sources`.
2. Add stale-data indicators in the dashboard.
3. Deploy the daily worker alongside the dashboard/API process.
4. Add production monitoring around scrape failures and record-count changes.
