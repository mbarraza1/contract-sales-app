export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizePhone(value) {
  const raw = String(value ?? '').replace(/^tel:/i, '').trim();
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  return raw || null;
}

export function parseContractorId(profileUrl = '') {
  const match = String(profileUrl).match(/-(\d+)(?:\/)?$/);
  return match?.[1] ?? null;
}

export function parseRating(value) {
  const rating = Number.parseFloat(String(value ?? '').match(/\d+(?:\.\d+)?/)?.[0] ?? '');
  return Number.isFinite(rating) ? rating : null;
}

export function parseReviewCount(value) {
  const reviewCount = Number.parseInt(String(value ?? '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(reviewCount) ? reviewCount : null;
}

export function parseCityStateDistance(value) {
  const text = normalizeWhitespace(value);
  const match = text.match(/^(?<city>.+?),\s*(?<state>[A-Z]{2})\s*-\s*(?<distance>\d+(?:\.\d+)?)\s*mi$/);

  if (!match?.groups) {
    return {
      city: null,
      state: null,
      distanceMiles: null
    };
  }

  return {
    city: match.groups.city,
    state: match.groups.state,
    distanceMiles: Number.parseFloat(match.groups.distance)
  };
}

export function parseAddress(value) {
  const text = normalizeWhitespace(value);
  const match = text.match(/^(?<street>.+?),\s*(?<city>.+?)\s+(?<state>[A-Z]{2}),?\s*(?<postalCode>\d{5}(?:-\d{4})?)\s+USA$/);

  if (!match?.groups) {
    return null;
  }

  return {
    addressLine1: match.groups.street,
    city: match.groups.city,
    state: match.groups.state,
    postalCode: match.groups.postalCode,
    country: 'US'
  };
}

export function parseYearsInBusiness(value, currentYear = new Date().getFullYear()) {
  const sinceYear = Number.parseInt(String(value ?? '').match(/In business since\s+(\d{4})/i)?.[1] ?? '', 10);
  if (!Number.isFinite(sinceYear)) return null;
  return Math.max(0, currentYear - sinceYear);
}

export function inferCertificationLevel(certifications = []) {
  const cert = certifications.find((item) => /master elite|certified plus|certified|premium/i.test(item));
  return cert ?? certifications[0] ?? null;
}

export function inferSpecialties(text = '') {
  const normalized = text.toLowerCase();
  const specialties = [];

  if (normalized.includes('solar')) specialties.push('Solar');
  if (normalized.includes('metal')) specialties.push('Metal');
  if (normalized.includes('fortified')) specialties.push('FORTIFIED Roof');
  if (normalized.includes('storm')) specialties.push('Storm Damage');
  if (normalized.includes('gutter')) specialties.push('Gutters');
  if (normalized.includes('siding')) specialties.push('Siding');

  return [...new Set(specialties)];
}

export function normalizeGafListing(raw, scrapeOptions = {}) {
  const location = parseCityStateDistance(raw.locationText);
  const dataLayer = parseDataLayer(raw.dataLayer);
  const attrs = dataLayer?.event_attributes ?? {};
  const certifications = uniqueStrings(raw.certifications);
  const profileUrl = raw.profileUrl ?? null;
  const contractorId = attrs.contractor_id ?? parseContractorId(profileUrl);
  const details = raw.profileDetails ?? {};
  const coveoRaw = raw.coveo?.raw ?? {};
  const aboutText = details.aboutText ?? '';
  const specialties = uniqueStrings([...(raw.specialties ?? []), ...(details.specialties ?? []), ...inferSpecialties(aboutText)]);
  const profileAddress = parseAddress(details.addressText);

  return {
    contractorId,
    name: normalizeWhitespace(attrs.contractor_name ?? raw.name),
    profileUrl,
    websiteUrl: details.websiteUrl ?? null,
    phone: normalizePhone(details.phone ?? raw.phoneHref ?? raw.phoneText),
    imageUrl: raw.imageUrl ?? null,
    city: profileAddress?.city ?? location.city,
    state: profileAddress?.state ?? location.state,
    postalCode: profileAddress?.postalCode ?? raw.postalCode ?? coveoRaw.gaf_postal_code ?? null,
    addressLine1: profileAddress?.addressLine1 ?? null,
    distanceMiles: location.distanceMiles,
    reviewRating: parseRating(attrs.contractor_rating ?? raw.ratingText),
    reviewCount: parseReviewCount(attrs.contractor_reviews_count ?? raw.reviewCountText),
    certifications,
    certificationLevel: inferCertificationLevel(certifications),
    badges: certifications.filter((cert) => cert !== inferCertificationLevel(certifications)),
    specialties,
    yearsInBusiness: details.yearsInBusiness ?? parseYearsInBusiness(details.yearsText),
    aboutText,
    sourceZip: scrapeOptions.zip,
    searchDistanceMiles: scrapeOptions.distanceMiles,
    scrapedAt: scrapeOptions.scrapedAt,
    rawPayload: raw
  };
}

function parseDataLayer(value) {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    return null;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.map(normalizeWhitespace).filter(Boolean))];
}
