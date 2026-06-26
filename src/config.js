import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadEnvFile();

export const config = {
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '127.0.0.1',
  seedZip: process.env.SEED_ZIP ?? '10013',
  searchDistanceMiles: Number.parseInt(process.env.SEARCH_DISTANCE_MILES ?? '25', 10),
  sqlitePath: process.env.SQLITE_DB_PATH ?? 'storage/contract-sales.sqlite',
  organizationName: process.env.ORGANIZATION_NAME ?? 'Default Sales Team',
  scoringModelVersion: 'overall-priority-v3',
  gaf: {
    dataSource: process.env.GAF_DATA_SOURCE ?? 'coveo',
    cachePath: process.env.GAF_CACHE_PATH ?? 'storage/gaf-contractors-10013.json',
    headless: (process.env.GAF_SCRAPE_HEADLESS ?? 'true') !== 'false',
    playwrightChannel: process.env.GAF_PLAYWRIGHT_CHANNEL ?? 'chromium',
    maxPages: Number.parseInt(process.env.GAF_SCRAPE_MAX_PAGES ?? '25', 10),
    coveoToken: process.env.GAF_COVEO_TOKEN ?? '',
    coveoPageSize: Number.parseInt(process.env.GAF_COVEO_PAGE_SIZE ?? '100', 10),
    searchLatitude: Number.parseFloat(process.env.GAF_SEARCH_LATITUDE ?? '40.7157'),
    searchLongitude: Number.parseFloat(process.env.GAF_SEARCH_LONGITUDE ?? '-74'),
    scrapeProfileDetails: (process.env.GAF_SCRAPE_PROFILE_DETAILS ?? 'true') !== 'false',
    profileConcurrency: Number.parseInt(process.env.GAF_PROFILE_CONCURRENCY ?? '2', 10),
    dailyAt: process.env.GAF_SCRAPE_DAILY_AT ?? '02:00',
    runOnStart: (process.env.GAF_SCRAPE_RUN_ON_START ?? 'false') === 'true'
  },
  perplexity: {
    apiKey: process.env.PERPLEXITY_API_KEY ?? '',
    apiUrl: process.env.PERPLEXITY_API_URL ?? 'https://api.perplexity.ai/chat/completions',
    model: process.env.PERPLEXITY_MODEL ?? 'sonar-pro',
    enrichLimit: Number.parseInt(process.env.PERPLEXITY_ENRICH_LIMIT ?? '5', 10),
    enrichConcurrency: Number.parseInt(process.env.PERPLEXITY_ENRICH_CONCURRENCY ?? '1', 10),
    enrichDelayMs: Number.parseInt(process.env.PERPLEXITY_ENRICH_DELAY_MS ?? '500', 10),
    enrichAfterGaf: (process.env.PERPLEXITY_ENRICH_AFTER_GAF ?? 'false') === 'true'
  }
};

function loadEnvFile() {
  const envPath = path.resolve('.env');
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
