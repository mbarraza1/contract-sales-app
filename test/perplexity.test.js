import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizePerplexityData, parseJsonFromContent } from '../src/services/perplexity.js';

test('parses JSON wrapped in markdown fences', () => {
  assert.deepEqual(parseJsonFromContent('```json\n{"employeeCountEstimate": 12}\n```'), {
    employeeCountEstimate: 12
  });
});

test('normalizes Perplexity enrichment fields', () => {
  const normalized = normalizePerplexityData({
    summary: 'Strong regional contractor.',
    priorityRationale: 'High priority because it is large and reachable.',
    employeeCountEstimate: '42',
    websiteQualityScore: 150,
    hasFinancing: true,
    services: ['Roofing', 'Roofing', 'Solar'],
    contacts: [{ fullName: 'Jane Doe', confidenceScore: 88 }],
    sources: [{ url: 'https://example.com', fields: ['employeeCountEstimate'] }]
  });

  assert.equal(normalized.employeeCountEstimate, 42);
  assert.equal(normalized.priorityRationale, 'High priority because it is large and reachable.');
  assert.equal(normalized.websiteQualityScore, 100);
  assert.equal(normalized.hasFinancing, true);
  assert.deepEqual(normalized.services, ['Roofing', 'Solar']);
  assert.equal(normalized.contacts[0].fullName, 'Jane Doe');
  assert.equal(normalized.sources[0].url, 'https://example.com');
});
