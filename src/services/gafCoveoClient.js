import { config } from '../config.js';
import {
  buildGafSearchUrl,
  createGafBrowserContext,
  enrichGafListingsWithProfileDetails,
  newGafPage
} from '../scrapers/gafScraper.js';
import { normalizeGafListing, normalizePhone, parseContractorId } from './gafParser.js';

const COVEO_ORG_ID = 'gafmaterialscorporationproduction3yalqk12';
const COVEO_SEARCH_ENDPOINT = `https://${COVEO_ORG_ID}.org.coveo.com/rest/search/v2?organizationId=${COVEO_ORG_ID}`;
const PIPELINE = 'prod-gaf-recommended-residential-contractors';
const COUNTRY_CODE = 'USA';

const COVEO_FIELDS = [
  'author',
  'language',
  'urihash',
  'objecttype',
  'collection',
  'source',
  'permanentid',
  'gaf_featured_image_src',
  'gaf_featured_image_alt',
  'gaf_contractor_id',
  'gaf_contractor_type',
  'gaf_contractor_dba',
  'gaf_navigation_title',
  'gaf_rating',
  'gaf_number_of_reviews',
  'gaf_f_city',
  'gaf_f_state_code',
  'gaf_f_contractor_designations_residential',
  'gaf_f_contractor_certifications_and_awards_residential',
  'gaf_f_contractor_raq_specialties_residential',
  'gaf_f_contractor_specialties_residential',
  'gaf_phone',
  'uri',
  'gaf_f_contractor_technologies_residential',
  'gaf_latitude',
  'gaf_longitude',
  'distance',
  'distanceinmiles',
  'gaf_postal_code',
  'gaf_f_country_code',
  'gaf_enrolled_in_gaf_leads',
  'UniqueId',
  'Uri'
];

export async function searchGafCoveoContractors({
  zip = config.seedZip,
  distanceMiles = config.searchDistanceMiles,
  maxPages = config.gaf.maxPages,
  pageSize = config.gaf.coveoPageSize,
  includeProfileDetails = config.gaf.scrapeProfileDetails,
  profileConcurrency = config.gaf.profileConcurrency,
  headless = config.gaf.headless,
  token = config.gaf.coveoToken,
  latitude = config.gaf.searchLatitude,
  longitude = config.gaf.searchLongitude,
  logger = console
} = {}) {
  const scrapedAt = new Date().toISOString();
  const coveoToken = token || (await bootstrapCoveoToken({ zip, distanceMiles, headless, logger }));
  const rawListings = [];
  let totalCount = null;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const firstResult = (pageNumber - 1) * pageSize;
    const payload = buildCoveoSearchPayload({
      distanceMiles,
      firstResult,
      latitude,
      longitude,
      pageSize
    });
    const response = await fetch(COVEO_SEARCH_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${coveoToken}`,
        'content-type': 'application/json',
        origin: 'https://www.gaf.com',
        referer: 'https://www.gaf.com/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Coveo search failed with ${response.status}: ${await response.text()}`);
    }

    const body = await response.json();
    totalCount = body.totalCountFiltered ?? body.totalCount ?? totalCount;
    const results = body.results ?? [];
    logger.info(`Coveo page ${pageNumber}: captured ${results.length} results (${totalCount ?? 'unknown'} total).`);

    rawListings.push(
      ...results.map((result, index) =>
        mapCoveoResultToRawListing(result, {
          resultPage: pageNumber,
          resultIndex: firstResult + index + 1
        })
      )
    );

    if (results.length === 0 || (Number.isFinite(totalCount) && rawListings.length >= totalCount)) {
      break;
    }
  }

  if (includeProfileDetails) {
    logger.info(`Scraping ${rawListings.length} GAF profile pages for website/address/details.`);
    await enrichGafListingsWithProfileDetails(rawListings, {
      profileConcurrency,
      headless,
      logger,
      scrapedAt
    });
  }

  const listings = rawListings.map((raw) =>
    normalizeGafListing(raw, {
      zip,
      distanceMiles,
      scrapedAt
    })
  );

  return {
    source: 'gaf_coveo',
    sourceUrl: buildGafSearchUrl({ zip, distanceMiles }),
    coveoEndpoint: COVEO_SEARCH_ENDPOINT,
    sourceZip: zip,
    searchDistanceMiles: distanceMiles,
    scrapedAt,
    totalCount,
    listingCount: listings.length,
    listings
  };
}

export function buildCoveoSearchPayload({ distanceMiles, firstResult, latitude, longitude, pageSize }) {
  return {
    locale: 'en-US',
    debug: false,
    tab: 'defaultTab',
    referrer: 'none',
    timezone: 'America/New_York',
    actionsHistory: [
      {
        name: 'Query',
        time: JSON.stringify(new Date().toISOString())
      }
    ],
    aq: `@distanceinmiles <= ${distanceMiles} AND @gaf_f_country_code = ${COUNTRY_CODE}`,
    context: {
      sortingStrategy: 'gafrecommended-initial'
    },
    fieldsToInclude: COVEO_FIELDS,
    pipeline: PIPELINE,
    q: '',
    enableQuerySyntax: false,
    searchHub: PIPELINE,
    sortCriteria: 'relevancy',
    cq: 'NOT @gaf_content_type=="NO CONTENT TYPE FILTER"',
    numberOfResults: pageSize,
    firstResult,
    facetOptions: {
      freezeFacetOrder: false
    },
    queryFunctions: [
      {
        fieldName: '@distanceinmiles',
        function: `dist(@gaf_latitude, @gaf_longitude, ${latitude}, ${longitude})*0.000621371`
      }
    ]
  };
}

export function mapCoveoResultToRawListing(result, { resultPage, resultIndex } = {}) {
  const raw = result.raw ?? {};
  const profileUrl = result.clickUri ?? raw.uri ?? result.uri ?? null;
  const name = raw.gaf_navigation_title ?? raw.gaf_contractor_dba ?? result.title ?? null;
  const city = raw.gaf_f_city ?? null;
  const state = raw.gaf_f_state_code ?? null;
  const distance = Number.isFinite(Number(raw.distanceinmiles)) ? Number(raw.distanceinmiles) : null;

  return {
    name,
    profileUrl,
    imageUrl: raw.gaf_featured_image_src ?? null,
    postalCode: raw.gaf_postal_code ?? null,
    ratingText: raw.gaf_rating ?? null,
    reviewCountText: raw.gaf_number_of_reviews ?? null,
    locationText: city && state && distance !== null ? `${city}, ${state} - ${roundDistance(distance)} mi` : null,
    phoneHref: raw.gaf_phone ? `tel:${raw.gaf_phone}` : null,
    phoneText: raw.gaf_phone ? `Phone Number:${normalizePhone(raw.gaf_phone)}` : null,
    certifications: toArray(raw.gaf_f_contractor_certifications_and_awards_residential),
    specialties: uniqueSpecialties([
      ...toArray(raw.gaf_f_contractor_raq_specialties_residential),
      ...toArray(raw.gaf_f_contractor_specialties_residential)
    ]),
    coveo: {
      uniqueId: result.uniqueId ?? result.UniqueId ?? null,
      resultIndex,
      raw
    },
    contractorId: raw.gaf_contractor_id ?? parseContractorId(profileUrl),
    resultPage,
    fullText: [name, city, state, raw.gaf_phone].filter(Boolean).join(' ')
  };
}

export async function bootstrapCoveoToken({
  zip = config.seedZip,
  distanceMiles = config.searchDistanceMiles,
  headless = config.gaf.headless,
  logger = console
} = {}) {
  logger.info('Bootstrapping GAF Coveo token from browser request.');
  const { browser, context } = await createGafBrowserContext({ headless });
  const page = await newGafPage(context);

  try {
    const tokenPromise = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes(`${COVEO_ORG_ID}.org.coveo.com/rest/search/v2`) &&
        request.headers().authorization,
      { timeout: 45000 }
    );
    await page.goto(buildGafSearchUrl({ zip, distanceMiles }), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const request = await tokenPromise;
    return request.headers().authorization.replace(/^Bearer\s+/i, '');
  } finally {
    await context.close();
    await browser.close();
  }
}

function toArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function roundDistance(distance) {
  return Math.round(Number(distance) * 10) / 10;
}

function uniqueSpecialties(values) {
  return [...new Set(values.map(normalizeSpecialty).filter(Boolean))];
}

function normalizeSpecialty(value) {
  const normalized = String(value ?? '')
    .replace(/™/g, '')
    .trim();
  const upper = normalized.toUpperCase();

  if (upper === 'SOLAR') return 'Solar';
  if (upper === 'METAL') return 'Metal';
  if (upper === 'FORTIFIED' || upper === 'FORTIFIED ROOF') return 'FORTIFIED Roof';

  return normalized;
}
