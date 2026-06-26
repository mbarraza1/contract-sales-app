import { config } from '../config.js';

export function buildCompanyResearchPrompt(company) {
  const gaf = company.gaf ?? {};
  const metrics = company.metrics ?? {};
  const location = company.location ?? {};

  return [
    'Return valid JSON only. No markdown, no commentary.',
    'Research this roofing contractor as a potential sales lead for a company that can sell many types of products/services to roofing contractors.',
    'Find concrete signals that help produce one overall sales priority score, especially account size, contactability, buying signals, service breadth, growth, reputation, and purchase need.',
    'Use public web sources. Do not invent unknown values; use null when unsure.',
    '',
    `Company: ${company.name}`,
    `Website: ${company.websiteUrl ?? 'unknown'}`,
    `Phone: ${company.phone ?? 'unknown'}`,
    `Location: ${location.addressLine1 ? `${location.addressLine1}, ` : ''}${location.city ?? 'unknown'}, ${location.state ?? 'unknown'} ${location.postalCode ?? ''}`,
    `GAF profile: ${gaf.profileUrl ?? 'unknown'}`,
    `GAF certification: ${gaf.certificationLevel ?? 'unknown'}`,
    `GAF badges: ${(gaf.badges ?? []).join(', ') || 'none'}`,
    `GAF specialties: ${(gaf.specialties ?? []).join(', ') || 'none'}`,
    `GAF reviews: ${metrics.reviewRating ?? 'unknown'} rating / ${metrics.reviewCount ?? 'unknown'} reviews`,
    '',
    'Return this exact JSON shape:',
    '{',
    '  "summary": "one sentence sales-rep summary",',
    '  "priorityRationale": "one short sentence explaining why this company should receive its sales priority, using company-specific facts",',
    '  "employeeCountEstimate": number|null,',
    '  "annualRevenueEstimate": number|null,',
    '  "yearsInBusiness": number|null,',
    '  "locationCount": number|null,',
    '  "recentReviewCount90d": number|null,',
    '  "hiringSignalCount": number|null,',
    '  "websiteQualityScore": number|null,',
    '  "websiteFreshnessScore": number|null,',
    '  "serviceBreadthScore": number|null,',
    '  "growthSignalScore": number|null,',
    '  "socialActivityScore": number|null,',
    '  "contactConfidenceScore": number|null,',
    '  "hasFinancing": boolean|null,',
    '  "vendorStackVisible": boolean|null,',
    '  "decisionMakerFound": boolean|null,',
    '  "emailFound": boolean|null,',
    '  "residentialFocus": boolean|null,',
    '  "stormDamageFocus": boolean|null,',
    '  "solarService": boolean|null,',
    '  "metalRoofingService": boolean|null,',
    '  "services": ["service"],',
    '  "contacts": [{"fullName": string|null, "title": string|null, "email": string|null, "phone": string|null, "linkedinUrl": string|null, "confidenceScore": number|null, "sourceUrl": string|null}],',
    '  "buyingSignals": ["signal"],',
    '  "riskFlags": ["risk"],',
    '  "confidenceByField": {"fieldName": number},',
    '  "sources": [{"url": string, "title": string|null, "fields": ["fieldName"], "snippet": string|null}]',
    '}',
    '',
    'Scoring guidance: numeric scores are 0-100. Higher websiteQualityScore means better website. Higher growthSignalScore means more evidence of growth.'
  ].join('\n');
}

export async function enrichCompanyWithPerplexity(company) {
  if (!config.perplexity.apiKey) {
    throw new Error('PERPLEXITY_API_KEY is required to run enrichment.');
  }

  const response = await fetch(config.perplexity.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.perplexity.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.perplexity.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a careful sales intelligence researcher. Return JSON only. Cite source URLs inside the sources array. Use null rather than guessing.'
        },
        {
          role: 'user',
          content: buildCompanyResearchPrompt(company)
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Perplexity request failed with ${response.status}: ${body}`);
  }

  const rawResponse = await response.json();
  return normalizePerplexityResponse(rawResponse);
}

export function normalizePerplexityResponse(rawResponse) {
  const content = rawResponse.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonFromContent(content);

  return {
    enrichedAt: new Date().toISOString(),
    model: rawResponse.model,
    data: normalizePerplexityData(parsed),
    citations: rawResponse.citations ?? [],
    searchResults: rawResponse.search_results ?? [],
    usage: rawResponse.usage ?? null
  };
}

export function parseJsonFromContent(content) {
  const stripped = String(content)
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('Perplexity did not return parseable JSON.');
    }

    return JSON.parse(stripped.slice(start, end + 1));
  }
}

export function normalizePerplexityData(data) {
  return {
    summary: stringOrNull(data.summary),
    priorityRationale: stringOrNull(data.priorityRationale),
    employeeCountEstimate: numberOrNull(data.employeeCountEstimate),
    annualRevenueEstimate: numberOrNull(data.annualRevenueEstimate),
    yearsInBusiness: numberOrNull(data.yearsInBusiness),
    locationCount: numberOrNull(data.locationCount),
    recentReviewCount90d: numberOrNull(data.recentReviewCount90d),
    hiringSignalCount: numberOrNull(data.hiringSignalCount),
    websiteQualityScore: scoreOrNull(data.websiteQualityScore),
    websiteFreshnessScore: scoreOrNull(data.websiteFreshnessScore),
    serviceBreadthScore: scoreOrNull(data.serviceBreadthScore),
    growthSignalScore: scoreOrNull(data.growthSignalScore),
    socialActivityScore: scoreOrNull(data.socialActivityScore),
    contactConfidenceScore: scoreOrNull(data.contactConfidenceScore),
    hasFinancing: booleanOrNull(data.hasFinancing),
    vendorStackVisible: booleanOrNull(data.vendorStackVisible),
    decisionMakerFound: booleanOrNull(data.decisionMakerFound),
    emailFound: booleanOrNull(data.emailFound),
    residentialFocus: booleanOrNull(data.residentialFocus),
    stormDamageFocus: booleanOrNull(data.stormDamageFocus),
    solarService: booleanOrNull(data.solarService),
    metalRoofingService: booleanOrNull(data.metalRoofingService),
    services: arrayOfStrings(data.services),
    contacts: Array.isArray(data.contacts) ? data.contacts.map(normalizeContact) : [],
    buyingSignals: arrayOfStrings(data.buyingSignals),
    riskFlags: arrayOfStrings(data.riskFlags),
    confidenceByField:
      typeof data.confidenceByField === 'object' && data.confidenceByField !== null ? data.confidenceByField : {},
    sources: Array.isArray(data.sources) ? data.sources.map(normalizeSource).filter((source) => source.url) : []
  };
}

function normalizeContact(contact) {
  return {
    fullName: stringOrNull(contact.fullName),
    title: stringOrNull(contact.title),
    email: stringOrNull(contact.email),
    phone: stringOrNull(contact.phone),
    linkedinUrl: stringOrNull(contact.linkedinUrl),
    confidenceScore: scoreOrNull(contact.confidenceScore),
    sourceUrl: stringOrNull(contact.sourceUrl)
  };
}

function normalizeSource(source) {
  return {
    url: stringOrNull(source.url),
    title: stringOrNull(source.title),
    fields: arrayOfStrings(source.fields),
    snippet: stringOrNull(source.snippet)
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scoreOrNull(value) {
  const number = numberOrNull(value);
  if (number === null) return null;
  return Math.min(100, Math.max(0, Math.round(number)));
}

function booleanOrNull(value) {
  if (typeof value === 'boolean') return value;
  return null;
}

function stringOrNull(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function arrayOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))];
}
