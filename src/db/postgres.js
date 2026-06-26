import { mapGafListingToCompany, normalizeCompanyName } from '../services/gafMapper.js';

export async function loadCompaniesFromPostgres(databaseUrl) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const { rows } = await pool.query(`
      select
        c.id::text,
        c.name,
        c.website_url,
        c.phone,
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
      left join lateral (
        select *
        from company_locations
        where company_id = c.id
        order by is_primary desc, created_at desc
        limit 1
      ) loc on true
      left join lateral (
        select *
        from gaf_listings
        where company_id = c.id
        order by last_seen_at desc
        limit 1
      ) gl on true
      left join lateral (
        select *
        from company_metrics
        where company_id = c.id
        order by calculated_at desc
        limit 1
      ) cm on true
      order by c.name asc
    `);

    return rows.map(mapCompanyRow);
  } finally {
    await pool.end();
  }
}

function mapCompanyRow(row) {
  const payload = row.metrics_payload ?? {};

  return {
    id: row.id,
    name: row.name,
    websiteUrl: row.website_url,
    phone: row.phone,
    location: {
      city: row.city,
      state: row.state,
      postalCode: row.postal_code,
      distanceMiles: row.distance_miles === null ? null : Number(row.distance_miles)
    },
      gaf: {
      sourceZip: row.source_zip,
      searchDistanceMiles: row.search_distance_miles,
      profileUrl: row.gaf_profile_url,
      certificationLevel: row.certification_level,
      badges: row.badges ?? [],
      specialties: row.specialties ?? []
    },
    metrics: {
      employeeCountEstimate: row.employee_count_estimate,
      annualRevenueEstimate: Number(row.annual_revenue_estimate ?? 0),
      yearsInBusiness: row.years_in_business,
      locationCount: row.location_count,
      reviewRating: Number(row.review_rating ?? 0),
      reviewCount: row.review_count,
      recentReviewCount90d: row.recent_review_count_90d,
      hiringSignalCount: row.hiring_signal_count,
      websiteQualityScore: row.website_quality_score,
      websiteFreshnessScore: payload.websiteFreshnessScore ?? row.website_quality_score,
      serviceBreadthScore: row.service_breadth_score,
      growthSignalScore: row.growth_signal_score,
      socialActivityScore: row.social_activity_score,
      contactConfidenceScore: row.contact_confidence_score,
      hasFinancing: row.has_financing,
      vendorStackVisible: payload.vendorStackVisible ?? false,
      decisionMakerFound: row.decision_maker_found,
      emailFound: payload.emailFound ?? false,
      residentialFocus: row.residential_focus,
      stormDamageFocus: row.storm_damage_focus,
      solarService: row.solar_service,
      metalRoofingService: row.metal_roofing_service,
      services: payload.services ?? []
    },
    sources: row.sources_payload ?? [],
    lastEnrichedAt: row.calculated_at
  };
}

export async function upsertGafScrapeResults(databaseUrl, scrape, { organizationName }) {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  const stats = {
    companies: 0,
    listings: 0,
    metrics: 0
  };

  try {
    await client.query('begin');
    const runId = await createIngestionRun(client, scrape);
    const organizationId = await ensureOrganization(client, organizationName);

    for (const listing of scrape.listings ?? []) {
      const company = mapGafListingToCompany({
        ...listing,
        sourceZip: listing.sourceZip ?? scrape.sourceZip,
        searchDistanceMiles: listing.searchDistanceMiles ?? scrape.searchDistanceMiles,
        scrapedAt: listing.scrapedAt ?? scrape.scrapedAt
      });
      const companyId = await upsertCompany(client, organizationId, company);

      await upsertLocation(client, companyId, company.location);
      await upsertGafListing(client, companyId, company, listing, scrape);
      await insertCompanyMetrics(client, companyId, company);
      await insertCompanySource(client, companyId, company);

      stats.companies += 1;
      stats.listings += 1;
      stats.metrics += 1;
    }

    await finishIngestionRun(client, runId, 'succeeded', stats);
    await client.query('commit');
    return stats;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function ensureOrganization(client, name) {
  const { rows } = await client.query(
    `
      insert into organizations(name)
      values ($1)
      on conflict (name) do update set name = excluded.name
      returning id
    `,
    [name]
  );

  return rows[0].id;
}

async function createIngestionRun(client, scrape) {
  const { rows } = await client.query(
    `
      insert into ingestion_runs(source, source_zip, search_distance_miles, result_payload)
      values ('gaf', $1, $2, $3::jsonb)
      returning id
    `,
    [
      scrape.sourceZip,
      scrape.searchDistanceMiles,
      JSON.stringify({
        sourceUrl: scrape.sourceUrl,
        scrapedAt: scrape.scrapedAt
      })
    ]
  );

  return rows[0].id;
}

async function finishIngestionRun(client, runId, status, stats) {
  await client.query(
    `
      update ingestion_runs
      set status = $2,
          finished_at = now(),
          result_payload = result_payload || $3::jsonb
      where id = $1
    `,
    [runId, status, JSON.stringify(stats)]
  );
}

async function upsertCompany(client, organizationId, company) {
  const normalizedName = normalizeCompanyName(company.name);
  const { rows } = await client.query(
    `
      insert into companies(organization_id, name, normalized_name, website_url, phone)
      values ($1, $2, $3, $4, $5)
      on conflict (organization_id, normalized_name)
      do update set
        name = excluded.name,
        website_url = coalesce(excluded.website_url, companies.website_url),
        phone = coalesce(excluded.phone, companies.phone),
        updated_at = now()
      returning id
    `,
    [organizationId, company.name, normalizedName, company.websiteUrl, company.phone]
  );

  return rows[0].id;
}

async function upsertLocation(client, companyId, location = {}) {
  if (!location.city && !location.state && !location.postalCode && !location.addressLine1) return;

  const existing = await client.query(
    `
      select id
      from company_locations
      where company_id = $1
        and coalesce(address_line1, '') = coalesce($2, '')
        and coalesce(city, '') = coalesce($3, '')
        and coalesce(state, '') = coalesce($4, '')
        and coalesce(postal_code, '') = coalesce($5, '')
      limit 1
    `,
    [companyId, location.addressLine1, location.city, location.state, location.postalCode]
  );

  if (existing.rows.length > 0) return;

  await client.query(
    `
      insert into company_locations(company_id, address_line1, city, state, postal_code, is_primary)
      values ($1, $2, $3, $4, $5, true)
    `,
    [companyId, location.addressLine1, location.city, location.state, location.postalCode]
  );
}

async function upsertGafListing(client, companyId, company, rawListing, scrape) {
  await client.query(
    `
      insert into gaf_listings(
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
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
      on conflict (company_id, source_zip, search_distance_miles)
      do update set
        distance_miles = excluded.distance_miles,
        gaf_profile_url = excluded.gaf_profile_url,
        certification_level = excluded.certification_level,
        badges = excluded.badges,
        specialties = excluded.specialties,
        raw_payload = excluded.raw_payload,
        last_seen_at = now()
    `,
    [
      companyId,
      scrape.sourceZip,
      scrape.searchDistanceMiles,
      company.location.distanceMiles,
      company.gaf.profileUrl,
      company.gaf.certificationLevel,
      company.gaf.badges,
      company.gaf.specialties,
      JSON.stringify(rawListing)
    ]
  );
}

async function insertCompanyMetrics(client, companyId, company) {
  const metrics = company.metrics;

  await client.query(
    `
      insert into company_metrics(
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
        sources_payload
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21::jsonb, $22::jsonb
      )
    `,
    [
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
      metrics.hasFinancing,
      metrics.decisionMakerFound,
      metrics.residentialFocus,
      metrics.stormDamageFocus,
      metrics.solarService,
      metrics.metalRoofingService,
      JSON.stringify({
        websiteFreshnessScore: metrics.websiteFreshnessScore,
        vendorStackVisible: metrics.vendorStackVisible,
        emailFound: metrics.emailFound,
        services: metrics.services
      }),
      JSON.stringify(company.sources)
    ]
  );
}

async function insertCompanySource(client, companyId, company) {
  const profileUrl = company.gaf.profileUrl;
  if (!profileUrl) return;

  const existing = await client.query(
    `
      select id
      from company_sources
      where company_id = $1
        and source_type = 'gaf'
        and source_url = $2
      limit 1
    `,
    [companyId, profileUrl]
  );

  if (existing.rows.length > 0) return;

  await client.query(
    `
      insert into company_sources(company_id, source_type, source_url, title, evidence)
      values ($1, 'gaf', $2, 'GAF contractor profile', $3)
    `,
    [companyId, profileUrl, company.score?.reasons?.[0] ?? null]
  );
}
