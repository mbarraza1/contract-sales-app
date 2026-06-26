import { config } from '../config.js';
import { ingestGafContractors } from '../services/gafIngestion.js';

const startedAt = Date.now();

try {
  const result = await ingestGafContractors({
    zip: config.seedZip,
    distanceMiles: config.searchDistanceMiles
  });

  const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
  console.log(
    JSON.stringify(
      {
        ok: true,
        source: 'gaf',
        zip: result.scrape.sourceZip,
        distanceMiles: result.scrape.searchDistanceMiles,
        listingCount: result.scrape.listingCount,
        database: result.databaseResult ?? 'not_configured',
        cachePath: result.cachePath,
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
        source: 'gaf',
        error: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
