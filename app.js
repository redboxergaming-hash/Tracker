import { genericFoods } from './genericfoods.js';
import { computeNutritionFromPer100g } from './math.js';
import { lookupOpenFoodFacts } from './offclient.js';
import { startBarcodeScanner, stopBarcodeScanner } from './scanner.js';
import { drawWeeklyAnalyticsChart } from './analyticschart.js';
import {
  addEntry,
  deleteAllData,
  deletePersonCascade,
  exportAllData,
  getCachedProduct,
  getEntriesForPersonDate,
  getLoggedDatesByPerson,
  getFavorites,
  getLastPortion,
  getPersons,
  getRecents,
  getWeightLogsByPerson,
  getWeightLogsInRange,
  addWeightLog,
  upsertCachedProduct,
  importAllData,
  isFavorite,
  seedSampleData,
  toggleFavorite,
  upsertPerson
} from './storage.js';
import {
  closePortionDialog,
  fillPersonForm,
  initRoutes,
  openPortionDialog,
  readPersonForm,
  readPortionGrams,
  renderDashboard,
  renderDashboardEmpty,
  renderPersonPicker,
  renderPersonsList,
  renderPortionPicker,
  renderSettingsPersons,
  renderSuggestions,
  renderFavoriteSection,
  renderRecentSection,
  renderScanResult,
  setPortionGrams,
  setScanStatus,
  showAddStatus,
  readAnalyticsWeightForm,
  renderAnalyticsPersonPicker,
  setAnalyticsDefaultDate,
  renderWeightLogList,
  setAnalyticsStatus,
  renderAnalyticsInsights,
  renderNutritionPersonPicker,
  setNutritionDefaultDate,
  renderNutritionOverview
} from './ui.js';

const CHATGPT_PHOTO_PROMPT = `Look at this meal photo. List the foods you can clearly identify.
If uncertain, ask clarifying questions.
Do NOT guess portion sizes.
Ask me for grams or pieces for each item.
Also ask whether oil, butter, or sauce was used.
Output as a checklist.`;


const IOS_INSTALL_BANNER_DISMISSED_KEY = 'iosInstallBannerDismissed';

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent);
}

function renderIosInstallBanner() {
  const banner = document.getElementById('iosInstallBanner');
  if (!banner) return;

  const dismissed = window.localStorage.getItem(IOS_INSTALL_BANNER_DISMISSED_KEY) === '1';
  const shouldShow = isIosDevice() && !isStandaloneMode() && !dismissed;
  banner.hidden = !shouldShow;
}

const GENERIC_CATEGORIES = ['All', 'Fruits', 'Vegetables', 'Meat', 'Dairy', 'Grains', 'Drinks'];

const MICRONUTRIENTS = [
  { key: 'saturatedFat', per100Key: 'saturatedFat100g', label: 'Saturated fat', unit: 'g' },
  { key: 'monounsaturatedFat', per100Key: 'monounsaturatedFat100g', label: 'Monounsaturated fat', unit: 'g' },
  { key: 'polyunsaturatedFat', per100Key: 'polyunsaturatedFat100g', label: 'Polyunsaturated fat', unit: 'g' },
  { key: 'omega3', per100Key: 'omega3100g', label: 'Omega-3', unit: 'g' },
  { key: 'omega6', per100Key: 'omega6100g', label: 'Omega-6', unit: 'g' },
  { key: 'transFat', per100Key: 'transFat100g', label: 'Trans fat', unit: 'g' }
];

function scaleMicronutrientsFromPer100g(nutrition, grams) {
  const ratio = Number(grams) / 100;
  const out = {};
  MICRONUTRIENTS.forEach((item) => {
    const per100 = Number(nutrition?.[item.per100Key]);
    out[item.key] = Number.isFinite(per100) ? Math.round(per100 * ratio * 1000) / 1000 : null;
  });
  return out;
}

async function loadNutritionOverview() {
  const personId = document.getElementById('nutritionPersonPicker').value || state.selectedPersonId;
  const date = document.getElementById('nutritionDatePicker').value || state.selectedDate;
  const person = state.persons.find((p) => p.id === personId);

  if (!personId || !date) {
    renderNutritionOverview([], false);
    return;
  }

  const entries = await getEntriesForPersonDate(personId, date);

  const rows = MICRONUTRIENTS.map((nutrient) => {
    let hasValue = false;
    const amount = entries.reduce((sum, entry) => {
      const value = Number(entry?.[nutrient.key]);
      if (!Number.isFinite(value)) return sum;
      hasValue = true;
      return sum + value;
    }, 0);

    const targetRaw = Number(person?.micronutrientTargets?.[nutrient.key]);
    const target = Number.isFinite(targetRaw) && targetRaw > 0 ? targetRaw : null;
    const safeAmount = hasValue ? Math.round(amount * 1000) / 1000 : null;
    const percent = target && safeAmount !== null ? Math.round((safeAmount / target) * 1000) / 10 : null;

    return {
      key: nutrient.key,
      label: nutrient.label,
      unit: nutrient.unit,
      amount: safeAmount,
      target,
      percent
    };
  });

  const hasAnyData = rows.some((row) => row.amount !== null);
  renderNutritionOverview(rows, hasAnyData);
}

const state = {
  route: 'persons',
  persons: [],
  selectedPersonId: null,
  selectedDate: new Date().toISOString().slice(0, 10),
  suggestions: [],
  favoritesByPerson: {},
  recentsByPerson: {},
  activeFood: null,
  scannedProduct: null,
  analyticsRange: '1W',
  analyticsPoints: [],
  selectedGenericCategory: 'All',
  dashboardMacroView: 'consumed'
};

function foodFromGeneric(item) {
  return {
    foodId: item.id,
    label: item.name,
    nutrition: { kcal100g: item.kcal100g, p100g: item.p100g, c100g: item.c100g, f100g: item.f100g },
    pieceGramHint: item.pieceGramHint,
    sourceType: 'generic',
    isGeneric: true,
    groupLabel: `Built-in generic • ${item.category || 'Uncategorized'}`
  };
}


function startOfDayUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

async function computeLoggingStreakDays(personId, selectedDate) {
  const dates = await getLoggedDatesByPerson(personId);
  if (!dates.length || !selectedDate) return 0;
  const dateSet = new Set(dates);
  let streak = 0;
  for (let i = 0; i < 365; i += 1) {
    const date = addDays(selectedDate, -i);
    if (!dateSet.has(date)) break;
    streak += 1;
  }
  return streak;
}

async function buildWeeklyAnalyticsPoints(personId, endDate) {
  const startDate = addDays(endDate, -6);
  const weightLogs = await getWeightLogsInRange(personId, startDate, endDate);
  const weightByDate = new Map(weightLogs.map((item) => [item.date, item]));

  const points = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(startDate, i);
    const entries = await getEntriesForPersonDate(personId, date);
    const calories = entries.reduce((acc, item) => acc + Number(item.kcal || 0), 0);
    const row = weightByDate.get(date);

    points.push({
      date,
      calories: Number.isFinite(calories) ? Math.round(calories * 10) / 10 : 0,
      scaleWeight: Number.isFinite(Number(row?.scaleWeight)) ? Number(row.scaleWeight) : null,
      trendWeight: Number.isFinite(Number(row?.trendWeight)) ? Number(row.trendWeight) : null
    });
  }
  return points;
}

function renderAnalyticsChart(points) {
  const canvas = document.getElementById('analyticsChart');
  if (!canvas) return;
  drawWeeklyAnalyticsChart(canvas, points || []);
}

function setAnalyticsRangeToggle(range) {
  document.querySelectorAll('#analyticsRangeToggle button[data-range]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.range === range);
  });
}


function safeDiff(endValue, startValue) {
  if (!Number.isFinite(endValue) || !Number.isFinite(startValue)) return null;
  const delta = endValue - startValue;
  return Number.isFinite(delta) ? Math.round(delta * 10) / 10 : null;
}

async function getDailyCalories(personId, date) {
  const entries = await getEntriesForPersonDate(personId, date);
  const total = entries.reduce((acc, item) => acc + Number(item.kcal || 0), 0);
  return Number.isFinite(total) ? Math.round(total * 10) / 10 : 0;
}

async function buildInsightMetrics(personId, endDate) {
  const start7d = addDays(endDate, -7);
  const start3d = addDays(endDate, -3);

  const caloriesByDate = new Map();
  for (let i = 0; i <= 7; i += 1) {
    const date = addDays(endDate, -i);
    caloriesByDate.set(date, await getDailyCalories(personId, date));
  }

  const calorie3d = safeDiff(caloriesByDate.get(endDate), caloriesByDate.get(start3d));
  const calorie7d = safeDiff(caloriesByDate.get(endDate), caloriesByDate.get(start7d));

  const weightLogs = await getWeightLogsInRange(personId, start7d, endDate);
  const weightByDate = new Map(weightLogs.map((item) => [item.date, Number(item.scaleWeight)]));

  const weight3d = safeDiff(weightByDate.get(endDate), weightByDate.get(start3d));
  const weight7d = safeDiff(weightByDate.get(endDate), weightByDate.get(start7d));

  return { calorie3d, calorie7d, weight3d, weight7d };
}

function nowTime() {
  return new Date().toTimeString().slice(0, 5);
}

function getTotalsByPerson(entriesByPerson) {
  return Object.fromEntries(
    Object.entries(entriesByPerson).map(([personId, entries]) => {
      const sum = entries.reduce(
        (acc, e) => ({
          kcal: acc.kcal + Number(e.kcal || 0),
          p: acc.p + Number(e.p || 0),
          c: acc.c + Number(e.c || 0),
          f: acc.f + Number(e.f || 0)
        }),
        { kcal: 0, p: 0, c: 0, f: 0 }
      );
      return [personId, sum];
    })
  );
}

async function ensureSeedDataIfNeeded() {
  state.persons = await getPersons();
  if (!state.persons.length) {
    await seedSampleData();
    state.persons = await getPersons();
  }
}

function normalizeSelection() {
  const hasSelected = state.persons.some((p) => p.id === state.selectedPersonId);
  if (!hasSelected) {
    state.selectedPersonId = state.persons[0]?.id || null;
  }
}

async function loadPersonScopedCaches() {
  if (!state.selectedPersonId) return;
  const personId = state.selectedPersonId;
  state.favoritesByPerson[personId] = await getFavorites(personId);
  state.recentsByPerson[personId] = await getRecents(personId);
}

function sectionItems(personId) {
  const favorites = (state.favoritesByPerson[personId] || []).map((item) => ({
    ...item,
    isGeneric: item.sourceType === 'generic',
    groupLabel: 'Favorite'
  }));

  const recents = (state.recentsByPerson[personId] || []).map((item) => ({
    ...item,
    isGeneric: item.sourceType === 'generic',
    groupLabel: 'Recent'
  }));

  return { favorites, recents };
}

function buildSuggestionPool(personId, selectedCategory = "All") {
  const { favorites, recents } = sectionItems(personId);
  const generic = genericFoods
    .filter((item) => selectedCategory === 'All' || item.category === selectedCategory)
    .map((item) => ({ ...foodFromGeneric(item), groupLabel: `Built-in generic • ${item.category}` }));

  const dedup = new Map();
  [...favorites, ...recents, ...generic].forEach((item) => {
    if (!dedup.has(item.foodId)) dedup.set(item.foodId, item);
  });
  return [...dedup.values()];
}

function filterSuggestions(query, personId) {
  const { favorites, recents } = sectionItems(personId);
  const pool = buildSuggestionPool(personId, state.selectedGenericCategory);
  const q = query.trim().toLowerCase();
  const filtered = q ? pool.filter((item) => item.label.toLowerCase().includes(q)) : pool;
  state.suggestions = filtered.slice(0, 30);
  const favoritesSet = new Set((state.favoritesByPerson[personId] || []).map((f) => f.foodId));
  renderFavoriteSection(favorites, favoritesSet);
  renderRecentSection(recents.slice(0, 20), favoritesSet);
  renderSuggestions(state.suggestions, favoritesSet);
}


async function loadAnalytics() {
  const analyticsPersonId = document.getElementById('analyticsPersonPicker').value || state.selectedPersonId;
  if (!analyticsPersonId) {
    state.analyticsPoints = [];
    renderWeightLogList([]);
    renderAnalyticsInsights({ calorie3d: null, calorie7d: null, weight3d: null, weight7d: null });
    renderAnalyticsChart([]);
    return;
  }

  const logs = await getWeightLogsByPerson(analyticsPersonId);
  renderWeightLogList(logs.slice(0, 7));

  const endDate = document.getElementById('analyticsWeightDate').value || state.selectedDate;
  const points = await buildWeeklyAnalyticsPoints(analyticsPersonId, endDate);
  const metrics = await buildInsightMetrics(analyticsPersonId, endDate);
  state.analyticsPoints = points;
  renderAnalyticsInsights(metrics);
  renderAnalyticsChart(points);
  setAnalyticsRangeToggle(state.analyticsRange);
}

async function handleSaveWeightLog() {
  const { personId, date, scaleWeight } = readAnalyticsWeightForm();
  if (!personId) {
    window.alert('Create/select a person first.');
    return;
  }

  if (!date) {
    window.alert('Please select a date.');
    return;
  }

  if (!Number.isFinite(scaleWeight) || scaleWeight <= 0) {
    window.alert('Please enter a valid positive weight value.');
    return;
  }

  await addWeightLog(personId, date, scaleWeight);
  setAnalyticsStatus(`Saved ${scaleWeight} kg on ${date}.`);
  await loadAnalytics();
  await loadNutritionOverview();
}

async function loadAndRender() {
  state.persons = await getPersons();
  normalizeSelection();
  await loadPersonScopedCaches();

  document.getElementById('datePicker').value = state.selectedDate;
  document.getElementById('addTime').value = document.getElementById('addTime').value || nowTime();

  const entriesByPerson = {};
  for (const person of state.persons) {
    entriesByPerson[person.id] = await getEntriesForPersonDate(person.id, state.selectedDate);
  }

  renderPersonsList(state.persons, getTotalsByPerson(entriesByPerson));
  renderPersonPicker(state.persons, state.selectedPersonId);
  renderAnalyticsPersonPicker(state.persons, state.selectedPersonId);
  setAnalyticsDefaultDate(state.selectedDate);
  renderNutritionPersonPicker(state.persons, state.selectedPersonId);
  setNutritionDefaultDate(state.selectedDate);
  renderSettingsPersons(state.persons);
  document.querySelectorAll('#genericCategoryFilters button[data-category]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.category === state.selectedGenericCategory);
  });

  const person = state.persons.find((p) => p.id === state.selectedPersonId);
  if (person) {
    const streakDays = await computeLoggingStreakDays(person.id, state.selectedDate);
    renderDashboard(person, state.selectedDate, entriesByPerson[person.id] || [], {
      macroView: state.dashboardMacroView,
      streakDays
    });
    filterSuggestions(document.getElementById('foodSearchInput').value || '', person.id);
  } else {
    renderDashboardEmpty();
  }

  await loadAnalytics();
  await loadNutritionOverview();
}

async function handlePersonSave(e) {
  e.preventDefault();
  const person = readPersonForm();
  if (!person.name) {
    window.alert('Please provide a name.');
    return;
  }
  if (!Number.isFinite(person.kcalGoal) || person.kcalGoal < 800) {
    window.alert('Please provide a valid daily kcal goal (>= 800).');
    return;
  }

  await upsertPerson(person);
  state.selectedPersonId = person.id;
  fillPersonForm(null);
  await loadAndRender();
}

async function handleSettingsActions(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) return;

  const personId = button.dataset.personId;
  const action = button.dataset.action;
  const person = state.persons.find((p) => p.id === personId);
  if (!person) return;

  if (action === 'edit-person') {
    fillPersonForm(person);
    document.getElementById('personName').focus();
    return;
  }

  if (action === 'delete-person') {
    const ok = window.confirm(`Delete ${person.name}? This will permanently delete all their entries.`);
    if (!ok) return;
    await deletePersonCascade(person.id);
    if (state.selectedPersonId === person.id) state.selectedPersonId = null;
    fillPersonForm(null);
    await loadAndRender();
  }
}

function buildPortionOptions(item, lastUsed) {
  const options = [
    { label: '30g', grams: 30 },
    { label: '50g', grams: 50 },
    { label: '100g', grams: 100 },
    { label: '200g', grams: 200 }
  ];
  if (item.pieceGramHint) options.push({ label: `1 piece (~${item.pieceGramHint}g)`, grams: item.pieceGramHint });
  if (lastUsed) options.push({ label: `Last used (${lastUsed}g)`, grams: lastUsed });
  return options;
}

async function openPortionForItem(item) {
  const personId = document.getElementById('addPersonPicker').value || state.selectedPersonId;
  if (!personId) {
    window.alert('Create/select a person first.');
    return;
  }
  const lastPortionKey = `${personId}:${item.foodId}`;
  const last = await getLastPortion(lastPortionKey);
  state.activeFood = { ...item, personId, lastPortionKey };
  renderPortionPicker(item, buildPortionOptions(item, last));
  openPortionDialog();
}

async function logActiveFood() {
  const grams = readPortionGrams();
  if (!Number.isFinite(grams) || grams <= 0) {
    window.alert('Please enter a valid gram amount.');
    return;
  }

  const active = state.activeFood;
  if (!active) return;
  const usedPersonId = document.getElementById('addPersonPicker').value || active.personId;
  const entryDate = state.selectedDate;
  const time = document.getElementById('addTime').value || nowTime();
  const macros = computeNutritionFromPer100g(active.nutrition, grams);
  const micronutrients = scaleMicronutrientsFromPer100g(active.nutrition, grams);

  const source =
    active.sourceType === 'favorite'
      ? 'Favorite'
      : active.sourceType === 'generic'
        ? 'Manual (Generic built-in)'
        : active.sourceType === 'barcode'
          ? 'Barcode (Open Food Facts)'
          : active.sourceType === 'photo-manual'
            ? 'Photo (manual via ChatGPT)'
            : 'Manual (Custom)';

  await addEntry({
    personId: usedPersonId,
    date: entryDate,
    time,
    foodId: active.foodId,
    foodName: active.label,
    amountGrams: grams,
    ...macros,
    ...micronutrients,
    source,
    lastPortionKey: active.lastPortionKey,
    recentItem: {
      foodId: active.foodId,
      label: active.label,
      nutrition: active.nutrition,
      pieceGramHint: active.pieceGramHint,
      sourceType: active.sourceType === 'favorite' ? 'generic' : active.sourceType
    }
  });

  showAddStatus(`Logged ${active.label} (${grams}g).`);
  closePortionDialog();
  await loadAndRender();
}

async function handleAddSuggestionClick(e) {
  const actionTarget = e.target.closest('[data-action]');
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  const foodId = actionTarget.dataset.foodId;
  const personId = document.getElementById('addPersonPicker').value || state.selectedPersonId;
  if (!foodId || !personId) return;

  const item = buildSuggestionPool(personId, state.selectedGenericCategory).find((s) => s.foodId === foodId);
  if (!item) return;

  if (action === 'toggle-favorite') {
    const turnedOn = await toggleFavorite(personId, {
      foodId: item.foodId,
      label: item.label,
      nutrition: item.nutrition,
      pieceGramHint: item.pieceGramHint,
      sourceType: item.sourceType === 'favorite' ? 'generic' : item.sourceType
    });
    showAddStatus(turnedOn ? 'Added to favorites.' : 'Removed from favorites.');
    await loadPersonScopedCaches();
    filterSuggestions(document.getElementById('foodSearchInput').value || '', personId);
    return;
  }

  if (action === 'pick-food') {
    const favorited = await isFavorite(personId, item.foodId);
    const sourceType = favorited ? 'favorite' : item.sourceType;
    await openPortionForItem({ ...item, sourceType });
  }
}

async function handleCustomFoodSubmit(e) {
  e.preventDefault();
  const personId = document.getElementById('addPersonPicker').value || state.selectedPersonId;
  if (!personId) {
    window.alert('Create/select a person first.');
    return;
  }

  const label = document.getElementById('customName').value.trim();
  if (!label) return;

  const nutrition = {
    kcal100g: Number(document.getElementById('customKcal').value),
    p100g: Number(document.getElementById('customP').value),
    c100g: Number(document.getElementById('customC').value),
    f100g: Number(document.getElementById('customF').value)
  };

  const hasInvalidNutrition = Object.values(nutrition).some((value) => !Number.isFinite(value) || value < 0);
  if (hasInvalidNutrition) {
    window.alert('Please enter non-negative numeric values for calories and macros.');
    return;
  }

  const selectedSource = document.getElementById('customSource').value || 'custom';

  await openPortionForItem({
    foodId: `custom:${label.toLowerCase().replace(/\s+/g, '_')}`,
    label,
    nutrition,
    pieceGramHint: null,
    sourceType: selectedSource,
    isGeneric: false,
    groupLabel: selectedSource === 'photo-manual' ? 'Photo (manual via ChatGPT)' : 'Custom'
  });
}


async function handleBarcodeDetected(barcode) {
  if (!barcode) return;

  setScanStatus(`Scanned: ${barcode}`);

  const cached = await getCachedProduct(barcode);
  if (cached) {
    state.scannedProduct = cached;
    renderScanResult(cached);
  }

  if (!navigator.onLine) {
    if (!cached) {
      setScanStatus('Needs internet for first lookup.');
      renderScanResult(null);
    } else {
      setScanStatus('Loaded from local cache (offline).');
    }
    return;
  }

  try {
    const product = await lookupOpenFoodFacts(barcode);
    await upsertCachedProduct(product);
    state.scannedProduct = product;
    renderScanResult(product);
    setScanStatus(cached ? 'Updated from Open Food Facts.' : 'Product loaded from Open Food Facts.');
  } catch (error) {
    if (!cached) {
      setScanStatus('Could not find product. You can use manual add instead.');
      renderScanResult(null);
    } else {
      setScanStatus('Using cached product (network lookup failed).');
    }
  }
}

function toScannedFoodItem(product) {
  return {
    foodId: `barcode:${product.barcode}`,
    label: product.brands ? `${product.productName} (${product.brands})` : product.productName,
    nutrition: {
      kcal100g: product.nutrition.kcal100g,
      p100g: product.nutrition.p100g,
      c100g: product.nutrition.c100g,
      f100g: product.nutrition.f100g
    },
    pieceGramHint: null,
    sourceType: 'barcode',
    isGeneric: false,
    groupLabel: 'Barcode (Open Food Facts)'
  };
}


function showSettingsDataStatus(message) {
  const el = document.getElementById('settingsDataStatus');
  if (el) el.textContent = message;
}

function downloadJsonFile(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function handleExportData() {
  const payload = await exportAllData();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadJsonFile(`macro-tracker-export-${stamp}.json`, payload);
  showSettingsDataStatus('Export complete. JSON downloaded.');
}

async function handleImportDataFile(file) {
  if (!file) return;
  const text = await file.text();
  const parsed = JSON.parse(text);

  const required = ['persons', 'entries', 'productsCache', 'favorites', 'recents', 'weightLogs'];
  const hasShape = required.every((key) => Array.isArray(parsed[key]));
  if (!hasShape) {
    window.alert('Invalid import file format.');
    return;
  }

  const summary = await importAllData(parsed);
  state.selectedPersonId = null;
  fillPersonForm(null);
  await loadAndRender();
  showSettingsDataStatus(
    `Import complete. Persons: ${summary.persons}, Entries: ${summary.entries}, Favorites: ${summary.favorites}, Recents: ${summary.recents}, Weight logs: ${summary.weightLogs}.`
  );
}

async function handleDeleteAllData() {
  const ok = window.confirm('Delete ALL app data on this device? This cannot be undone.');
  if (!ok) return;
  await deleteAllData();
  state.selectedPersonId = null;
  state.favoritesByPerson = {};
  state.recentsByPerson = {};
  fillPersonForm(null);
  await loadAndRender();
  showSettingsDataStatus('All data deleted.');
}


function setPhotoStatus(message) {
  const el = document.getElementById('photoStatus');
  if (el) el.textContent = message;
}

async function handleCopyPhotoPrompt() {
  try {
    await navigator.clipboard.writeText(CHATGPT_PHOTO_PROMPT);
    setPhotoStatus('Prompt copied. Open ChatGPT, upload the photo, paste prompt, then return to log manually.');
  } catch (error) {
    console.error(error);
    setPhotoStatus('Could not copy automatically. Please copy the prompt manually.');
  }
}

function handlePhotoSelected(file) {
  if (!file) return;
  const preview = document.getElementById('photoPreview');
  const reader = new FileReader();
  reader.onload = () => {
    preview.src = reader.result;
    preview.hidden = false;
    setPhotoStatus('Photo preview ready. Use “Copy ChatGPT Prompt” and follow instructions below.');
  };
  reader.readAsDataURL(file);
}


async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
  } catch (error) {
    console.error('Service worker registration failed:', error);
  }
}

function wireEvents() {
  initRoutes((route) => {
    state.route = route;
    if (route !== 'scan') {
      stopBarcodeScanner();
    }
  });

  document.getElementById('personPicker').addEventListener('change', async (e) => {
    state.selectedPersonId = e.target.value || null;
    await loadAndRender();
  });

  document.getElementById('analyticsPersonPicker').addEventListener('change', async () => {
    await loadAnalytics();
  });

  document.getElementById('nutritionPersonPicker').addEventListener('change', async () => {
    await loadNutritionOverview();
  });

  document.getElementById('nutritionDatePicker').addEventListener('change', async () => {
    await loadNutritionOverview();
  });

  document.getElementById('analyticsWeightDate').addEventListener('change', async () => {
    await loadAnalytics();
  });

  document.getElementById('analyticsRangeToggle').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-range]');
    if (!btn) return;
    state.analyticsRange = btn.dataset.range || '1W';
    await loadAnalytics();
  });

  document.getElementById('saveWeightLogBtn').addEventListener('click', async () => {
    try {
      await handleSaveWeightLog();
    } catch (error) {
      console.error(error);
      setAnalyticsStatus('Could not save weight log.');
    }
  });

  document.getElementById('datePicker').addEventListener('change', async (e) => {
    state.selectedDate = e.target.value;
    await loadAndRender();
  });

  document.getElementById('dashboardSummary').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-macro-view]');
    if (!btn) return;
    const view = btn.dataset.macroView;
    if (!view || !['consumed', 'remaining', 'percent'].includes(view)) return;
    state.dashboardMacroView = view;
    await loadAndRender();
  });

  document.getElementById('addPersonPicker').addEventListener('change', async (e) => {
    state.selectedPersonId = e.target.value || null;
    await loadAndRender();
  });

  document.getElementById('genericCategoryFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-category]');
    if (!btn) return;
    state.selectedGenericCategory = btn.dataset.category || 'All';
    const personId = document.getElementById('addPersonPicker').value || state.selectedPersonId;
    if (!personId) return;
    filterSuggestions(document.getElementById('foodSearchInput').value || '', personId);
    document.querySelectorAll('#genericCategoryFilters button[data-category]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
  });

  document.getElementById('foodSearchInput').addEventListener('input', (e) => {
    const personId = document.getElementById('addPersonPicker').value || state.selectedPersonId;
    if (!personId) return;
    filterSuggestions(e.target.value, personId);
  });

  document.getElementById('addSuggestions').addEventListener('click', handleAddSuggestionClick);
  document.getElementById('favoriteList').addEventListener('click', handleAddSuggestionClick);
  document.getElementById('recentList').addEventListener('click', handleAddSuggestionClick);
  document.getElementById('customFoodForm').addEventListener('submit', handleCustomFoodSubmit);

  document.getElementById('startScanBtn').addEventListener('click', async () => {
    const video = document.getElementById('scannerVideo');
    try {
      await startBarcodeScanner(video, handleBarcodeDetected, () => {});
      setScanStatus('Scanner active. Point camera at an EAN/UPC barcode.');
    } catch (error) {
      console.error(error);
      setScanStatus('Unable to start scanner. Check camera permission.');
    }
  });

  document.getElementById('stopScanBtn').addEventListener('click', () => {
    stopBarcodeScanner();
    setScanStatus('Scanner stopped.');
  });

  document.getElementById('scanResult').addEventListener('click', async (e) => {
    const btn = e.target.closest('#logScannedProductBtn');
    if (!btn || !state.scannedProduct) return;
    await openPortionForItem(toScannedFoodItem(state.scannedProduct));
  });

  document.getElementById('copyPromptBtn').addEventListener('click', handleCopyPhotoPrompt);
  document.getElementById('photoInput').addEventListener('change', (e) => {
    handlePhotoSelected(e.target.files?.[0]);
  });

  document.getElementById('portionPresetButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="set-portion"]');
    if (!btn) return;
    setPortionGrams(Number(btn.dataset.grams));
  });
  document.getElementById('confirmPortionBtn').addEventListener('click', logActiveFood);
  document.getElementById('cancelPortionBtn').addEventListener('click', closePortionDialog);

  document.getElementById('personForm').addEventListener('submit', handlePersonSave);
  document.getElementById('cancelEditBtn').addEventListener('click', () => fillPersonForm(null));
  document.getElementById('settingsPersons').addEventListener('click', handleSettingsActions);

  document.getElementById('exportDataBtn').addEventListener('click', async () => {
    try {
      await handleExportData();
    } catch (error) {
      console.error(error);
      showSettingsDataStatus('Export failed.');
    }
  });

  document.getElementById('importDataInput').addEventListener('change', async (e) => {
    try {
      await handleImportDataFile(e.target.files?.[0]);
    } catch (error) {
      console.error(error);
      window.alert('Import failed. Please check the JSON file.');
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('deleteAllDataBtn').addEventListener('click', async () => {
    try {
      await handleDeleteAllData();
    } catch (error) {
      console.error(error);
      showSettingsDataStatus('Delete all failed.');
    }
  });

  document.getElementById('seedBtn').addEventListener('click', async () => {
    const ok = window.confirm('Reset to sample data? This replaces current persons and entries.');
    if (!ok) return;
    await seedSampleData();
    fillPersonForm(null);
    await loadAndRender();
  });

  window.addEventListener('resize', () => {
    if (state.analyticsPoints.length) renderAnalyticsChart(state.analyticsPoints);
  });

  const installDialog = document.getElementById('installDialog');
  document.getElementById('installHintBtn').addEventListener('click', () => installDialog.showModal());
  document.getElementById('closeInstallDialog').addEventListener('click', () => installDialog.close());

  document.getElementById('dismissIosInstallBanner').addEventListener('click', () => {
    window.localStorage.setItem(IOS_INSTALL_BANNER_DISMISSED_KEY, '1');
    renderIosInstallBanner();
  });

  const standaloneMedia = window.matchMedia('(display-mode: standalone)');
  if (typeof standaloneMedia.addEventListener === 'function') {
    standaloneMedia.addEventListener('change', () => {
      renderIosInstallBanner();
    });
  } else if (typeof standaloneMedia.addListener === 'function') {
    standaloneMedia.addListener(() => {
      renderIosInstallBanner();
    });
  }

  window.addEventListener('appinstalled', () => {
    renderIosInstallBanner();
  });
}

await registerServiceWorker();
wireEvents();
fillPersonForm(null);
renderIosInstallBanner();
await ensureSeedDataIfNeeded();
await loadAndRender();
