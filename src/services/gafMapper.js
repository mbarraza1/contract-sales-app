import { normalizeWhitespace } from './gafParser.js';

export function mapGafListingToCompany(listing) {
  const searchableText = [
    listing.name,
    listing.aboutText,
    ...(listing.certifications ?? []),
    ...(listing.specialties ?? [])
  ].join(' ');

  return {
    id: listing.contractorId ? `gaf-${listing.contractorId}` : slugify(listing.name),
    name: listing.name,
    websiteUrl: listing.websiteUrl,
    phone: listing.phone,
    location: {
      addressLine1: listing.addressLine1,
      city: listing.city,
      state: listing.state,
      postalCode: listing.postalCode,
      distanceMiles: listing.distanceMiles
    },
    gaf: {
      sourceZip: listing.sourceZip,
      searchDistanceMiles: listing.searchDistanceMiles,
      contractorId: listing.contractorId,
      profileUrl: listing.profileUrl,
      certificationLevel: listing.certificationLevel,
      badges: listing.badges ?? [],
      specialties: listing.specialties ?? []
    },
    metrics: {
      employeeCountEstimate: null,
      annualRevenueEstimate: null,
      yearsInBusiness: listing.yearsInBusiness,
      locationCount: null,
      reviewRating: listing.reviewRating,
      reviewCount: listing.reviewCount,
      recentReviewCount90d: null,
      hiringSignalCount: null,
      websiteQualityScore: listing.websiteUrl ? 65 : null,
      websiteFreshnessScore: null,
      serviceBreadthScore: inferServiceBreadthScore(listing),
      growthSignalScore: null,
      socialActivityScore: null,
      contactConfidenceScore: inferContactConfidenceScore(listing),
      hasFinancing: null,
      vendorStackVisible: null,
      decisionMakerFound: null,
      emailFound: null,
      residentialFocus: true,
      stormDamageFocus: /storm|insurance/i.test(searchableText),
      solarService: /solar/i.test(searchableText),
      metalRoofingService: /metal/i.test(searchableText),
      services: inferServices(listing)
    },
    sources: [
      {
        type: 'gaf',
        title: 'GAF contractor profile',
        url: listing.profileUrl
      }
    ],
    lastEnrichedAt: listing.scrapedAt
  };
}

export function mapGafScrapeToCompanies(scrape) {
  return (scrape.listings ?? []).map((listing) =>
    mapGafListingToCompany({
      ...listing,
      sourceZip: listing.sourceZip ?? scrape.sourceZip,
      searchDistanceMiles: listing.searchDistanceMiles ?? scrape.searchDistanceMiles,
      scrapedAt: listing.scrapedAt ?? scrape.scrapedAt
    })
  );
}

export function normalizeCompanyName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalizeCompanyName(value).replace(/\s+/g, '-');
}

function inferServiceBreadthScore(listing) {
  const signalCount = new Set([
    ...(listing.specialties ?? []),
    ...(listing.certifications ?? []),
    ...inferServices(listing)
  ]).size;

  return Math.min(100, 35 + signalCount * 8);
}

function inferContactConfidenceScore(listing) {
  let score = 30;
  if (listing.profileUrl) score += 20;
  if (listing.phone) score += 25;
  if (listing.websiteUrl) score += 20;
  if (listing.addressLine1 && listing.postalCode) score += 5;
  return Math.min(100, score);
}

function inferServices(listing) {
  const text = [
    listing.aboutText,
    ...(listing.specialties ?? []),
    ...(listing.certifications ?? [])
  ]
    .join(' ')
    .toLowerCase();
  const services = ['Residential Roofing'];

  if (text.includes('storm')) services.push('Storm Damage');
  if (text.includes('solar')) services.push('Solar');
  if (text.includes('metal')) services.push('Metal');
  if (text.includes('siding')) services.push('Siding');
  if (text.includes('gutter')) services.push('Gutters');
  if (text.includes('commercial')) services.push('Commercial Roofing');
  if (text.includes('window')) services.push('Windows');
  if (text.includes('skylight')) services.push('Skylights');

  return [...new Set(services)];
}
