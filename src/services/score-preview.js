import { seedCompanies } from '../data/seedCompanies.js';
import { scoreCompanies } from '../scoring.js';

const scored = scoreCompanies(seedCompanies).map((company, index) => ({
  rank: index + 1,
  company: company.name,
  priorityScore: company.score.priorityScore,
  companyScale: company.score.drivers.companyScale,
  contactability: company.score.drivers.contactability,
  buyingSignals: company.score.drivers.buyingSignals,
  distance: company.location.distanceMiles
}));

console.table(scored);
