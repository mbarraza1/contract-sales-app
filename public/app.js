const state = {
  companies: [],
  selectedId: null,
  sessionToken: loadSessionToken()
};

const elements = {
  companyRows: document.querySelector('#companyRows'),
  companyDetail: document.querySelector('#companyDetail'),
  emptyState: document.querySelector('#emptyState'),
  searchInput: document.querySelector('#searchInput'),
  stateSelect: document.querySelector('#stateSelect'),
  scoreSelect: document.querySelector('#scoreSelect'),
  favoritesOnly: document.querySelector('#favoritesOnly'),
  refreshButton: document.querySelector('#refreshButton'),
  companyCount: document.querySelector('#companyCount'),
  highPriority: document.querySelector('#highPriority'),
  favoriteCount: document.querySelector('#favoriteCount'),
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

function loadSessionToken() {
  const storageKey = 'contractSalesSessionToken';
  const existing = window.localStorage.getItem(storageKey);
  if (existing) return existing;

  const token =
    window.crypto?.randomUUID?.() ??
    `session-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const sessionToken = `rep-${token}`;
  window.localStorage.setItem(storageKey, sessionToken);
  return sessionToken;
}

function sessionHeaders() {
  return {
    'X-Session-Token': state.sessionToken
  };
}

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
  elements.favoriteCount.textContent = summary.favoriteCount ?? 0;
  elements.averageScore.textContent = summary.averageScore;
  elements.radius.textContent = `${summary.searchDistanceMiles} mi`;
  elements.sourceBadge.textContent = sourceLabel(summary.source);
  elements.modelBadge.textContent = summary.scoringModelVersion;
}

function sourceLabel(source) {
  if (source === 'sqlite') return 'SQLite';
  if (source === 'gaf_cache') return 'GAF cache';
  if (source === 'demo_fallback') return 'Demo fallback';
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
          <td>${favoriteButton(company)}</td>
          <td class="rank">#${index + 1}</td>
          <td class="company-cell">
            <strong>${escapeHtml(company.name)}</strong>
            ${link ? `<a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>` : '<span class="muted">No link</span>'}
          </td>
          <td>${escapeHtml(company.location.city)}, ${escapeHtml(company.location.state)}<br><span class="muted">${company.location.distanceMiles} mi</span></td>
          <td><span class="score-pill ${scoreClass(company.score.priorityScore)}">${company.score.priorityScore}</span></td>
          <td>${company.metrics.employeeCountEstimate ?? 'Unknown'}</td>
          <td>${formatRevenue(company.metrics.annualRevenueEstimate)}</td>
          <td>${company.metrics.reviewRating} / ${company.metrics.reviewCount}</td>
          <td>${company.buyingSignals?.length ?? 0}</td>
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
  const drivers = company.score.drivers ?? {};
  const link = primaryLink(company);

  elements.companyDetail.innerHTML = `
    <div class="detail-header">
      <div class="detail-title-row">
        <h2>${escapeHtml(company.name)}</h2>
        ${favoriteButton(company, 'detail')}
      </div>
      <div class="detail-meta">
        ${escapeHtml(company.location.city)}, ${escapeHtml(company.location.state)} · ${company.location.distanceMiles} mi from 10013
        ${link ? ` · <a href="${escapeHtml(link.href)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a>` : ''}
      </div>
    </div>

    <div class="score-grid">
      <div class="score-box">
        <span>Priority Score</span>
        <strong>${company.score.priorityScore}</strong>
      </div>
      <div class="score-box">
        <span>Buying Signals</span>
        <strong>${company.buyingSignals?.length ?? 0}</strong>
      </div>
      <div class="score-box">
        <span>Sources</span>
        <strong>${sources.length}</strong>
      </div>
    </div>

    <section>
      <p class="section-title">Priority Drivers</p>
      <div class="facet-grid">
        ${facet('Company Scale', drivers.companyScale)}
        ${facet('Contactability', drivers.contactability)}
        ${facet('Buying Signals', drivers.buyingSignals)}
        ${facet('Service Fit', drivers.serviceFit)}
        ${facet('Growth', drivers.growth)}
        ${facet('Reputation', drivers.reputation)}
        ${facet('Purchase Need', drivers.purchaseNeed)}
      </div>
    </section>

    <section>
      <p class="section-title">Why Ranked Here</p>
      <ul class="reason-list">
        ${company.score.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}
      </ul>
    </section>

    ${company.salesSummary ? `
      <section>
        <p class="section-title">Sales Summary</p>
        <ul class="reason-list">
          <li>${escapeHtml(company.salesSummary)}</li>
        </ul>
      </section>
    ` : ''}

    ${signalList('Buying Signals', company.buyingSignals)}
    ${signalList('Risk Flags', company.riskFlags)}

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

function favoriteButton(company, variant = 'row') {
  const label = company.favorite ? 'Remove from favorites' : 'Add to favorites';
  return `
    <button
      class="favorite-button ${company.favorite ? 'is-favorite' : ''} ${variant === 'detail' ? 'favorite-button-large' : ''}"
      type="button"
      data-company-id="${escapeHtml(company.id)}"
      data-favorite-next="${company.favorite ? 'false' : 'true'}"
      aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}"
    >
      <span aria-hidden="true">${company.favorite ? '★' : '☆'}</span>
    </button>
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

function signalList(title, values) {
  if (!Array.isArray(values) || values.length === 0) return '';

  return `
    <section>
      <p class="section-title">${escapeHtml(title)}</p>
      <ul class="reason-list">
        ${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}
      </ul>
    </section>
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
    minScore: elements.scoreSelect.value,
    favoritesOnly: elements.favoritesOnly.checked ? 'true' : 'false'
  });

  const response = await fetch(`/api/companies?${params.toString()}`, {
    headers: sessionHeaders()
  });
  if (!response.ok) throw new Error('Failed to load companies');

  const payload = await response.json();
  state.companies = payload.companies;
  renderSummary(payload.summary);
  renderStateOptions(payload.summary.states);
  syncSelection();
}

async function toggleFavorite(companyId, favorite) {
  const response = await fetch(`/api/favorites/${encodeURIComponent(companyId)}`, {
    method: favorite ? 'PUT' : 'DELETE',
    headers: {
      ...sessionHeaders(),
      'Content-Type': 'application/json'
    },
    body: favorite ? '{}' : undefined
  });

  if (!response.ok) throw new Error('Failed to update favorite');
  await loadCompanies();
}

elements.companyRows.addEventListener('click', (event) => {
  const favoriteControl = event.target.closest('.favorite-button');
  if (favoriteControl) {
    event.stopPropagation();
    toggleFavorite(favoriteControl.dataset.companyId, favoriteControl.dataset.favoriteNext === 'true').catch((error) => {
      console.error(error);
    });
    return;
  }

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
elements.favoritesOnly.addEventListener('change', loadCompanies);
elements.refreshButton.addEventListener('click', loadCompanies);

elements.companyDetail.addEventListener('click', (event) => {
  const favoriteControl = event.target.closest('.favorite-button');
  if (!favoriteControl) return;
  toggleFavorite(favoriteControl.dataset.companyId, favoriteControl.dataset.favoriteNext === 'true').catch((error) => {
    console.error(error);
  });
});

loadCompanies().catch((error) => {
  console.error(error);
  elements.companyRows.innerHTML = '<tr><td colspan="10">Unable to load companies.</td></tr>';
});
