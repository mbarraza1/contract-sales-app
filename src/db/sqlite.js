import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { config } from '../config.js';
import { mapGafListingToCompany, normalizeCompanyName } from '../services/gafMapper.js';

const schemaPath = path.resolve('db/sqlite-schema.sql');

export async function initializeSqliteDatabase(databasePath = config.sqlitePath) {
  if (!databasePath) {
    throw new Error('SQLITE_DB_PATH is required to initialize SQLite.');
  }

  const db = openDatabase(databasePath);
  try {
    db.exec(readFileSync(schemaPath, 'utf8'));
  } finally {
    db.close();
  }

  return path.resolve(databasePath);
}

export async function loadCompaniesFromSqlite(databasePath = config.sqlitePath) {
  if (!databasePath || !existsSync(path.resolve(databasePath))) return [];

  const db = openDatabase(databasePath);
  try {
    db.exec(readFileSync(schemaPath, 'utf8'));
    const rows = db
      .prepare(
        `
          select
            c.id,
            c.name,
            c.website_url,
            c.phone,
            loc.address_line1,
            loc.city,
            loc.state,
            loc.postal_code,
            gl.source_zip,
            gl.search_distance_miles,
            gl.distance_miles,
            gl.gaf_profile_url,
            gl.certification_level,
            gl.badges,
            gl.specialties,
            gl.raw_payload,
            cm.employee_count_estimate,
            cm.annual_revenue_estimate,
            cm.years_in_business,
            cm.location_count,
            cm.review_rating,
            cm.review_count,
            cm.recent_review_count_90d,
            cm.hiring_signal_count,
            cm.website_quality_score,
            cm.service_breadth_score,
            cm.growth_signal_score,
            cm.social_activity_score,
            cm.contact_confidence_score,
            cm.has_financing,
            cm.decision_maker_found,
            cm.residential_focus,
            cm.storm_damage_focus,
            cm.solar_service,
            cm.metal_roofing_service,
            cm.metrics_payload,
            cm.sources_payload,
            cm.calculated_at
          from companies c
          left join company_locations loc on loc.id = (
            select id
            from company_locations
            where company_id = c.id
            order by is_primary desc, created_at desc
            limit 1
          )
          left join gaf_listings gl on gl.id = (
            select id
            from gaf_listings
            where company_id = c.id
            order by last_seen_at desc
            limit 1
          )
          left join company_metrics cm on cm.id = (
            select id
            from company_metrics
            where company_id = c.id
            order by calculated_at desc
            limit 1
          )
          order by c.name asc
        `
      )
      .all();

    return rows.map(mapCompanyRow);
  } finally {
    db.close();
  }
}

export async function upsertGafScrapeResultsToSqlite(
  databasePath = config.sqlitePath,
  scrape,
  { organizationName = config.organizationName } = {}
) {
  if (!databasePath) {
    throw new Error('SQLITE_DB_PATH is required to persist GAF scrape results.');
  }

  const db = openDatabase(databasePath);
  const stats = {
    companies: 0,
    listings: 0,
    metrics: 0
  };

  try {
    db.exec(readFileSync(schemaPath, 'utf8'));
    db.exec('begin immediate');

    const runId = createIngestionRun(db, scrape);
    const organizationId = ensureOrganization(db, organizationName);

    for (const listing of scrape.listings ?? []) {
      const company = mapGafListingToCompany({
        ...listing,
        sourceZip: listing.sourceZip ?? scrape.sourceZip,
        searchDistanceMiles: listing.searchDistanceMiles ?? scrape.searchDistanceMiles,
        scrapedAt: listing.scrapedAt ?? scrape.scrapedAt
      });
      const companyId = upsertCompany(db, organizationId, company);

      upsertLocation(db, companyId, company.location);
      upsertGafListing(db, companyId, company, listing, scrape);
      insertCompanyMetrics(db, companyId, company);
      insertCompanySource(db, companyId, company);

      stats.companies += 1;
      stats.listings += 1;
      stats.metrics += 1;
    }

    finishIngestionRun(db, runId, 'succeeded', stats);
    db.exec('commit');
    return stats;
  } catch (error) {
    try {
      db.exec('rollback');
    } catch {
      // Ignore rollback failures when an error happens before the transaction opens.
    }
    throw error;
  } finally {
    db.close();
  }
}

export async function loadFavoriteCompanyIds(databasePath = config.sqlitePath, sessionToken) {
  if (!databasePath || !sessionToken || !existsSync(path.resolve(databasePath))) return [];

  const db = openDatabase(databasePath);
  try {
    db.exec(readFileSync(schemaPath, 'utf8'));
    ensureSalesRepSession(db, sessionToken);

    return db
      .prepare(
        `
          select company_id
          from favorite_companies
          where session_token = ?
          order by created_at desc
        `
      )
      .all(sessionToken)
      .map((row) => row.company_id);
  } finally {
    db.close();
  }
}

export async function setFavoriteCompany(databasePath = config.sqlitePath, sessionToken, companyId, favorite) {
  if (!databasePath) {
    throw new Error('SQLITE_DB_PATH is required to persist favorites.');
  }
  if (!sessionToken) {
    throw new Error('Session token is required to persist favorites.');
  }

  const db = openDatabase(databasePath);
  try {
    db.exec(readFileSync(schemaPath, 'utf8'));
    ensureSalesRepSession(db, sessionToken);

    if (favorite) {
      db.prepare(
        `
          insert into favorite_companies(session_token, company_id)
          values (?, ?)
          on conflict(session_token, company_id) do nothing
        `
      ).run(sessionToken, companyId);
    } else {
      db.prepare(
        `
          delete from favorite_companies
          where session_token = ?
            and company_id = ?
        `
      ).run(sessionToken, companyId);
    }

    return {
      companyId,
      favorite: Boolean(favorite),
      favoriteCompanyIds: db
        .prepare('select company_id from favorite_companies where session_token = ? order by created_at desc')
        .all(sessionToken)
        .map((row) => row.company_id)
    };
  } finally {
    db.close();
  }
}

function openDatabase(databasePath) {
  const absolutePath = path.resolve(databasePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });

  const db = new DatabaseSync(absolutePath);
  db.exec('pragma foreign_keys = on');
  db.exec('pragma journal_mode = WAL');
  db.exec('pragma busy_timeout = 5000');
  return db;
}

function mapCompanyRow(row) {
  const payload = parseJson(row.metrics_payload, {});
  const rawPayload = parseJson(row.raw_payload, {});

  return {
    id: row.id,
    name: row.name,
    websiteUrl: row.website_url,
    phone: row.phone,
    location: {
      addressLine1: row.address_line1,
      city: row.city,
      state: row.state,
      postalCode: row.postal_code,
      distanceMiles: toNumber(row.distance_miles)
    },
    gaf: {
      sourceZip: row.source_zip,
      searchDistanceMiles: row.search_distance_miles,
      contractorId: rawPayload.contractorId ?? null,
      profileUrl: row.gaf_profile_url,
      certificationLevel: row.certification_level,
      badges: parseJson(row.badges, []),
      specialties: parseJson(row.specialties, [])
    },
    metrics: {
      employeeCountEstimate: toInteger(row.employee_count_estimate),
      annualRevenueEstimate: toNumber(row.annual_revenue_estimate),
      yearsInBusiness: toInteger(row.years_in_business),
      locationCount: toInteger(row.location_count),
      reviewRating: toNumber(row.review_rating),
      reviewCount: toInteger(row.review_count),
      recentReviewCount90d: toInteger(row.recent_review_count_90d),
      hiringSignalCount: toInteger(row.hiring_signal_count),
      websiteQualityScore: toInteger(row.website_quality_score),
      websiteFreshnessScore: payload.websiteFreshnessScore ?? toInteger(row.website_quality_score),
      serviceBreadthScore: toInteger(row.service_breadth_score),
      growthSignalScore: toInteger(row.growth_signal_score),
      socialActivityScore: toInteger(row.social_activity_score),
      contactConfidenceScore: toInteger(row.contact_confidence_score),
      hasFinancing: toBoolean(row.has_financing),
      vendorStackVisible: payload.vendorStackVisible ?? null,
      decisionMakerFound: toBoolean(row.decision_maker_found),
      emailFound: payload.emailFound ?? null,
      residentialFocus: toBoolean(row.residential_focus),
      stormDamageFocus: toBoolean(row.storm_damage_focus),
      solarService: toBoolean(row.solar_service),
      metalRoofingService: toBoolean(row.metal_roofing_service),
      services: payload.services ?? []
    },
    sources: parseJson(row.sources_payload, []),
    salesSummary: payload.salesSummary ?? null,
    priorityRationale: payload.priorityRationale ?? null,
    buyingSignals: payload.buyingSignals ?? [],
    riskFlags: payload.riskFlags ?? [],
    contacts: payload.contacts ?? [],
    lastEnrichedAt: payload.enrichedAt ?? row.calculated_at
  };
}

function ensureOrganization(db, name) {
  db.prepare(
    `
      insert into organizations(id, name)
      values (?, ?)
      on conflict(name) do update set name = excluded.name
    `
  ).run(randomUUID(), name);

  return db.prepare('select id from organizations where name = ?').get(name).id;
}

function ensureSalesRepSession(db, sessionToken) {
  db.prepare(
    `
      insert into sales_rep_sessions(session_token, last_seen_at)
      values (?, ?)
      on conflict(session_token) do update set last_seen_at = excluded.last_seen_at
    `
  ).run(sessionToken, new Date().toISOString());
}

function createIngestionRun(db, scrape) {
  const id = randomUUID();
  db.prepare(
    `
      insert into ingestion_runs(id, source, source_zip, search_distance_miles, result_payload)
      values (?, 'gaf', ?, ?, ?)
    `
  ).run(
    id,
    scrape.sourceZip,
    scrape.searchDistanceMiles,
    stringifyJson({
      sourceUrl: scrape.sourceUrl,
      scrapedAt: scrape.scrapedAt
    })
  );

  return id;
}

function finishIngestionRun(db, runId, status, stats) {
  const row = db.prepare('select result_payload from ingestion_runs where id = ?').get(runId);
  const payload = {
    ...parseJson(row?.result_payload, {}),
    ...stats
  };

  db.prepare(
    `
      update ingestion_runs
      set status = ?,
          finished_at = ?,
          result_payload = ?
      where id = ?
    `
  ).run(status, new Date().toISOString(), stringifyJson(payload), runId);
}

function upsertCompany(db, organizationId, company) {
  const normalizedName = normalizeCompanyName(company.name);
  const row = db
    .prepare(
      `
        insert into companies(id, organization_id, name, normalized_name, website_url, phone, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(organization_id, normalized_name)
        do update set
          name = excluded.name,
          website_url = coalesce(excluded.website_url, companies.website_url),
          phone = coalesce(excluded.phone, companies.phone),
          updated_at = excluded.updated_at
        returning id
      `
    )
    .get(company.id ?? randomUUID(), organizationId, company.name, normalizedName, company.websiteUrl, company.phone, new Date().toISOString());

  return row.id;
}

function upsertLocation(db, companyId, location = {}) {
  if (!location.city && !location.state && !location.postalCode && !location.addressLine1) return;

  db.prepare(
    `
      insert or ignore into company_locations(id, company_id, address_line1, city, state, postal_code, is_primary)
      values (?, ?, ?, ?, ?, ?, 1)
    `
  ).run(randomUUID(), companyId, location.addressLine1, location.city, location.state, location.postalCode);
}

function upsertGafListing(db, companyId, company, rawListing, scrape) {
  db.prepare(
    `
      insert into gaf_listings(
        id,
        company_id,
        source_zip,
        search_distance_miles,
        distance_miles,
        gaf_profile_url,
        certification_level,
        badges,
        specialties,
        raw_payload,
        last_seen_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(company_id, source_zip, search_distance_miles)
      do update set
        distance_miles = excluded.distance_miles,
        gaf_profile_url = excluded.gaf_profile_url,
        certification_level = excluded.certification_level,
        badges = excluded.badges,
        specialties = excluded.specialties,
        raw_payload = excluded.raw_payload,
        last_seen_at = excluded.last_seen_at
    `
  ).run(
    randomUUID(),
    companyId,
    scrape.sourceZip,
    scrape.searchDistanceMiles,
    company.location.distanceMiles,
    company.gaf.profileUrl,
    company.gaf.certificationLevel,
    stringifyJson(company.gaf.badges ?? []),
    stringifyJson(company.gaf.specialties ?? []),
    stringifyJson(rawListing),
    new Date().toISOString()
  );
}

function insertCompanyMetrics(db, companyId, company) {
  const metrics = company.metrics;
  const enrichedAt = company.lastEnrichedAt ?? new Date().toISOString();

  db.prepare(
    `
      insert into company_metrics(
        id,
        company_id,
        employee_count_estimate,
        annual_revenue_estimate,
        years_in_business,
        location_count,
        review_rating,
        review_count,
        recent_review_count_90d,
        hiring_signal_count,
        website_quality_score,
        service_breadth_score,
        growth_signal_score,
        social_activity_score,
        contact_confidence_score,
        has_financing,
        decision_maker_found,
        residential_focus,
        storm_damage_focus,
        solar_service,
        metal_roofing_service,
        metrics_payload,
        sources_payload,
        calculated_at
      )
      values (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `
  ).run(
    randomUUID(),
    companyId,
    metrics.employeeCountEstimate,
    metrics.annualRevenueEstimate,
    metrics.yearsInBusiness,
    metrics.locationCount,
    metrics.reviewRating,
    metrics.reviewCount,
    metrics.recentReviewCount90d,
    metrics.hiringSignalCount,
    metrics.websiteQualityScore,
    metrics.serviceBreadthScore,
    metrics.growthSignalScore,
    metrics.socialActivityScore,
    metrics.contactConfidenceScore,
    toDbBoolean(metrics.hasFinancing),
    toDbBoolean(metrics.decisionMakerFound),
    toDbBoolean(metrics.residentialFocus),
    toDbBoolean(metrics.stormDamageFocus),
    toDbBoolean(metrics.solarService),
    toDbBoolean(metrics.metalRoofingService),
    stringifyJson({
      enrichedAt,
      websiteFreshnessScore: metrics.websiteFreshnessScore,
      vendorStackVisible: metrics.vendorStackVisible,
      emailFound: metrics.emailFound,
      services: metrics.services,
      salesSummary: company.salesSummary,
      priorityRationale: company.priorityRationale,
      buyingSignals: company.buyingSignals,
      riskFlags: company.riskFlags,
      contacts: company.contacts
    }),
    stringifyJson(company.sources),
    enrichedAt
  );
}

function insertCompanySource(db, companyId, company) {
  const profileUrl = company.gaf.profileUrl;
  if (!profileUrl) return;

  db.prepare(
    `
      insert or ignore into company_sources(id, company_id, source_type, source_url, title, evidence)
      values (?, ?, 'gaf', ?, 'GAF contractor profile', ?)
    `
  ).run(randomUUID(), companyId, profileUrl, company.score?.reasons?.[0] ?? null);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

function toBoolean(value) {
  if (value === null || value === undefined) return null;
  return Boolean(value);
}

function toDbBoolean(value) {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

function toInteger(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
