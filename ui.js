import { clamp } from './math.js';

function el(id) {
  return document.getElementById(id);
}

function safeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function initRoutes(onRouteChange) {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const route = tab.dataset.route;
      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.screen').forEach((screen) => {
        screen.classList.toggle('active', screen.id === `screen-${route}`);
      });
      onRouteChange(route);
    });
  });
}

function sumEntries(entries) {
  return entries.reduce(
    (acc, item) => {
      acc.kcal += safeNum(item.kcal);
      acc.p += safeNum(item.p);
      acc.c += safeNum(item.c);
      acc.f += safeNum(item.f);
      return acc;
    },
    { kcal: 0, p: 0, c: 0, f: 0 }
  );
}

function macroProgress(label, value, goal) {
  if (!goal || goal <= 0) {
    return `<div class="progress-row"><strong>${label}</strong><progress max="1" value="0"></progress><span>${Math.round(value)}g / —</span></div>`;
  }
  const ratio = clamp(value / goal, 0, 1.5);
  return `<div class="progress-row"><strong>${label}</strong><progress max="1" value="${Math.min(1, ratio)}"></progress><span>${Math.round(value)}g / ${Math.round(goal)}g</span></div>`;
}

export function renderPersonsList(persons, todayStatsByPerson = {}) {
  const wrap = el('personsList');
  if (!persons.length) {
    wrap.innerHTML = '<p class="muted">No persons yet. Add one in Settings.</p>';
    return;
  }

  wrap.innerHTML = persons
    .map((p) => {
      const stats = todayStatsByPerson[p.id] || { kcal: 0, p: 0, c: 0, f: 0 };
      const remaining = p.kcalGoal - stats.kcal;
      return `
      <article class="card">
        <h3>${p.name}</h3>
        <p>${Math.round(stats.kcal)} / ${p.kcalGoal} kcal • remaining ${Math.round(remaining)}</p>
        <div class="stat-rows">
          ${macroProgress('P', stats.p, p.macroTargets?.p)}
          ${macroProgress('C', stats.c, p.macroTargets?.c)}
          ${macroProgress('F', stats.f, p.macroTargets?.f)}
        </div>
      </article>`;
    })
    .join('');
}


export function renderNutritionPersonPicker(persons, selectedId) {
  const html = persons.length
    ? persons.map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.name}</option>`).join('')
    : '<option value="">No persons</option>';
  el('nutritionPersonPicker').innerHTML = html;
}

export function setNutritionDefaultDate(date) {
  el('nutritionDatePicker').value = date;
}

function formatMicroAmount(value, unit) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value * 100) / 100}${unit}`;
}

export function renderNutritionOverview(rows, hasAnyData) {
  const wrap = el('nutritionOverviewList');
  if (!hasAnyData) {
    wrap.innerHTML = '<p class="muted">No micronutrient data available</p>';
    return;
  }

  wrap.innerHTML = rows
    .map((row) => {
      const progressValue = row.target && row.amount !== null ? Math.min(1, row.amount / row.target) : 0;
      const targetText = row.target ? `${Math.round(row.target * 100) / 100}${row.unit}` : '—';
      const percentText = row.target && row.percent !== null ? `${row.percent}%` : '—';

      return `<article class="nutrition-row">
        <div class="nutrition-row-head">
          <strong>${row.label}</strong>
          <span>${formatMicroAmount(row.amount, row.unit)}</span>
        </div>
        <progress max="1" value="${progressValue}"></progress>
        <div class="muted tiny">Target: ${targetText} • ${percentText}</div>
      </article>`;
    })
    .join('');
}

export function renderPersonPicker(persons, selectedId) {
  const html = persons.length
    ? persons
        .map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.name}</option>`)
        .join('')
    : '<option value="">No persons</option>';
  el('personPicker').innerHTML = html;
  el('addPersonPicker').innerHTML = html;
}

function renderMacroCard({ label, consumed, goal, kcalFactor, view, toneClass, personKcalGoal }) {
  const safeGoal = Number.isFinite(goal) && goal > 0 ? goal : null;
  const remaining = safeGoal != null ? Math.max(0, safeGoal - consumed) : null;
  const consumedPct = safeGoal ? Math.min(100, Math.round((consumed / safeGoal) * 100)) : 0;
  const metTarget = safeGoal ? consumed >= safeGoal : false;

  let valueText = `${Math.round(consumed)}g consumed`;
  if (view === 'remaining') valueText = remaining == null ? '— remaining' : `${Math.round(remaining)}g remaining`;
  if (view === 'percent') {
    const consumedKcal = consumed * kcalFactor;
    valueText = safeGoal ? `${Math.round((consumedKcal / (personKcalGoal || 1)) * 100)}% of kcal` : `${Math.round(consumedKcal)} kcal`;
  }

  return `<article class="macro-card ${toneClass} ${metTarget ? 'goal-met' : ''}">
    <div class="macro-card-head">
      <strong>${label}</strong>
      <span>${safeGoal ? `${Math.round(consumed)}g / ${Math.round(safeGoal)}g` : `${Math.round(consumed)}g`}</span>
    </div>
    <div class="macro-card-value">${valueText}</div>
    <div class="macro-track"><div class="macro-fill" style="width:${consumedPct}%"></div></div>
  </article>`;
}

export function renderDashboard(person, date, entries, options = {}) {
  const totals = sumEntries(entries);
  const consumedKcal = Math.round(totals.kcal);
  const remainingKcal = Math.max(0, Math.round(person.kcalGoal - totals.kcal));
  const kcalProgress = person.kcalGoal > 0 ? Math.min(100, Math.round((totals.kcal / person.kcalGoal) * 100)) : 0;
  const macroView = options.macroView || 'consumed';
  const streakDays = Number.isFinite(options.streakDays) ? options.streakDays : 0;

  el('dashboardSummary').innerHTML = `
    <section class="dashboard-hero">
      <article class="hero-card hero-calories">
        <h3>Calories consumed</h3>
        <p class="hero-value">${consumedKcal}</p>
        <p class="muted tiny">Goal ${person.kcalGoal} kcal</p>
        <div class="macro-track"><div class="macro-fill" style="width:${kcalProgress}%"></div></div>
      </article>
      <article class="hero-card hero-remaining ${remainingKcal <= 0 ? 'goal-met' : ''}">
        <h3>Calories remaining</h3>
        <p class="hero-value">${remainingKcal}</p>
        <p class="muted tiny">${remainingKcal <= 0 ? 'Daily target reached' : 'Keep going'}</p>
      </article>
    </section>

    <section class="dashboard-macros">
      <div class="row-actions macro-view-toggle" role="group" aria-label="Macro display mode">
        <button type="button" class="secondary ${macroView === 'consumed' ? 'active' : ''}" data-macro-view="consumed">Consumed (g)</button>
        <button type="button" class="secondary ${macroView === 'remaining' ? 'active' : ''}" data-macro-view="remaining">Remaining (g)</button>
        <button type="button" class="secondary ${macroView === 'percent' ? 'active' : ''}" data-macro-view="percent">% Calories</button>
      </div>
      <div class="macro-grid">
        ${renderMacroCard({ label: 'Protein', consumed: totals.p, goal: person.macroTargets?.p, kcalFactor: 4, view: macroView, toneClass: 'macro-protein', personKcalGoal: person.kcalGoal })}
        ${renderMacroCard({ label: 'Carbs', consumed: totals.c, goal: person.macroTargets?.c, kcalFactor: 4, view: macroView, toneClass: 'macro-carbs', personKcalGoal: person.kcalGoal })}
        ${renderMacroCard({ label: 'Fat', consumed: totals.f, goal: person.macroTargets?.f, kcalFactor: 9, view: macroView, toneClass: 'macro-fat', personKcalGoal: person.kcalGoal })}
      </div>
    </section>

    <section class="streak-card">
      <h3>Logging streak</h3>
      <p><strong>${streakDays} day${streakDays === 1 ? '' : 's'}</strong> in a row</p>
      <div class="macro-track"><div class="macro-fill" style="width:${Math.min(100, streakDays * 10)}%"></div></div>
    </section>

    <section class="habits-card">
      <h3>Healthy Habits</h3>
      <div class="habit-grid">
        <article>
          <strong>Water</strong>
          <p class="muted tiny">Placeholder: water tracking coming soon.</p>
        </article>
        <article>
          <strong>Exercise</strong>
          <p class="muted tiny">Placeholder: exercise tracking coming soon.</p>
        </article>
      </div>
    </section>
    <p class="muted">Date: ${date}</p>
  `;

  el('entriesTableContainer').innerHTML = entries.length
    ? `<table>
      <thead><tr><th>Time</th><th>Food</th><th>Amount</th><th>kcal</th><th>P</th><th>C</th><th>F</th><th>Source</th></tr></thead>
      <tbody>
      ${entries
        .map(
          (e) => `<tr>
          <td>${e.time}</td><td>${e.foodName}</td><td>${e.amountGrams}g</td><td>${e.kcal}</td><td>${e.p}</td><td>${e.c}</td><td>${e.f}</td><td>${e.source}</td>
        </tr>`
        )
        .join('')}
      </tbody>
    </table>`
    : '<p class="muted">No entries for this date.</p>';
}

export function renderDashboardEmpty() {
  el('dashboardSummary').innerHTML = '<p class="muted">No persons available. Add a person in Settings.</p>';
  el('entriesTableContainer').innerHTML = '';
}

export function renderSettingsPersons(persons) {
  const container = el('settingsPersons');
  if (!persons.length) {
    container.innerHTML = '<p class="muted">No persons yet.</p>';
    return;
  }

  container.innerHTML = persons
    .map(
      (p) => `<article class="settings-person-row">
      <div>
        <strong>${p.name}</strong><br />
        <span>${p.kcalGoal} kcal/day</span><br />
        <span class="muted">P:${p.macroTargets?.p ?? '—'} C:${p.macroTargets?.c ?? '—'} F:${p.macroTargets?.f ?? '—'}</span>
      </div>
      <div class="settings-actions">
        <button class="secondary" data-action="edit-person" data-person-id="${p.id}">Edit</button>
        <button class="danger" data-action="delete-person" data-person-id="${p.id}">Delete</button>
      </div>
    </article>`
    )
    .join('');
}

export function fillPersonForm(person) {
  el('personId').value = person?.id || '';
  el('personName').value = person?.name || '';
  el('personKcalGoal').value = person?.kcalGoal || 2000;
  el('personMacroP').value = person?.macroTargets?.p ?? '';
  el('personMacroC').value = person?.macroTargets?.c ?? '';
  el('personMacroF').value = person?.macroTargets?.f ?? '';
  el('cancelEditBtn').hidden = !person;
}

export function readPersonForm() {
  const parseOptional = (value) => {
    if (value === '' || value === null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  return {
    id: el('personId').value || crypto.randomUUID(),
    name: el('personName').value.trim(),
    kcalGoal: Number(el('personKcalGoal').value),
    macroTargets: {
      p: parseOptional(el('personMacroP').value),
      c: parseOptional(el('personMacroC').value),
      f: parseOptional(el('personMacroF').value)
    }
  };
}

function renderFoodList(containerId, items, favoritesSet, emptyText) {
  const wrap = el(containerId);
  if (!items.length) {
    wrap.innerHTML = `<p class="muted">${emptyText}</p>`;
    return;
  }

  wrap.innerHTML = items
    .map((item) => {
      const star = favoritesSet.has(item.foodId) ? '★' : '☆';
      return `<button class="suggestion" data-action="pick-food" data-food-id="${item.foodId}">
        <div>
          <strong>${item.label}</strong>
          <div class="muted tiny">${item.groupLabel}</div>
          ${item.isGeneric ? '<div class="muted tiny">Generic built-in (approx.)</div>' : ''}
        </div>
        <div class="suggestion-actions">
          <span class="star" data-action="toggle-favorite" data-food-id="${item.foodId}" role="button" aria-label="Toggle favorite">${star}</span>
        </div>
      </button>`;
    })
    .join('');
}

export function renderFavoriteSection(items, favoritesSet) {
  renderFoodList('favoriteList', items, favoritesSet, 'No favorites yet.');
}

export function renderRecentSection(items, favoritesSet) {
  renderFoodList('recentList', items, favoritesSet, 'No recent items yet.');
}

export function renderSuggestions(items, favoritesSet) {
  renderFoodList('addSuggestions', items, favoritesSet, 'No matches. Use quick custom add below.');
}

export function renderPortionPicker(item, options) {
  el('portionFoodName').textContent = item.label;
  el('portionMeta').textContent = `${item.nutrition.kcal100g} kcal / 100g • P${item.nutrition.p100g} C${item.nutrition.c100g} F${item.nutrition.f100g}`;

  const buttons = options
    .map((opt) => `<button type="button" class="portion-btn" data-action="set-portion" data-grams="${opt.grams}">${opt.label}</button>`)
    .join('');
  el('portionPresetButtons').innerHTML = buttons;
  el('portionGrams').value = options[2]?.grams ?? 100;
}

export function readPortionGrams() {
  return Number(el('portionGrams').value);
}

export function setPortionGrams(grams) {
  el('portionGrams').value = Number(grams);
}

export function openPortionDialog() {
  el('portionDialog').showModal();
}

export function closePortionDialog() {
  el('portionDialog').close();
}

export function showAddStatus(message) {
  el('addStatus').textContent = message;
}


export function setScanStatus(message) {
  el('scanStatus').textContent = message;
}

export function readAnalyticsWeightForm() {
  return {
    personId: el('analyticsPersonPicker').value,
    date: el('analyticsWeightDate').value,
    scaleWeight: Number(el('analyticsWeightInput').value)
  };
}

export function setAnalyticsDefaultDate(date) {
  el('analyticsWeightDate').value = date;
}

export function renderAnalyticsPersonPicker(persons, selectedId) {
  const html = persons.length
    ? persons.map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.name}</option>`).join('')
    : '<option value="">No persons</option>';
  el('analyticsPersonPicker').innerHTML = html;
}

export function renderWeightLogList(weightLogs) {
  const wrap = el('weightLogList');
  if (!weightLogs.length) {
    wrap.innerHTML = '<p class="muted">No weight logs yet.</p>';
    return;
  }

  wrap.innerHTML = `<ul class="weight-log-items">${weightLogs
    .map((item) => `<li><strong>${item.date}</strong> • ${item.scaleWeight} kg</li>`)
    .join('')}</ul>`;
}

export function setAnalyticsStatus(message) {
  el('analyticsStatus').textContent = message;
}

function formatChangeMetric(value, unitSuffix = '') {
  if (!Number.isFinite(value)) return 'Not enough data';
  const direction = value > 0 ? 'increase' : value < 0 ? 'decrease' : 'no change';
  const abs = Math.abs(value);
  const rounded = Math.round(abs * 10) / 10;
  return `${rounded}${unitSuffix} ${direction}`;
}

export function renderAnalyticsInsights(metrics) {
  const wrap = el('analyticsInsights');
  if (!wrap) return;

  wrap.innerHTML = `
    <article class="card">
      <h3>3-day calorie change</h3>
      <p>${formatChangeMetric(metrics.calorie3d, ' kcal')}</p>
    </article>
    <article class="card">
      <h3>7-day calorie change</h3>
      <p>${formatChangeMetric(metrics.calorie7d, ' kcal')}</p>
    </article>
    <article class="card">
      <h3>3-day weight change</h3>
      <p>${formatChangeMetric(metrics.weight3d, ' kg')}</p>
    </article>
    <article class="card">
      <h3>7-day weight change</h3>
      <p>${formatChangeMetric(metrics.weight7d, ' kg')}</p>
    </article>
  `;
}

function macroValue(value) {
  return value == null ? 'missing' : `${Math.round(value * 10) / 10}`;
}

export function renderScanResult(product) {
  const wrap = el('scanResult');
  if (!product) {
    wrap.innerHTML = '';
    return;
  }

  wrap.innerHTML = `<article class="card">
    <div class="row-actions" style="justify-content:space-between;align-items:flex-start;">
      <div>
        <strong>${product.productName}</strong><br />
        <span class="muted">${product.brands || 'Unknown brand'}</span><br />
        <span class="muted tiny">Barcode: ${product.barcode}</span>
      </div>
      ${product.imageUrl ? `<img src="${product.imageUrl}" alt="${product.productName}" width="72" height="72" style="border-radius:8px;object-fit:cover;" />` : ''}
    </div>
    <p class="muted">Per 100g — kcal: ${macroValue(product.nutrition.kcal100g)}, P: ${macroValue(product.nutrition.p100g)}, C: ${macroValue(product.nutrition.c100g)}, F: ${macroValue(product.nutrition.f100g)}</p>
    <div class="row-actions">
      <button type="button" id="logScannedProductBtn">Log via portion picker</button>
    </div>
  </article>`;
}
