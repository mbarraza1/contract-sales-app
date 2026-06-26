import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import { seedCompanies } from './data/seedCompanies.js';
import { loadCompaniesFromSqlite, loadFavoriteCompanyIds, setFavoriteCompany } from './db/sqlite.js';
import { HIGH_PRIORITY_THRESHOLD, scoreCompanies } from './scoring.js';
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

const sessionTokenPattern = /^[A-Za-z0-9._:-]{24,128}$/;

async function loadCompanies() {
  if (config.sqlitePath) {
    try {
      const companies = await loadCompaniesFromSqlite(config.sqlitePath);
      if (companies.length > 0) {
        return {
          companies,
          source: 'sqlite'
        };
      }
    } catch (error) {
      console.error('SQLite load failed; falling back to local cache.', error);
    }
  }

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

function filterCompanies(companies, searchParams) {
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();
  const state = searchParams.get('state') ?? 'all';
  const minScore = Number.parseFloat(searchParams.get('minScore') ?? '0');
  const favoritesOnly = searchParams.get('favoritesOnly') === 'true';

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
    const matchesScore = company.score.priorityScore >= minScore;
    const matchesFavorite = !favoritesOnly || company.favorite;

    return matchesQuery && matchesState && matchesScore && matchesFavorite;
  });
}

function summarize(companies, source) {
  const highPriority = companies.filter((company) => company.score.priorityScore >= HIGH_PRIORITY_THRESHOLD).length;
  const favoriteCount = companies.filter((company) => company.favorite).length;
  const averageScore = companies.length
    ? companies.reduce((sum, company) => sum + company.score.priorityScore, 0) / companies.length
    : 0;
  const states = [...new Set(companies.map((company) => company.location?.state).filter(Boolean))].sort();

  return {
    source,
    seedZip: config.seedZip,
    searchDistanceMiles: config.searchDistanceMiles,
    scoringModelVersion: config.scoringModelVersion,
    companyCount: companies.length,
    highPriority,
    favoriteCount,
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

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100000) throw new Error('Request body is too large.');
  }

  if (!body.trim()) return {};
  return JSON.parse(body);
}

function getSessionToken(request) {
  const token = String(request.headers['x-session-token'] ?? '').trim();
  return sessionTokenPattern.test(token) ? token : null;
}

async function addFavoriteState(companies, request) {
  const sessionToken = getSessionToken(request);
  if (!sessionToken || !config.sqlitePath) {
    return {
      companies: companies.map((company) => ({ ...company, favorite: false })),
      favoriteCompanyIds: []
    };
  }

  const favoriteCompanyIds = await loadFavoriteCompanyIds(config.sqlitePath, sessionToken);
  const favorites = new Set(favoriteCompanyIds);
  return {
    companies: companies.map((company) => ({
      ...company,
      favorite: favorites.has(company.id)
    })),
    favoriteCompanyIds
  };
}

async function handleApi(request, response, url) {
  const { companies, source } = await loadCompanies();
  const scoredCompanies = scoreCompanies(companies);
  const { companies: sessionCompanies, favoriteCompanyIds } = await addFavoriteState(scoredCompanies, request);

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
    return sendJson(response, 200, summarize(sessionCompanies, source));
  }

  if (url.pathname === '/api/companies') {
    return sendJson(response, 200, {
      summary: summarize(sessionCompanies, source),
      companies: filterCompanies(sessionCompanies, url.searchParams)
    });
  }

  if (url.pathname === '/api/favorites' && request.method === 'GET') {
    return sendJson(response, 200, {
      favoriteCompanyIds
    });
  }

  const favoriteMatch = url.pathname.match(/^\/api\/favorites\/([^/]+)$/);
  if (favoriteMatch && (request.method === 'PUT' || request.method === 'DELETE')) {
    const sessionToken = getSessionToken(request);
    if (!sessionToken) return sendJson(response, 401, { error: 'Valid session token is required.' });

    const companyId = decodeURIComponent(favoriteMatch[1]);
    const company = sessionCompanies.find((candidate) => candidate.id === companyId);
    if (!company) return sendJson(response, 404, { error: 'Company not found' });

    if (request.method === 'PUT') {
      await readJsonBody(request);
    }

    const result = await setFavoriteCompany(config.sqlitePath, sessionToken, companyId, request.method === 'PUT');
    return sendJson(response, 200, result);
  }

  const companyMatch = url.pathname.match(/^\/api\/companies\/([^/]+)$/);
  if (companyMatch) {
    const company = sessionCompanies.find((candidate) => candidate.id === companyMatch[1]);
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
