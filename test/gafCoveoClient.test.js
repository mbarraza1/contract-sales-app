import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCoveoSearchPayload, mapCoveoResultToRawListing } from '../src/services/gafCoveoClient.js';

test('builds Coveo payload with distance query function', () => {
  const payload = buildCoveoSearchPayload({
    distanceMiles: 25,
    firstResult: 0,
    latitude: 40.7157,
    longitude: -74,
    pageSize: 100
  });

  assert.equal(payload.numberOfResults, 100);
  assert.equal(payload.aq, '@distanceinmiles <= 25 AND @gaf_f_country_code = USA');
  assert.equal(payload.pipeline, 'prod-gaf-recommended-residential-contractors');
  assert.match(payload.queryFunctions[0].function, /40\.7157, -74/);
});

test('maps Coveo contractor result into scraper raw listing shape', () => {
  const rawListing = mapCoveoResultToRawListing(
    {
      title: 'Preferred Exterior Corp',
      clickUri:
        'https://www.gaf.com/en-us/roofing-contractors/residential/usa/ny/new-hyde-park/preferred-exterior-corp-1004859',
      raw: {
        gaf_contractor_id: '1004859',
        gaf_navigation_title: 'Preferred Exterior Corp',
        gaf_rating: 5,
        gaf_number_of_reviews: 49,
        gaf_f_city: 'New Hyde Park',
        gaf_f_state_code: 'NY',
        distanceinmiles: 17.046,
        gaf_phone: '(516) 354-7252',
        gaf_f_contractor_certifications_and_awards_residential: ["President's Club Award", 'GAF Master Elite®'],
        gaf_f_contractor_raq_specialties_residential: ['SOLAR'],
        gaf_f_contractor_specialties_residential: ['Solar']
      }
    },
    {
      resultPage: 1,
      resultIndex: 1
    }
  );

  assert.equal(rawListing.name, 'Preferred Exterior Corp');
  assert.equal(rawListing.contractorId, '1004859');
  assert.equal(rawListing.locationText, 'New Hyde Park, NY - 17 mi');
  assert.deepEqual(rawListing.specialties, ['Solar']);
  assert.equal(rawListing.phoneText, 'Phone Number:(516) 354-7252');
});
