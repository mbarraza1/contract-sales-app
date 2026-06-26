# Contractor Sales Intelligence

Shared sales-rep dashboard for ranking roofing contractors near ZIP `10013` within a 25-mile radius. The scoring model produces one overall priority score from account size, contactability, buying signals, service fit, growth, reputation, and purchase-need signals.

## What This MVP Includes

- A runnable Node dashboard with no required install step for demo mode.
- SQLite schema for companies, GAF listings, enrichment metrics, sources, scoring models, and shared notes.
- Seed fixtures that mimic the data shape expected from GAF and Perplexity.
- A Coveo Search API collector for GAF ZIP `10013` / 25-mile residential contractor listings.
- Playwright fallback/profile-detail scraping for fields Coveo does not expose, such as website and full address.
- Perplexity enrichment worker for company size, growth, contactability, buying signals, and source-backed sales research.
- A daily worker entrypoint that runs the GAF scraper once per day.
- One explainable priority score with company-specific Perplexity rationale and driver chips for account scale, contactability, buying signals, service fit, growth, reputation, and purchase need.
- Browser-session favorites: each rep gets a local session token and can save favorite companies across revisits.
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

1. SQLite at `storage/contract-sales.sqlite`, when it contains records.
2. Latest GAF scraper cache at `storage/gaf-contractors-10013.json`.
3. Demo fixtures.

Initialize the local SQLite database:

```bash
npm run db:schema
```

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

The scraper writes a local cache file and upserts the same records into SQLite. The cache remains useful as an auditable raw artifact and as a fallback if the database is empty.

## Run Perplexity Enrichment

Put your key in a local `.env` file. Do not put live keys in `.env.example`.

```text
PERPLEXITY_API_KEY=your_key_here
```

Then run:

```bash
npm run enrich:perplexity
```

Useful settings:

```text
PERPLEXITY_MODEL=sonar-pro
PERPLEXITY_ENRICH_LIMIT=5
PERPLEXITY_ENRICH_CONCURRENCY=1
PERPLEXITY_ENRICH_DELAY_MS=500
PERPLEXITY_ENRICH_AFTER_GAF=false
```

`PERPLEXITY_ENRICH_LIMIT=5` is the default guardrail for cost-controlled validation. Set `PERPLEXITY_ENRICH_LIMIT=0` to enrich every company in the current GAF cache. Set `PERPLEXITY_ENRICH_FORCE=true` when you want to refresh companies that already have Perplexity data.

## SQLite Backfill

After a scrape or enrichment run, backfill the latest cache into SQLite:

```bash
npm run db:backfill
```

Useful setting:

```text
SQLITE_DB_PATH=storage/contract-sales.sqlite
```

## Favorites

The dashboard stores a generated sales-rep session token in browser `localStorage` and sends it as `X-Session-Token`. SQLite stores favorites against that token in `sales_rep_sessions` and `favorite_companies`, so saved companies reappear when the same browser revisits the app.

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
- Buying priority: buying signals, growth signals, service fit, purchase-need signals.
- Reputation: review rating and years in business. GAF status is retained as a minor context signal, not a major ranking driver.
- Contactability: phone, website, owner/contact discovery, email/contact form confidence.
- Source confidence: every enriched metric should keep source URLs and confidence.
- Priority rationale: the table reason should be a short company-specific Perplexity summary first, with score-driver details as supporting context.

## GAF Ingestion Note

The GAF collector uses the same Coveo Search API request shape that the GAF contractor finder sends from the browser. Playwright is still used as a fallback and to bootstrap the public Coveo token when one is not provided. Keep this job polite: run it daily, avoid high profile-page concurrency, and store raw source payloads so matching and scoring can be audited later.

## Next Implementation Steps

1. Add stale-data indicators in the dashboard.
2. Persist Perplexity-enriched contacts into `company_contacts`.
3. Deploy the daily worker alongside the dashboard/API process.
4. Add production monitoring around scrape/enrichment failures and record-count changes.
