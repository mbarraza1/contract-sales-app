import { config } from '../config.js';
import { ingestGafContractors } from '../services/gafIngestion.js';
import { enrichGafCacheWithPerplexity } from '../services/perplexityEnrichment.js';

let running = false;

console.log(
  `GAF daily worker scheduled for ${config.gaf.dailyAt} local time. ZIP ${config.seedZip}, ${config.searchDistanceMiles} mi.`
);

if (config.gaf.runOnStart) {
  runOnce();
}

scheduleNextRun();

function scheduleNextRun() {
  const nextRunAt = nextDailyRun(config.gaf.dailyAt);
  const delayMs = nextRunAt.getTime() - Date.now();

  console.log(`Next GAF scrape scheduled for ${nextRunAt.toISOString()}.`);
  setTimeout(async () => {
    await runOnce();
    scheduleNextRun();
  }, delayMs);
}

async function runOnce() {
  if (running) {
    console.warn('Skipping GAF scrape because a previous run is still active.');
    return;
  }

  running = true;
  const startedAt = Date.now();

  try {
    const result = await ingestGafContractors({
      zip: config.seedZip,
      distanceMiles: config.searchDistanceMiles
    });
    if (config.perplexity.enrichAfterGaf) {
      await enrichGafCacheWithPerplexity({
        limit: config.perplexity.enrichLimit,
        concurrency: config.perplexity.enrichConcurrency,
        delayMs: config.perplexity.enrichDelayMs
      });
    }
    const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
    console.log(
      `GAF scrape succeeded: ${result.scrape.listingCount} listings in ${seconds}s. Cache: ${result.cachePath}`
    );
  } catch (error) {
    console.error(`GAF scrape failed: ${error.stack ?? error.message}`);
  } finally {
    running = false;
  }
}

export function nextDailyRun(hhmm, now = new Date()) {
  const match = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  const hour = Number.parseInt(match?.[1] ?? '2', 10);
  const minute = Number.parseInt(match?.[2] ?? '0', 10);
  const next = new Date(now);

  next.setHours(hour, minute, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }

  return next;
}
