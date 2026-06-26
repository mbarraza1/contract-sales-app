import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { seedCompanies } from './data/seedCompanies.js';
import { loadCompaniesFromPostgres } from './db/postgres.js';
import { scoreCompanies } from './scoring.js';
import { loadGafCache } from './services/gafIngestion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');

const contentTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

async function loadCompanies() {
  if (!config.databaseUrl) {
    try {
      const companies = await loadGafCache();
      return {
        companies,
        source: 'gaf_cache'
      };
    } catch {
      // Local development starts with fixtures until the first scraper run writes a cache.
    }

    return {
      companies: seedCompanies,
      source: 'demo'
    };
  }

  try {
    const companies = await loadCompaniesFromPostgres(config.databaseUrl);
    if (companies.length === 0) {
      try {
        return {
          companies: await loadGafCache(),
          source: 'gaf_cache'
        };
      } catch {
        return {
          companies: seedCompanies,
          source: 'demo_empty_postgres'
        };
      }
    }

    return {
      companies,
      source: 'postgres'
    };
  } catch (error) {
    console.error('PostgreSQL load failed; falling back to demo fixtures.', error);
    try {
      return {
        companies: await loadGafCache(),
        source: 'gaf_cache'
      };
    } catch {
      // Fall through to fixtures.
    }

    return {
      companies: seedCompanies,
      source: 'demo_fallback'
    };
  }
}

function filterCompanies(companies, searchParams) {
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();
  const state = searchParams.get('state') ?? 'all';
  const minScore = Number.parseFloat(searchParams.get('minScore') ?? '0');

  return companies.filter((company) => {
    const haystack = [
      company.name,
      company.location?.city,
      company.location?.state,
      company.gaf?.certificationLevel,
      ...(company.gaf?.specialties ?? []),
      ...(company.metrics?.services ?? [])
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const matchesQuery = query.length === 0 || haystack.includes(query);
    const matchesState = state === 'all' || company.location?.state === state;
    const matchesScore = company.score.totalScore >= minScore;

    return matchesQuery && matchesState && matchesScore;
  });
}

function summarize(companies, source) {
  const highPriority = companies.filter((company) => company.score.totalScore >= 70).length;
  const averageScore = companies.length
    ? companies.reduce((sum, company) => sum + company.score.totalScore, 0) / companies.length
    : 0;
  const states = [...new Set(companies.map((company) => company.location?.state).filter(Boolean))].sort();

  return {
    source,
    seedZip: config.seedZip,
    searchDistanceMiles: config.searchDistanceMiles,
    scoringModelVersion: config.scoringModelVersion,
    companyCount: companies.length,
    highPriority,
    averageScore: Math.round(averageScore * 10) / 10,
    states
  };
}

async function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

async function handleApi(request, response, url) {
  const { companies, source } = await loadCompanies();
  const scoredCompanies = scoreCompanies(companies);

  if (url.pathname === '/api/health') {
    return sendJson(response, 200, { ok: true });
  }

  if (url.pathname === '/api/config') {
    return sendJson(response, 200, {
      seedZip: config.seedZip,
      searchDistanceMiles: config.searchDistanceMiles,
      scoringModelVersion: config.scoringModelVersion,
      source
    });
  }

  if (url.pathname === '/api/summary') {
    return sendJson(response, 200, summarize(scoredCompanies, source));
  }

  if (url.pathname === '/api/companies') {
    return sendJson(response, 200, {
      summary: summarize(scoredCompanies, source),
      companies: filterCompanies(scoredCompanies, url.searchParams)
    });
  }

  const companyMatch = url.pathname.match(/^\/api\/companies\/([^/]+)$/);
  if (companyMatch) {
    const company = scoredCompanies.find((candidate) => candidate.id === companyMatch[1]);
    if (!company) return sendJson(response, 404, { error: 'Company not found' });
    return sendJson(response, 200, company);
  }

  return sendJson(response, 404, { error: 'API route not found' });
}

async function serveStatic(response, pathname) {
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const absolutePath = path.normalize(path.join(publicDir, cleanPath));

  if (!absolutePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const file = await readFile(absolutePath);
    const extension = path.extname(absolutePath);
    response.writeHead(200, {
      'Content-Type': contentTypes.get(extension) ?? 'application/octet-stream'
    });
    response.end(file);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname);
  } catch (error) {
    console.error(error);
    await sendJson(response, 500, { error: 'Internal server error' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Contractor Sales Intelligence running at http://${config.host}:${config.port}`);
});
