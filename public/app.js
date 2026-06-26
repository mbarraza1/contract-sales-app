const state = {
  companies: [],
  selectedId: null
};

const elements = {
  companyRows: document.querySelector('#companyRows'),
  companyDetail: document.querySelector('#companyDetail'),
  emptyState: document.querySelector('#emptyState'),
  searchInput: document.querySelector('#searchInput'),
  stateSelect: document.querySelector('#stateSelect'),
  scoreSelect: document.querySelector('#scoreSelect'),
  refreshButton: document.querySelector('#refreshButton'),
  companyCount: document.querySelector('#companyCount'),
  highPriority: document.querySelector('#highPriority'),
  averageScore: document.querySelector('#averageScore'),
  radius: document.querySelector('#radius'),
  sourceBadge: document.querySelector('#sourceBadge'),
  modelBadge: document.querySelector('#modelBadge')
};

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

function scoreClass(score) {
  if (score >= 70) return 'score-high';
  if (score >= 55) return 'score-mid';
  return 'score-low';
}

function formatRevenue(value) {
  if (!value) return 'Unknown';
  if (value >= 1000000) return `${currency.format(value / 1000000)}M`;
  return currency.format(value);
}

function primaryLink(company) {
  if (company.websiteUrl) {
    return {
      href: company.websiteUrl,
      label: 'Website'
    };
  }

  if (company.gaf?.profileUrl) {
    return {
      href: company.gaf.profileUrl,
      label: 'GAF profile'
    };
  }

  return null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderSummary(summary) {
  elements.companyCount.textContent = summary.companyCount;
  elements.highPriority.textContent = summary.highPriority;
  elements.averageScore.textContent = summary.averageScore;
  elements.radius.textContent = `${summary.searchDistanceMiles} mi`;
  elements.sourceBadge.textContent = sourceLabel(summary.source);
  elements.modelBadge.textContent = summary.scoringModelVersion;
}

function sourceLabel(source) {
  if (source === 'postgres') return 'PostgreSQL';
  if (source === 'gaf_cache') return 'GAF cache';
  if (source === 'demo_fallback') return 'Demo fallback';
  if (source === 'demo_empty_postgres') return 'Empty DB demo';
  return 'Demo data';
}

function renderStateOptions(states) {
  const current = elements.stateSelect.value;
  elements.stateSelect.innerHTML = '<option value="all">All states</option>';

  for (const stateCode of states) {
    const option = document.createElement('option');
    option.value = stateCode;
    option.textContent = stateCode;
    elements.stateSelect.append(option);
  }

  elements.stateSelect.value = states.includes(current) ? current : 'all';
}

function renderRows(companies) {
  elements.companyRows.innerHTML = companies
    .map((company, index) => {
      const firstReason = company.score.reasons[0] ?? 'Awaiting enrichment signals.';
      const isSelected = company.id === state.selectedId ? 'selected' : '';
      const link = primaryLink(company);
      return `
        <tr class="${isSelected}" data-company-id="${escapeHtml(company.id)}">
          <td class="rank">#${index + 1}</td>
          <td class="company-cell">
            <strong>${escapeHtml(company.name)}</strong>
            ${link ? `<a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>` : '<span class="muted">No link</span>'}
          </td>
          <td>${escapeHtml(company.location.city)}, ${escapeHtml(company.location.state)}<br><span class="muted">${company.location.distanceMiles} mi</span></td>
          <td><span class="score-pill ${scoreClass(company.score.totalScore)}">${company.score.totalScore}</span></td>
          <td>${company.score.buyingLikelihoodScore}</td>
          <td>${company.score.companySizeScore}</td>
          <td>${escapeHtml(company.gaf.certificationLevel ?? 'Unknown')}</td>
          <td>${company.metrics.reviewRating} / ${company.metrics.reviewCount}</td>
          <td>${company.metrics.employeeCountEstimate ?? 'Unknown'}</td>
          <td>${formatRevenue(company.metrics.annualRevenueEstimate)}</td>
          <td class="reason-cell">${escapeHtml(firstReason)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderDetail(company) {
  if (!company) {
    elements.companyDetail.classList.add('hidden');
    elements.emptyState.classList.remove('hidden');
    return;
  }

  elements.emptyState.classList.add('hidden');
  elements.companyDetail.classList.remove('hidden');

  const services = company.metrics.services ?? [];
  const sources = company.sources ?? [];
  const link = primaryLink(company);

  elements.companyDetail.innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(company.name)}</h2>
      <div class="detail-meta">
        ${escapeHtml(company.location.city)}, ${escapeHtml(company.location.state)} · ${company.location.distanceMiles} mi from 10013
        ${link ? ` · <a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>` : ''}
      </div>
    </div>

    <div class="score-grid">
      <div class="score-box">
        <span>Priority</span>
        <strong>${company.score.totalScore}</strong>
      </div>
      <div class="score-box">
        <span>Buy</span>
        <strong>${company.score.buyingLikelihoodScore}</strong>
      </div>
      <div class="score-box">
        <span>Size</span>
        <strong>${company.score.companySizeScore}</strong>
      </div>
    </div>

    <section>
      <p class="section-title">Buy Drivers</p>
      <div class="facet-grid">
        ${facet('Activity', company.score.facets.buyingLikelihood.recentActivity)}
        ${facet('Growth', company.score.facets.buyingLikelihood.growth)}
        ${facet('Need', company.score.facets.buyingLikelihood.purchaseNeed)}
        ${facet('Fit', company.score.facets.buyingLikelihood.serviceFit)}
        ${facet('Maturity', company.score.facets.buyingLikelihood.maturity)}
        ${facet('Contact', company.score.contactabilityScore * 10)}
      </div>
    </section>

    <section>
      <p class="section-title">Why Ranked Here</p>
      <ul class="reason-list">
        ${company.score.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}
      </ul>
    </section>

    <section>
      <p class="section-title">Company Metrics</p>
      <div class="facet-grid">
        ${facet('Employees', company.metrics.employeeCountEstimate ?? 'Unknown')}
        ${facet('Revenue', formatRevenue(company.metrics.annualRevenueEstimate))}
        ${facet('Reviews', `${company.metrics.reviewRating} / ${company.metrics.reviewCount}`)}
        ${facet('Years', company.metrics.yearsInBusiness ?? 'Unknown')}
        ${facet('Locations', company.metrics.locationCount ?? 'Unknown')}
        ${facet('GAF', company.gaf.certificationLevel ?? 'Unknown')}
      </div>
    </section>

    <section>
      <p class="section-title">Services</p>
      <ul class="service-list">
        ${services.map((service) => `<li>${escapeHtml(service)}</li>`).join('')}
      </ul>
    </section>

    <section>
      <p class="section-title">Sources</p>
      <ul class="source-list">
        ${sources.map((source) => `<li>${escapeHtml(source.title ?? source.type)}${source.url ? ` · ${escapeHtml(source.url)}` : ''}</li>`).join('')}
      </ul>
    </section>
  `;
}

function facet(label, value) {
  return `
    <div class="facet-box">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function syncSelection() {
  const selected = state.companies.find((company) => company.id === state.selectedId) ?? state.companies[0];
  state.selectedId = selected?.id ?? null;
  renderRows(state.companies);
  renderDetail(selected);
}

async function loadCompanies() {
  const params = new URLSearchParams({
    q: elements.searchInput.value,
    state: elements.stateSelect.value,
    minScore: elements.scoreSelect.value
  });

  const response = await fetch(`/api/companies?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to load companies');

  const payload = await response.json();
  state.companies = payload.companies;
  renderSummary(payload.summary);
  renderStateOptions(payload.summary.states);
  syncSelection();
}

elements.companyRows.addEventListener('click', (event) => {
  const row = event.target.closest('tr[data-company-id]');
  if (!row) return;
  state.selectedId = row.dataset.companyId;
  syncSelection();
});

elements.searchInput.addEventListener('input', () => {
  window.clearTimeout(elements.searchInput.searchTimer);
  elements.searchInput.searchTimer = window.setTimeout(loadCompanies, 180);
});

elements.stateSelect.addEventListener('change', loadCompanies);
elements.scoreSelect.addEventListener('change', loadCompanies);
elements.refreshButton.addEventListener('click', loadCompanies);

loadCompanies().catch((error) => {
  console.error(error);
  elements.companyRows.innerHTML = '<tr><td colspan="11">Unable to load companies.</td></tr>';
});
