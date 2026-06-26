import { config } from '../config.js';
import { upsertGafScrapeResultsToSqlite } from '../db/sqlite.js';
import { readGafScrapeCache } from '../services/gafIngestion.js';

try {
  const scrape = await readGafScrapeCache(config.gaf.cachePath);
  const stats = await upsertGafScrapeResultsToSqlite(config.sqlitePath, scrape, {
    organizationName: config.organizationName
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        database: 'sqlite',
        databasePath: config.sqlitePath,
        cachePath: config.gaf.cachePath,
        stats
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
        database: 'sqlite',
        error: error.message
      },
      null,
      2
    )
  );
  process.exitCode = 1;
}
