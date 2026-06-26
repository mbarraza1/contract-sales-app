import { config } from '../config.js';
import { enrichGafCacheWithPerplexity } from '../services/perplexityEnrichment.js';

const startedAt = Date.now();

try {
  const result = await enrichGafCacheWithPerplexity({
    limit: config.perplexity.enrichLimit,
    concurrency: config.perplexity.enrichConcurrency,
    delayMs: config.perplexity.enrichDelayMs,
    force: (process.env.PERPLEXITY_ENRICH_FORCE ?? 'false') === 'true'
  });
  const seconds = Math.round((Date.now() - startedAt) / 100) / 10;

  console.log(
    JSON.stringify(
      {
        ok: true,
        provider: 'perplexity',
        model: config.perplexity.model,
        cachePath: result.cachePath,
        database: result.databaseResult ?? 'not_configured',
        stats: result.stats,
        seconds
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        provider: 'perplexity',
        error: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
