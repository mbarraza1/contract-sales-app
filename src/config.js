export const config = {
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '127.0.0.1',
  seedZip: process.env.SEED_ZIP ?? '10013',
  searchDistanceMiles: Number.parseInt(process.env.SEARCH_DISTANCE_MILES ?? '25', 10),
  databaseUrl: process.env.DATABASE_URL ?? '',
  organizationName: process.env.ORGANIZATION_NAME ?? 'Default Sales Team',
  scoringModelVersion: 'likely-to-buy-size-v1',
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
    model: process.env.PERPLEXITY_MODEL ?? 'sonar-pro'
  }
};
