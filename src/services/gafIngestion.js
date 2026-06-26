import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import { upsertGafScrapeResults } from '../db/postgres.js';
import { buildGafSearchUrl, scrapeGafContractors } from '../scrapers/gafScraper.js';
import { searchGafCoveoContractors } from './gafCoveoClient.js';
import { mapGafScrapeToCompanies } from './gafMapper.js';

export { buildGafSearchUrl };

export async function ingestGafContractors({
  zip = config.seedZip,
  distanceMiles = config.searchDistanceMiles,
  databaseUrl = config.databaseUrl,
  cachePath = config.gaf.cachePath,
  logger = console,
  scrapeOptions = {}
} = {}) {
  const scrape =
    config.gaf.dataSource === 'playwright'
      ? await scrapeGafContractors({
          zip,
          distanceMiles,
          logger,
          ...scrapeOptions
        })
      : await searchGafCoveoContractors({
          zip,
          distanceMiles,
          logger,
          ...scrapeOptions
        });

  await writeGafCache(scrape, cachePath);

  let databaseResult = null;
  if (databaseUrl) {
    databaseResult = await upsertGafScrapeResults(databaseUrl, scrape, {
      organizationName: config.organizationName
    });
  }

  return {
    scrape,
    databaseResult,
    cachePath
  };
}

export async function writeGafCache(scrape, cachePath = config.gaf.cachePath) {
  const absolutePath = path.resolve(cachePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, JSON.stringify(scrape, null, 2));
  return absolutePath;
}

export async function loadGafCache(cachePath = config.gaf.cachePath) {
  const payload = JSON.parse(await readFile(path.resolve(cachePath), 'utf8'));
  return mapGafScrapeToCompanies(payload);
}
