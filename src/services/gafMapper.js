import { normalizeWhitespace } from './gafParser.js';

export function mapGafListingToCompany(listing) {
  const enrichment = listing.perplexityEnrichment?.data ?? {};
  const searchableText = [
    listing.name,
    listing.aboutText,
    ...(listing.certifications ?? []),
    ...(listing.specialties ?? []),
    ...(enrichment.services ?? []),
    ...(enrichment.buyingSignals ?? [])
  ].join(' ');
  const services = uniqueStrings([...inferServices(listing), ...(enrichment.services ?? [])]);

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
      employeeCountEstimate: enrichment.employeeCountEstimate ?? null,
      annualRevenueEstimate: enrichment.annualRevenueEstimate ?? null,
      yearsInBusiness: enrichment.yearsInBusiness ?? listing.yearsInBusiness,
      locationCount: enrichment.locationCount ?? null,
      reviewRating: listing.reviewRating,
      reviewCount: listing.reviewCount,
      recentReviewCount90d: enrichment.recentReviewCount90d ?? null,
      hiringSignalCount: enrichment.hiringSignalCount ?? null,
      websiteQualityScore: enrichment.websiteQualityScore ?? (listing.websiteUrl ? 65 : null),
      websiteFreshnessScore: enrichment.websiteFreshnessScore ?? null,
      serviceBreadthScore: enrichment.serviceBreadthScore ?? inferServiceBreadthScore(listing),
      growthSignalScore: enrichment.growthSignalScore ?? null,
      socialActivityScore: enrichment.socialActivityScore ?? null,
      contactConfidenceScore: enrichment.contactConfidenceScore ?? inferContactConfidenceScore(listing),
      hasFinancing: enrichment.hasFinancing ?? null,
      vendorStackVisible: enrichment.vendorStackVisible ?? null,
      decisionMakerFound: enrichment.decisionMakerFound ?? null,
      emailFound: enrichment.emailFound ?? null,
      residentialFocus: enrichment.residentialFocus ?? true,
      stormDamageFocus: enrichment.stormDamageFocus ?? /storm|insurance/i.test(searchableText),
      solarService: enrichment.solarService ?? /solar/i.test(searchableText),
      metalRoofingService: enrichment.metalRoofingService ?? /metal/i.test(searchableText),
      services
    },
    sources: [
      {
        type: 'gaf',
        title: 'GAF contractor profile',
        url: listing.profileUrl
      },
      ...(enrichment.sources ?? []).map((source) => ({
        type: 'perplexity',
        title: source.title ?? 'Perplexity source',
        url: source.url,
        fields: source.fields ?? [],
        snippet: source.snippet ?? null
      }))
    ],
    salesSummary: enrichment.summary ?? null,
    priorityRationale: enrichment.priorityRationale ?? null,
    buyingSignals: enrichment.buyingSignals ?? [],
    riskFlags: enrichment.riskFlags ?? [],
    contacts: enrichment.contacts ?? [],
    lastEnrichedAt: listing.perplexityEnrichment?.enrichedAt ?? listing.scrapedAt
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

function uniqueStrings(values) {
  return [...new Set(values.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}
