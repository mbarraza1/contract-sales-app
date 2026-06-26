import assert from 'node:assert/strict';
import test from 'node:test';

import { seedCompanies } from '../src/data/seedCompanies.js';
import { scoreCompanies, scoreCompany } from '../src/scoring.js';

test('scores companies with the expected weighted fields', () => {
  const [company] = seedCompanies;
  const scored = scoreCompany(company);

  assert.equal(typeof scored.score.totalScore, 'number');
  assert.equal(typeof scored.score.buyingLikelihoodScore, 'number');
  assert.equal(typeof scored.score.companySizeScore, 'number');
  assert.equal(typeof scored.score.contactabilityScore, 'number');
  assert.ok(scored.score.totalScore > 0);
  assert.ok(scored.score.reasons.length > 0);
});

test('sorts scored companies by total priority descending', () => {
  const scored = scoreCompanies(seedCompanies);

  for (let index = 1; index < scored.length; index += 1) {
    assert.ok(scored[index - 1].score.totalScore >= scored[index].score.totalScore);
  }
});
