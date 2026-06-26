import { chromium } from 'playwright';

import { config } from '../config.js';
import { normalizeGafListing, parseAddress, parseYearsInBusiness } from '../services/gafParser.js';

const BASE_URL = 'https://www.gaf.com/en-us/roofing-contractors/residential';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export function buildGafSearchUrl({
  zip = config.seedZip,
  distanceMiles = config.searchDistanceMiles
} = {}) {
  const url = new URL(BASE_URL);
  url.searchParams.set('distance', String(distanceMiles));
  url.searchParams.set('postalCode', zip);
  return url.toString();
}

export async function scrapeGafContractors({
  zip = config.seedZip,
  distanceMiles = config.searchDistanceMiles,
  maxPages = config.gaf.maxPages,
  includeProfileDetails = config.gaf.scrapeProfileDetails,
  profileConcurrency = config.gaf.profileConcurrency,
  headless = config.gaf.headless,
  logger = console
} = {}) {
  const scrapedAt = new Date().toISOString();
  const { browser, context } = await createGafBrowserContext({ headless });
  const page = await newGafPage(context);
  page.setDefaultTimeout(30000);

  try {
    await page.goto(buildGafSearchUrl({ zip, distanceMiles }), { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page);
    await refineSearch(page, { zip, distanceMiles });

    const rawListings = await scrapeListingPages(page, { maxPages, logger });
    if (includeProfileDetails) {
      logger.info(`Scraping ${rawListings.length} GAF profile pages for website/address/details.`);
      await enrichWithProfileDetails(context, rawListings, { concurrency: profileConcurrency, logger, scrapedAt });
    }

    const listings = rawListings.map((raw) =>
      normalizeGafListing(raw, {
        zip,
        distanceMiles,
        scrapedAt
      })
    );

    return {
      source: 'gaf',
      sourceUrl: page.url(),
      sourceZip: zip,
      searchDistanceMiles: distanceMiles,
      scrapedAt,
      listingCount: listings.length,
      listings
    };
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function createGafBrowserContext({ headless = config.gaf.headless } = {}) {
  const browser = await chromium.launch({
    headless,
    channel: config.gaf.playwrightChannel || undefined,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    locale: 'en-US',
    userAgent: USER_AGENT,
    viewport: { width: 1365, height: 900 }
  });

  return { browser, context };
}

export async function newGafPage(context) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false
    });
  });
  return page;
}

export async function enrichGafListingsWithProfileDetails(
  listings,
  {
    profileConcurrency = config.gaf.profileConcurrency,
    headless = config.gaf.headless,
    logger = console,
    scrapedAt = new Date().toISOString()
  } = {}
) {
  if (listings.length === 0) return listings;

  const { browser, context } = await createGafBrowserContext({ headless });
  try {
    await enrichWithProfileDetails(context, listings, {
      concurrency: profileConcurrency,
      logger,
      scrapedAt
    });
    return listings;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function refineSearch(page, { zip, distanceMiles }) {
  const zipInput = page.locator('input.zip-form__zip-input, input[name^="select-zip"]').first();
  await zipInput.waitFor({ state: 'visible' });

  const currentZip = await zipInput.inputValue();
  if (currentZip !== zip) {
    await zipInput.fill(zip);
  }

  const distanceSelect = page.locator('select[name^="select-distance"]').first();
  if ((await distanceSelect.count()) > 0) {
    await distanceSelect.selectOption(String(distanceMiles));
  }

  const summaryBefore = await getSummaryText(page);
  const submitButton = page.locator('.field__input-search[type="submit"], button.field__input-search').first();

  if ((await submitButton.count()) > 0) {
    await submitButton.click();
    await waitForResultsToSettle(page, summaryBefore);
  } else {
    await page.keyboard.press('Enter');
    await waitForResultsToSettle(page, summaryBefore);
  }
}

async function scrapeListingPages(page, { maxPages, logger }) {
  const seenProfiles = new Set();
  const listings = [];

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    await page.waitForSelector('.certification-card', { timeout: 45000 });
    const pageListings = await extractCurrentPageListings(page);

    for (const listing of pageListings) {
      const key = listing.profileUrl ?? `${listing.name}-${listing.locationText}`;
      if (!seenProfiles.has(key)) {
        seenProfiles.add(key);
        listings.push({
          ...listing,
          resultPage: pageNumber
        });
      }
    }

    logger.info(`GAF page ${pageNumber}: captured ${pageListings.length} cards (${listings.length} unique).`);

    const nextButton = page.locator('.pagination__next').first();
    if ((await nextButton.count()) === 0 || (await nextButton.isDisabled())) {
      break;
    }

    const firstProfileBefore = pageListings[0]?.profileUrl ?? '';
    await nextButton.click();
    await page.waitForFunction(
      (previousUrl) => {
        const first = document.querySelector('.certification-card a[href*="/roofing-contractors/residential/"]');
        return first?.href && first.href !== previousUrl;
      },
      firstProfileBefore,
      { timeout: 30000 }
    );
  }

  return listings;
}

async function extractCurrentPageListings(page) {
  return page.$$eval('.certification-card', (cards) =>
    cards.map((card) => {
      const text = (selector) => card.querySelector(selector)?.textContent?.trim().replace(/\s+/g, ' ') ?? null;
      const attr = (selector, name) => card.querySelector(selector)?.getAttribute(name) ?? null;
      const profileLink = card.querySelector('a[href*="/roofing-contractors/residential/"]');
      const phoneLink = card.querySelector('a[href^="tel:"]');

      return {
        name: text('.certification-card__heading'),
        profileUrl: profileLink?.href ?? null,
        dataLayer: profileLink?.getAttribute('data-layer') ?? null,
        imageUrl: attr('img', 'src'),
        ratingText: text('.rating-stars__average'),
        reviewCountText: text('.rating-stars__total'),
        locationText: text('.certification-card__city'),
        phoneHref: phoneLink?.getAttribute('href') ?? null,
        phoneText: phoneLink?.textContent?.trim().replace(/\s+/g, ' ') ?? null,
        certifications: Array.from(card.querySelectorAll('.certification-card__certification')).map((item) =>
          item.textContent.trim().replace(/\s+/g, ' ')
        ),
        fullText: card.textContent.trim().replace(/\s+/g, ' ')
      };
    })
  );
}

async function enrichWithProfileDetails(context, listings, { concurrency, logger, scrapedAt }) {
  const queue = [...listings];
  const workerCount = Math.max(1, Math.min(concurrency, 5, queue.length));

  await Promise.all(
    Array.from({ length: workerCount }, async (_, workerIndex) => {
      while (queue.length > 0) {
        const listing = queue.shift();
        if (!listing?.profileUrl) continue;

        try {
          listing.profileDetails = await scrapeProfileDetails(context, listing.profileUrl, scrapedAt);
          mergeProfileDetails(listing);
        } catch (error) {
          logger.warn(`Profile scrape failed for ${listing.name} (${listing.profileUrl}): ${error.message}`);
          listing.profileDetails = {
            error: error.message
          };
        }

        if (workerIndex === 0) {
          await pause(350);
        }
      }
    })
  );
}

async function scrapeProfileDetails(context, profileUrl, scrapedAt) {
  const page = await newGafPage(context);
  page.setDefaultTimeout(25000);

  try {
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await dismissCookieBanner(page);
    await page.waitForSelector('h1', { timeout: 25000 });
    await page.waitForTimeout(800);

    return page.evaluate((capturedAt) => {
      const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const lines = document.body.innerText
        .split('\n')
        .map(clean)
        .filter(Boolean);
      const findLine = (pattern) => lines.find((line) => pattern.test(line)) ?? null;
      const websiteUrl =
        Array.from(document.querySelectorAll('a[href]')).find((anchor) => /visit website/i.test(anchor.textContent))?.href ??
        null;
      const phone =
        Array.from(document.querySelectorAll('a[href^="tel:"]')).find((anchor) => /phone/i.test(anchor.textContent))?.href ??
        null;
      const addressText = findLine(/\b[A-Z]{2},?\s+\d{5}(?:-\d{4})?\s+USA\b/);
      const yearsText = findLine(/In business since\s+\d{4}/i);
      const contractorIdText = lines[lines.findIndex((line) => /^Contractor ID$/i.test(line)) + 1] ?? null;
      const aboutStart = lines.findIndex((line) => /^About$/i.test(line));
      const aboutEnd = lines.findIndex((line, index) => index > aboutStart && /^Expand to read more|Certifications & Awards$/i.test(line));
      const aboutText = aboutStart >= 0 ? lines.slice(aboutStart + 1, aboutEnd > aboutStart ? aboutEnd : aboutStart + 8).join(' ') : '';

      return {
        capturedAt,
        websiteUrl,
        phone,
        addressText,
        yearsText,
        contractorId: /^\d+$/.test(contractorIdText ?? '') ? contractorIdText : null,
        aboutText
      };
    }, scrapedAt);
  } finally {
    await page.close();
  }
}

function mergeProfileDetails(listing) {
  const details = listing.profileDetails;
  if (!details) return;

  const address = parseAddress(details.addressText);
  listing.websiteUrl = details.websiteUrl ?? listing.websiteUrl ?? null;
  listing.phone = details.phone ?? listing.phone;
  listing.contractorId = details.contractorId ?? listing.contractorId;
  listing.addressLine1 = address?.addressLine1 ?? listing.addressLine1;
  listing.city = address?.city ?? listing.city;
  listing.state = address?.state ?? listing.state;
  listing.postalCode = address?.postalCode ?? listing.postalCode;
  listing.yearsInBusiness = parseYearsInBusiness(details.yearsText);
  listing.aboutText = details.aboutText ?? '';
}

async function dismissCookieBanner(page) {
  const closeButton = page.locator('.onetrust-close-btn-handler, #onetrust-reject-all-handler').first();
  try {
    if ((await closeButton.count()) > 0 && (await closeButton.isVisible())) {
      await closeButton.click({ timeout: 2000 });
    }
  } catch {
    // Cookie banners are non-critical for scraping.
  }
}

async function waitForResultsToSettle(page, summaryBefore) {
  await page.waitForSelector('.certification-card, .contractor-listing__summary', { timeout: 45000 });
  await page.waitForFunction(
    (previousSummary) => {
      const summary = document.querySelector('.contractor-listing__summary')?.textContent?.trim();
      const cards = document.querySelectorAll('.certification-card').length;
      return cards > 0 && (!previousSummary || summary !== previousSummary || summary?.length > 0);
    },
    summaryBefore,
    { timeout: 45000 }
  );
}

async function getSummaryText(page) {
  try {
    return await page.locator('.contractor-listing__summary').first().textContent({ timeout: 1500 });
  } catch {
    return '';
  }
}

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
