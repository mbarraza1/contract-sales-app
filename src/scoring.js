export const HIGH_PRIORITY_THRESHOLD = 70;

export const scoringWeights = Object.freeze({
  companyScale: 30,
  contactability: 16,
  buyingSignals: 14,
  serviceFit: 12,
  growth: 10,
  reputation: 8,
  purchaseNeed: 8,
  certification: 1,
  socialActivity: 1
});

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;

const ratio = (value, max) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  return clamp(Number(value) / max);
};

const ratioOrNeutral = (value, max, neutral = 0.5) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return neutral;
  return ratio(value, max);
};

const ratioPositiveOrNeutral = (value, max, neutral = 0.4) => {
  if (value === null || value === undefined || Number.isNaN(Number(value)) || Number(value) <= 0) return neutral;
  return ratio(value, max);
};

const inverseRatioOrNeutral = (value, max, neutral = 0.5) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return neutral;
  return 1 - ratio(value, max);
};

const booleanScore = (value, whenTrue = 1, whenFalse = 0, whenUnknown = whenFalse) => {
  if (value === null || value === undefined) return whenUnknown;
  return value ? whenTrue : whenFalse;
};

const weightedAverage = (entries) => {
  const filtered = entries.filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0);
  const weightTotal = filtered.reduce((sum, entry) => sum + entry.weight, 0);
  if (weightTotal === 0) return 0;
  return filtered.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weightTotal;
};

const weightedScore = (drivers, weights) =>
  Object.entries(weights).reduce((sum, [key, weight]) => sum + (drivers[key] ?? 0) * weight, 0) /
  Object.values(weights).reduce((sum, weight) => sum + weight, 0);

const gafLevelScore = (level = '') => {
  const normalized = String(level ?? '').toLowerCase();
  if (normalized.includes('president')) return 1;
  if (normalized.includes('master elite')) return 0.95;
  if (normalized.includes('premium')) return 0.85;
  if (normalized.includes('certified')) return 0.7;
  if (normalized.includes('authorized')) return 0.55;
  return 0.35;
};

function calculateDrivers(company) {
  const metrics = company.metrics ?? {};
  const gaf = company.gaf ?? {};
  const contacts = company.contacts ?? [];
  const services = new Set([...(metrics.services ?? []), ...(gaf.specialties ?? [])].map((item) => String(item).toLowerCase()));
  const buyingSignalStrength = ratio(company.buyingSignals?.length ?? 0, 8);
  const hasPhone = Boolean(company.phone) || contacts.some((contact) => contact.phone);
  const hasEmail = Boolean(metrics.emailFound) || contacts.some((contact) => contact.email);

  const companyScale = weightedAverage([
    { value: ratioPositiveOrNeutral(metrics.employeeCountEstimate, 100, 0.35), weight: 0.35 },
    { value: ratioPositiveOrNeutral(metrics.annualRevenueEstimate, 12000000, 0.42), weight: 0.25 },
    { value: ratioPositiveOrNeutral(metrics.locationCount, 4, 0.35), weight: 0.2 },
    { value: ratio(metrics.reviewCount, 500), weight: 0.2 }
  ]);

  const contactability = weightedAverage([
    { value: booleanScore(hasPhone, 1, 0), weight: 0.2 },
    { value: booleanScore(Boolean(company.websiteUrl), 1, 0.25), weight: 0.1 },
    { value: booleanScore(metrics.decisionMakerFound, 1, 0.35), weight: 0.22 },
    { value: booleanScore(hasEmail, 1, 0.35), weight: 0.25 },
    { value: ratioOrNeutral(metrics.contactConfidenceScore, 100, 0.5), weight: 0.23 }
  ]);

  const serviceFit = weightedAverage([
    { value: booleanScore(metrics.residentialFocus, 1, 0.25, 0.75), weight: 0.25 },
    { value: booleanScore(metrics.stormDamageFocus, 1, 0.35, 0.55), weight: 0.18 },
    { value: booleanScore(metrics.solarService || services.has('solar'), 0.85, 0.35, 0.4), weight: 0.12 },
    { value: booleanScore(metrics.metalRoofingService || services.has('metal'), 0.85, 0.35, 0.4), weight: 0.12 },
    { value: ratioOrNeutral(metrics.serviceBreadthScore, 100, 0.55), weight: 0.23 },
    { value: ratio(metrics.services?.length ?? 0, 10), weight: 0.1 }
  ]);

  const growth = weightedAverage([
    { value: ratio(metrics.hiringSignalCount, 3), weight: 0.2 },
    { value: ratioPositiveOrNeutral(metrics.locationCount, 4, 0.35), weight: 0.2 },
    { value: ratioOrNeutral(metrics.growthSignalScore, 100, 0.5), weight: 0.3 },
    { value: ratio(metrics.recentReviewCount90d, 12), weight: 0.15 },
    { value: buyingSignalStrength, weight: 0.15 }
  ]);

  const reputation = weightedAverage([
    { value: ratio(metrics.reviewRating, 5), weight: 0.4 },
    { value: ratio(metrics.reviewCount, 500), weight: 0.35 },
    { value: ratioPositiveOrNeutral(metrics.yearsInBusiness, 25, 0.45), weight: 0.25 }
  ]);

  const purchaseNeed = weightedAverage([
    { value: inverseRatioOrNeutral(metrics.websiteQualityScore, 100, 0.5), weight: 0.25 },
    { value: booleanScore(metrics.hasFinancing, 0.25, 1, 0.6), weight: 0.2 },
    { value: booleanScore(metrics.vendorStackVisible, 0.25, 1, 0.6), weight: 0.2 },
    { value: ratioOrNeutral(metrics.serviceBreadthScore, 100, 0.55), weight: 0.25 },
    { value: buyingSignalStrength, weight: 0.1 }
  ]);

  return {
    companyScale: round(companyScale * 100),
    contactability: round(contactability * 100),
    buyingSignals: round(buyingSignalStrength * 100),
    serviceFit: round(serviceFit * 100),
    growth: round(growth * 100),
    reputation: round(reputation * 100),
    purchaseNeed: round(purchaseNeed * 100),
    certification: round(gafLevelScore(gaf.certificationLevel) * 100),
    socialActivity: round(ratio(metrics.socialActivityScore, 100) * 100)
  };
}

function marketCalibrate(rawScore) {
  return round(clamp(16 + rawScore * 0.86, 0, 100));
}

const buildReasons = (company, score) => {
  const metrics = company.metrics ?? {};
  const drivers = score.drivers;
  const reasons = [buildPriorityRationale(company, score)].filter(Boolean);

  if (drivers.companyScale >= 65) {
    reasons.push('Large account potential based on employees, revenue, locations, or review volume.');
  }

  if (drivers.contactability >= 75) {
    reasons.push('Contact paths look reachable for outbound sales follow-up.');
  }

  if (drivers.buyingSignals >= 65) {
    reasons.push('Multiple buying signals were found during enrichment research.');
  }

  if (drivers.growth >= 60) {
    reasons.push('Growth signals suggest active operations or expansion.');
  }

  if (drivers.serviceFit >= 70) {
    reasons.push('Broad service fit creates more ways to sell into the account.');
  }

  if (drivers.purchaseNeed >= 70) {
    reasons.push('Clear purchase opportunity based on gaps in financing, vendor visibility, or digital maturity.');
  }

  if (metrics.reviewCount >= 250 && metrics.reviewRating >= 4.5) {
    reasons.push('High review volume and reputation suggest meaningful job flow.');
  }

  return reasons.slice(0, 4);
};

function buildPriorityRationale(company, score) {
  if (company.priorityRationale) {
    return trimSentence(company.priorityRationale);
  }

  if (company.salesSummary) {
    const driverLabels = topDriverLabels(score.drivers, 2);
    const suffix = driverLabels.length > 0 ? ` Key drivers: ${driverLabels.join(' and ')}.` : '';
    const rationale = `${company.salesSummary}${suffix}`;
    return trimSentence(rationale.length <= 220 ? rationale : company.salesSummary);
  }

  const signal = company.buyingSignals?.[0];
  if (signal) {
    return trimSentence(`${company.name} ranks here because ${signal.charAt(0).toLowerCase()}${signal.slice(1)}`);
  }

  return null;
}

function topDriverLabels(drivers, count) {
  const labels = {
    companyScale: 'account scale',
    contactability: 'reachable contacts',
    buyingSignals: 'Perplexity buying signals',
    serviceFit: 'service fit',
    growth: 'growth',
    reputation: 'reputation',
    purchaseNeed: 'purchase need'
  };

  return Object.entries(drivers)
    .filter(([key]) => labels[key])
    .sort(([, left], [, right]) => right - left)
    .slice(0, count)
    .map(([key]) => labels[key]);
}

function trimSentence(value, maxLength = 300) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;

  const trimmed = normalized.slice(0, maxLength - 1).trimEnd();
  const sentenceEnd = Math.max(trimmed.lastIndexOf('.'), trimmed.lastIndexOf(';'), trimmed.lastIndexOf(','));
  if (sentenceEnd >= 120) return `${trimmed.slice(0, sentenceEnd)}.`;
  return `${trimmed}...`;
}

export function scoreCompany(company) {
  const drivers = calculateDrivers(company);
  const rawScore = round(weightedScore(drivers, scoringWeights));
  const priorityScore = marketCalibrate(rawScore);

  const score = {
    totalScore: priorityScore,
    priorityScore,
    rawScore,
    drivers
  };

  return {
    ...company,
    score: {
      ...score,
      reasons: buildReasons(company, score)
    }
  };
}

export function scoreCompanies(companies) {
  return companies
    .map(scoreCompany)
    .sort((a, b) => {
      if (b.score.priorityScore !== a.score.priorityScore) return b.score.priorityScore - a.score.priorityScore;
      if (b.score.drivers.companyScale !== a.score.drivers.companyScale) {
        return b.score.drivers.companyScale - a.score.drivers.companyScale;
      }
      return b.score.drivers.contactability - a.score.drivers.contactability;
    });
}
