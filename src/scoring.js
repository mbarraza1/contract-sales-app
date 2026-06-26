export const scoringWeights = {
  buyingLikelihood: 65,
  companySize: 25,
  contactability: 10
};

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

const inverseRatioOrNeutral = (value, max, neutral = 0.5) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return neutral;
  return 1 - ratio(value, max);
};

const booleanScore = (value, whenTrue = 1, whenFalse = 0, whenUnknown = whenFalse) => {
  if (value === null || value === undefined) return whenUnknown;
  return value ? whenTrue : whenFalse;
};

const average = (values) => {
  const filtered = values.filter((value) => Number.isFinite(value));
  if (filtered.length === 0) return 0;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
};

const gafLevelScore = (level = '') => {
  const normalized = level.toLowerCase();
  if (normalized.includes('president')) return 1;
  if (normalized.includes('master elite')) return 0.95;
  if (normalized.includes('premium')) return 0.85;
  if (normalized.includes('certified')) return 0.7;
  if (normalized.includes('authorized')) return 0.55;
  return 0.35;
};

const calculateBuyingLikelihood = (company) => {
  const metrics = company.metrics ?? {};
  const gaf = company.gaf ?? {};
  const services = new Set([...(metrics.services ?? []), ...(gaf.specialties ?? [])].map((item) => item.toLowerCase()));

  const recentActivity = average([
    ratio(metrics.recentReviewCount90d, 18),
    ratio(metrics.socialActivityScore, 100),
    ratio(metrics.websiteFreshnessScore, 100)
  ]);

  const growth = average([
    ratio(metrics.hiringSignalCount, 5),
    ratio(metrics.locationCount, 5),
    ratio(metrics.growthSignalScore, 100)
  ]);

  const maturity = average([
    ratio(metrics.yearsInBusiness, 30),
    gafLevelScore(gaf.certificationLevel),
    ratio(metrics.reviewRating, 5)
  ]);

  const purchaseNeed = average([
    inverseRatioOrNeutral(metrics.websiteQualityScore, 100),
    booleanScore(metrics.hasFinancing, 0.25, 1, 0.5),
    booleanScore(metrics.vendorStackVisible, 0.25, 1, 0.5),
    ratioOrNeutral(metrics.serviceBreadthScore, 100)
  ]);

  const serviceFit = average([
    booleanScore(metrics.residentialFocus, 1, 0.25),
    booleanScore(metrics.stormDamageFocus, 1, 0.35),
    booleanScore(metrics.solarService || services.has('solar'), 0.85, 0.35),
    booleanScore(metrics.metalRoofingService || services.has('metal'), 0.85, 0.35),
    ratio(metrics.serviceBreadthScore, 100)
  ]);

  const raw = recentActivity * 0.22 + growth * 0.2 + maturity * 0.18 + purchaseNeed * 0.2 + serviceFit * 0.2;

  return {
    score: round(raw * scoringWeights.buyingLikelihood),
    facets: {
      recentActivity: round(recentActivity * 100),
      growth: round(growth * 100),
      maturity: round(maturity * 100),
      purchaseNeed: round(purchaseNeed * 100),
      serviceFit: round(serviceFit * 100)
    }
  };
};

const calculateCompanySize = (company) => {
  const metrics = company.metrics ?? {};
  const raw = average([
    ratio(metrics.employeeCountEstimate, 150),
    ratio(metrics.annualRevenueEstimate, 25000000),
    ratio(metrics.locationCount, 5),
    ratio(metrics.reviewCount, 1200)
  ]);

  return {
    score: round(raw * scoringWeights.companySize),
    facets: {
      employees: round(ratio(metrics.employeeCountEstimate, 150) * 100),
      revenue: round(ratio(metrics.annualRevenueEstimate, 25000000) * 100),
      locations: round(ratio(metrics.locationCount, 5) * 100),
      reviewVolume: round(ratio(metrics.reviewCount, 1200) * 100)
    }
  };
};

const calculateContactability = (company) => {
  const metrics = company.metrics ?? {};
  const raw = average([
    booleanScore(Boolean(company.phone), 1, 0),
    booleanScore(Boolean(company.websiteUrl), 1, 0),
    booleanScore(metrics.decisionMakerFound, 1, 0.35),
    booleanScore(metrics.emailFound, 1, 0.35),
    ratio(metrics.contactConfidenceScore, 100)
  ]);

  return {
    score: round(raw * scoringWeights.contactability),
    facets: {
      phone: company.phone ? 100 : 0,
      website: company.websiteUrl ? 100 : 0,
      decisionMaker: metrics.decisionMakerFound ? 100 : 35,
      email: metrics.emailFound ? 100 : 35,
      confidence: round(ratio(metrics.contactConfidenceScore, 100) * 100)
    }
  };
};

const buildReasons = (company, score) => {
  const metrics = company.metrics ?? {};
  const gaf = company.gaf ?? {};
  const reasons = [];

  if (score.facets.buyingLikelihood.growth >= 70) {
    reasons.push('Strong growth signals from hiring, locations, or recent market activity.');
  }

  if (score.facets.buyingLikelihood.purchaseNeed >= 70) {
    reasons.push('Clear purchase opportunity based on weak vendor visibility, financing gaps, or website quality.');
  }

  if (metrics.reviewCount >= 250 && metrics.reviewRating >= 4.5) {
    reasons.push('High review volume and reputation suggest meaningful job flow.');
  }

  if ((gaf.certificationLevel ?? '').length > 0) {
    reasons.push(`${gaf.certificationLevel} status indicates a mature roofing operation.`);
  }

  if (metrics.employeeCountEstimate >= 50 || metrics.annualRevenueEstimate >= 10000000) {
    reasons.push('Large account potential based on estimated employees or revenue.');
  }

  if (metrics.decisionMakerFound || metrics.emailFound) {
    reasons.push('Contact paths look reachable for outbound sales follow-up.');
  }

  return reasons.slice(0, 4);
};

export function scoreCompany(company) {
  const buyingLikelihood = calculateBuyingLikelihood(company);
  const companySize = calculateCompanySize(company);
  const contactability = calculateContactability(company);
  const totalScore = round(buyingLikelihood.score + companySize.score + contactability.score);

  const score = {
    totalScore,
    buyingLikelihoodScore: buyingLikelihood.score,
    companySizeScore: companySize.score,
    contactabilityScore: contactability.score,
    facets: {
      buyingLikelihood: buyingLikelihood.facets,
      companySize: companySize.facets,
      contactability: contactability.facets
    }
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
      if (b.score.totalScore !== a.score.totalScore) return b.score.totalScore - a.score.totalScore;
      if (b.score.buyingLikelihoodScore !== a.score.buyingLikelihoodScore) {
        return b.score.buyingLikelihoodScore - a.score.buyingLikelihoodScore;
      }
      return b.score.companySizeScore - a.score.companySizeScore;
    });
}
