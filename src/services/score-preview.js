import { seedCompanies } from '../data/seedCompanies.js';
import { scoreCompanies } from '../scoring.js';

const scored = scoreCompanies(seedCompanies).map((company, index) => ({
  rank: index + 1,
  company: company.name,
  score: company.score.totalScore,
  buyingLikelihood: company.score.buyingLikelihoodScore,
  size: company.score.companySizeScore,
  contactability: company.score.contactabilityScore,
  distance: company.location.distanceMiles
}));

console.table(scored);
