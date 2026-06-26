import assert from 'node:assert/strict';
import test from 'node:test';

import { seedCompanies } from '../src/data/seedCompanies.js';
import { HIGH_PRIORITY_THRESHOLD, scoreCompanies, scoreCompany, scoringWeights } from '../src/scoring.js';

test('scores companies with one overall priority score and explanatory drivers', () => {
  const [company] = seedCompanies;
  const scored = scoreCompany(company);

  assert.equal(typeof scored.score.totalScore, 'number');
  assert.equal(typeof scored.score.priorityScore, 'number');
  assert.equal(scored.score.totalScore, scored.score.priorityScore);
  assert.equal(scored.score.buyingLikelihoodScore, undefined);
  assert.equal(scored.score.companySizeScore, undefined);
  assert.equal(scored.score.contactabilityScore, undefined);
  assert.equal(typeof scored.score.drivers.companyScale, 'number');
  assert.equal(typeof scored.score.drivers.contactability, 'number');
  assert.equal(typeof scored.score.drivers.buyingSignals, 'number');
  assert.ok(scored.score.totalScore > 0);
  assert.ok(scored.score.reasons.length > 0);
});

test('sorts scored companies by total priority descending', () => {
  const scored = scoreCompanies(seedCompanies);

  for (let index = 1; index < scored.length; index += 1) {
    assert.ok(scored[index - 1].score.totalScore >= scored[index].score.totalScore);
  }
});

test('uses one weighted priority model across sales metrics', () => {
  assert.deepEqual(scoringWeights, {
    companyScale: 30,
    contactability: 16,
    buyingSignals: 14,
    serviceFit: 12,
    growth: 10,
    reputation: 8,
    purchaseNeed: 8,
    certification: 1,
    socialActivity: 1
  });
  assert.equal(Object.values(scoringWeights).reduce((sum, weight) => sum + weight, 0), 100);
});

test('keeps certification and social activity as minor scoring signals', () => {
  const base = buildScoringCompany({
    gaf: { certificationLevel: null },
    metrics: {
      socialActivityScore: 0
    }
  });
  const boosted = buildScoringCompany({
    gaf: { certificationLevel: "President's Club Award" },
    metrics: {
      socialActivityScore: 100
    }
  });

  const baseScore = scoreCompany(base).score.totalScore;
  const boostedScore = scoreCompany(boosted).score.totalScore;

  assert.ok(boostedScore > baseScore);
  assert.ok(boostedScore - baseScore <= 2);
});

test('large contactable companies outrank small companies with stronger certification/social signals', () => {
  const smallCertified = buildScoringCompany({
    id: 'small-certified',
    name: 'Small Certified Roofer',
    phone: null,
    websiteUrl: null,
    gaf: {
      certificationLevel: "President's Club Award"
    },
    metrics: {
      employeeCountEstimate: 8,
      annualRevenueEstimate: 900000,
      locationCount: 1,
      reviewCount: 35,
      recentReviewCount90d: 2,
      socialActivityScore: 100,
      contactConfidenceScore: 25,
      decisionMakerFound: false,
      emailFound: false
    }
  });
  const largeReachable = buildScoringCompany({
    id: 'large-reachable',
    name: 'Large Reachable Roofer',
    phone: '(212) 555-0199',
    websiteUrl: 'https://example.com',
    gaf: {
      certificationLevel: null
    },
    metrics: {
      employeeCountEstimate: 120,
      annualRevenueEstimate: 18000000,
      locationCount: 4,
      reviewCount: 650,
      recentReviewCount90d: 5,
      socialActivityScore: 0,
      contactConfidenceScore: 92,
      decisionMakerFound: true,
      emailFound: true
    }
  });

  const ranked = scoreCompanies([smallCertified, largeReachable]);

  assert.equal(ranked[0].id, 'large-reachable');
});

test('strong mid-market sales targets can clear high priority', () => {
  const scored = scoreCompany(
    buildScoringCompany({
      buyingSignals: Array.from({ length: 7 }, (_, index) => `Signal ${index + 1}`),
      metrics: {
        employeeCountEstimate: 55,
        annualRevenueEstimate: 9000000,
        locationCount: 2,
        reviewCount: 300,
        reviewRating: 4.7,
        contactConfidenceScore: 90,
        decisionMakerFound: true,
        emailFound: true,
        serviceBreadthScore: 85,
        growthSignalScore: 70
      }
    })
  );

  assert.ok(scored.score.priorityScore >= HIGH_PRIORITY_THRESHOLD);
});

test('uses company-specific Perplexity rationale as the first reason', () => {
  const scored = scoreCompany(
    buildScoringCompany({
      priorityRationale:
        'Prioritize Atlas Roofing because it has multiple locations, strong review volume, and a named owner contact.'
    })
  );

  assert.equal(
    scored.score.reasons[0],
    'Prioritize Atlas Roofing because it has multiple locations, strong review volume, and a named owner contact.'
  );
});

test('falls back to Perplexity sales summary when no explicit rationale exists', () => {
  const scored = scoreCompany(
    buildScoringCompany({
      salesSummary: 'Atlas Roofing is a growing multi-service contractor with strong local review volume.'
    })
  );

  assert.match(scored.score.reasons[0], /^Atlas Roofing is a growing multi-service contractor/);
  assert.match(scored.score.reasons[0], /Key drivers:/);
});

function buildScoringCompany(overrides = {}) {
  return {
    id: overrides.id ?? 'scoring-company',
    name: overrides.name ?? 'Scoring Company',
    phone: overrides.phone ?? '(212) 555-0100',
    websiteUrl: overrides.websiteUrl ?? 'https://example.com',
    location: {
      city: 'New York',
      state: 'NY',
      distanceMiles: 3
    },
    gaf: {
      certificationLevel: 'Certified',
      specialties: ['Residential Roofing'],
      ...(overrides.gaf ?? {})
    },
    metrics: {
      employeeCountEstimate: 50,
      annualRevenueEstimate: 8000000,
      yearsInBusiness: 12,
      locationCount: 2,
      reviewRating: 4.6,
      reviewCount: 250,
      recentReviewCount90d: 8,
      hiringSignalCount: 1,
      websiteQualityScore: 70,
      websiteFreshnessScore: 70,
      serviceBreadthScore: 70,
      growthSignalScore: 55,
      socialActivityScore: 40,
      contactConfidenceScore: 75,
      hasFinancing: false,
      vendorStackVisible: false,
      decisionMakerFound: true,
      emailFound: true,
      residentialFocus: true,
      stormDamageFocus: true,
      solarService: false,
      metalRoofingService: false,
      services: ['Residential Roofing'],
      ...(overrides.metrics ?? {})
    },
    buyingSignals: overrides.buyingSignals ?? [
      'Multi-service contractor',
      'Reachable contact path',
      'Visible customer demand'
    ],
    priorityRationale: overrides.priorityRationale ?? null,
    salesSummary: overrides.salesSummary ?? null,
    contacts: overrides.contacts ?? []
  };
}
