import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  loadCompaniesFromSqlite,
  loadFavoriteCompanyIds,
  setFavoriteCompany,
  upsertGafScrapeResultsToSqlite
} from '../src/db/sqlite.js';

test('upserts and loads enriched GAF companies from SQLite', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'contract-sales-sqlite-'));
  const databasePath = path.join(tempDir, 'test.sqlite');

  try {
    await upsertGafScrapeResultsToSqlite(databasePath, buildScrape(), {
      organizationName: 'Test Team'
    });

    const companies = await loadCompaniesFromSqlite(databasePath);
    assert.equal(companies.length, 1);

    const [company] = companies;
    assert.equal(company.id, 'gaf-123');
    assert.equal(company.name, 'Signal Roofing LLC');
    assert.equal(company.gaf.certificationLevel, 'Master Elite');
    assert.deepEqual(company.gaf.badges, ['Master Elite']);
    assert.equal(company.metrics.employeeCountEstimate, 42);
    assert.equal(company.metrics.annualRevenueEstimate, 6500000);
    assert.equal(company.metrics.emailFound, true);
    assert.equal(company.salesSummary, 'Growing residential roofer with visible service expansion.');
    assert.equal(company.priorityRationale, 'Prioritize Signal Roofing because it has strong growth, broad services, and a reachable owner contact.');
    assert.deepEqual(company.buyingSignals, ['Recently expanded gutter services']);
    assert.deepEqual(company.riskFlags, ['No public ownership change found']);
    assert.equal(company.contacts[0].fullName, 'Jamie Founder');
    assert.equal(company.sources[1].title, 'Company website');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('stores favorite companies by sales rep session token', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'contract-sales-favorites-'));
  const databasePath = path.join(tempDir, 'test.sqlite');
  const sessionToken = 'rep-test-session-token-123456';

  try {
    await upsertGafScrapeResultsToSqlite(databasePath, buildScrape(), {
      organizationName: 'Test Team'
    });

    assert.deepEqual(await loadFavoriteCompanyIds(databasePath, sessionToken), []);

    const favorited = await setFavoriteCompany(databasePath, sessionToken, 'gaf-123', true);
    assert.equal(favorited.favorite, true);
    assert.deepEqual(favorited.favoriteCompanyIds, ['gaf-123']);
    assert.deepEqual(await loadFavoriteCompanyIds(databasePath, sessionToken), ['gaf-123']);

    const unfavorited = await setFavoriteCompany(databasePath, sessionToken, 'gaf-123', false);
    assert.equal(unfavorited.favorite, false);
    assert.deepEqual(unfavorited.favoriteCompanyIds, []);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function buildScrape() {
  return {
    sourceZip: '10013',
    searchDistanceMiles: 25,
    sourceUrl: 'https://www.gaf.com/en-us/roofing-contractors/residential?distance=25',
    scrapedAt: '2026-06-26T12:00:00.000Z',
    listings: [
      {
        contractorId: '123',
        name: 'Signal Roofing LLC',
        websiteUrl: 'https://example.com',
        phone: '(212) 555-0100',
        addressLine1: '1 Test Ave',
        city: 'New York',
        state: 'NY',
        postalCode: '10013',
        distanceMiles: 2.4,
        profileUrl: 'https://www.gaf.com/en-us/roofing-contractors/residential/signal-roofing-123',
        certificationLevel: 'Master Elite',
        badges: ['Master Elite'],
        specialties: ['Residential Roofing'],
        reviewRating: 4.8,
        reviewCount: 125,
        perplexityEnrichment: {
          enrichedAt: '2026-06-26T12:30:00.000Z',
          data: {
            summary: 'Growing residential roofer with visible service expansion.',
            priorityRationale:
              'Prioritize Signal Roofing because it has strong growth, broad services, and a reachable owner contact.',
            employeeCountEstimate: 42,
            annualRevenueEstimate: 6500000,
            yearsInBusiness: 14,
            locationCount: 2,
            recentReviewCount90d: 9,
            hiringSignalCount: 1,
            websiteQualityScore: 82,
            websiteFreshnessScore: 76,
            serviceBreadthScore: 74,
            growthSignalScore: 68,
            socialActivityScore: 55,
            contactConfidenceScore: 91,
            hasFinancing: true,
            vendorStackVisible: false,
            decisionMakerFound: true,
            emailFound: true,
            residentialFocus: true,
            stormDamageFocus: true,
            solarService: false,
            metalRoofingService: false,
            services: ['Residential Roofing', 'Gutters'],
            contacts: [
              {
                fullName: 'Jamie Founder',
                title: 'Owner',
                email: 'jamie@example.com'
              }
            ],
            buyingSignals: ['Recently expanded gutter services'],
            riskFlags: ['No public ownership change found'],
            sources: [
              {
                title: 'Company website',
                url: 'https://example.com',
                fields: ['services']
              }
            ]
          }
        }
      }
    ]
  };
}
