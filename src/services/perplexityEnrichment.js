import { config } from '../config.js';
import { upsertGafScrapeResultsToSqlite } from '../db/sqlite.js';
import { mapGafListingToCompany } from './gafMapper.js';
import { readGafScrapeCache, writeGafCache } from './gafIngestion.js';
import { enrichCompanyWithPerplexity } from './perplexity.js';

export async function enrichGafCacheWithPerplexity({
  cachePath = config.gaf.cachePath,
  limit = config.perplexity.enrichLimit,
  concurrency = config.perplexity.enrichConcurrency,
  delayMs = config.perplexity.enrichDelayMs,
  databasePath = config.sqlitePath,
  force = false,
  logger = console
} = {}) {
  if (!config.perplexity.apiKey) {
    throw new Error('PERPLEXITY_API_KEY is required. Put it in .env or export it in the shell.');
  }

  const scrape = await readGafScrapeCache(cachePath);
  const candidates = (scrape.listings ?? []).filter((listing) => force || !listing.perplexityEnrichment?.data);
  const selected = limit > 0 ? candidates.slice(0, limit) : candidates;
  const stats = {
    totalListings: scrape.listings?.length ?? 0,
    eligible: candidates.length,
    selected: selected.length,
    succeeded: 0,
    failed: 0,
    skipped: Math.max(0, candidates.length - selected.length)
  };

  if (selected.length === 0) {
    return { scrape, stats, cachePath };
  }

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, selected.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < selected.length) {
        const listing = selected[cursor];
        cursor += 1;
        await enrichListing(scrape, listing, {
          cachePath,
          delayMs,
          logger,
          stats
        });
      }
    })
  );

  let databaseResult = null;
  if (databasePath && stats.succeeded > 0) {
    databaseResult = await upsertGafScrapeResultsToSqlite(databasePath, scrape, {
      organizationName: config.organizationName
    });
  }

  return { scrape, stats, cachePath, databaseResult };
}

async function enrichListing(scrape, listing, { cachePath, delayMs, logger, stats }) {
  const company = mapGafListingToCompany({
    ...listing,
    sourceZip: listing.sourceZip ?? scrape.sourceZip,
    searchDistanceMiles: listing.searchDistanceMiles ?? scrape.searchDistanceMiles,
    scrapedAt: listing.scrapedAt ?? scrape.scrapedAt
  });

  try {
    logger.info(`Enriching with Perplexity: ${company.name}`);
    listing.perplexityEnrichment = await enrichCompanyWithPerplexity(company);
    delete listing.perplexityEnrichmentError;
    stats.succeeded += 1;
  } catch (error) {
    listing.perplexityEnrichmentError = {
      failedAt: new Date().toISOString(),
      message: error.message
    };
    stats.failed += 1;
    logger.warn(`Perplexity enrichment failed for ${company.name}: ${error.message}`);
  }

  await writeGafCache(scrape, cachePath);

  if (delayMs > 0) {
    await pause(delayMs);
  }
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
