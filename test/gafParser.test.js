import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizePhone,
  parseAddress,
  parseCityStateDistance,
  parseContractorId,
  parseReviewCount,
  parseYearsInBusiness
} from '../src/services/gafParser.js';

test('parses GAF listing location text', () => {
  assert.deepEqual(parseCityStateDistance('New Hyde Park, NY - 17.0 mi'), {
    city: 'New Hyde Park',
    state: 'NY',
    distanceMiles: 17
  });
});

test('parses contractor id from GAF profile URL', () => {
  assert.equal(
    parseContractorId('https://www.gaf.com/en-us/roofing-contractors/residential/usa/ny/foo/bar-baz-1004859'),
    '1004859'
  );
});

test('normalizes phone numbers', () => {
  assert.equal(normalizePhone('tel:+15165495474'), '(516) 549-5474');
  assert.equal(normalizePhone('(516) 354-7252'), '(516) 354-7252');
});

test('parses profile address and years in business', () => {
  assert.deepEqual(parseAddress('1998 Hillside Ave, New Hyde Park NY, 11040 USA'), {
    addressLine1: '1998 Hillside Ave',
    city: 'New Hyde Park',
    state: 'NY',
    postalCode: '11040',
    country: 'US'
  });
  assert.equal(parseYearsInBusiness('In business since 1969', 2026), 57);
});

test('parses review counts', () => {
  assert.equal(parseReviewCount('(469)'), 469);
});
