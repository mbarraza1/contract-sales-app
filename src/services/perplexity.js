import { config } from '../config.js';

export function buildCompanyResearchPrompt(company) {
  return [
    'Return structured JSON only.',
    'Research this roofing contractor as a potential sales lead.',
    'Prioritize buying likelihood, company size, contactability, and source confidence.',
    '',
    `Company: ${company.name}`,
    `Website: ${company.websiteUrl ?? 'unknown'}`,
    `Phone: ${company.phone ?? 'unknown'}`,
    `Location: ${company.location?.city ?? 'unknown'}, ${company.location?.state ?? 'unknown'}`,
    '',
    'Required JSON fields:',
    'employeeCountEstimate, annualRevenueEstimate, yearsInBusiness, locationCount, reviewRating, reviewCount, recentReviewCount90d, hiringSignalCount, websiteQualityScore, websiteFreshnessScore, serviceBreadthScore, growthSignalScore, socialActivityScore, contactConfidenceScore, hasFinancing, vendorStackVisible, decisionMakerFound, emailFound, residentialFocus, stormDamageFocus, solarService, metalRoofingService, services, contacts, sources, confidenceByField'
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
      messages: [
        {
          role: 'system',
          content: 'You are a sales intelligence researcher. Return valid JSON with source URLs for every factual claim.'
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

  return response.json();
}
