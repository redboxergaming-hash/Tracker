const DB_NAME = 'macroTrackerDB';
const DB_VERSION = 4;

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function ensureStore(db, storeName, options) {
  if (!db.objectStoreNames.contains(storeName)) {
    return db.createObjectStore(storeName, options);
  }
  return null;
}

function ensureIndex(store, indexName, keyPath, options) {
  if (!store.indexNames.contains(indexName)) {
    store.createIndex(indexName, keyPath, options);
  }
}


function isoToDayIndex(isoDate) {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86400000);
}

function computeTrendForDate(targetDate, sortedLogs) {
  const targetDay = isoToDayIndex(targetDate);
  if (targetDay === null) return null;

  const startDay = targetDay - 6;
  const inWindow = sortedLogs.filter((item) => {
    const day = isoToDayIndex(item.date);
    if (day === null) return false;
    return day >= startDay && day <= targetDay;
  });

  if (!inWindow.length) return null;
  const total = inWindow.reduce((acc, item) => acc + Number(item.scaleWeight || 0), 0);
  const avg = total / inWindow.length;
  return Number.isFinite(avg) ? Math.round(avg * 1000) / 1000 : null;
}

async function recomputeTrendWeightsForPerson(tx, personId) {
  const store = tx.objectStore('weightLogs');
  const index = store.index('byPerson');
  const rows = await promisify(index.getAll(IDBKeyRange.only(personId)));
  const sorted = rows
    .filter((item) => item && typeof item.date === 'string')
    .sort((a, b) => a.date.localeCompare(b.date));

  sorted.forEach((item) => {
    const trendWeight = computeTrendForDate(item.date, sorted);
    if (item.trendWeight !== trendWeight) {
      store.put({ ...item, trendWeight });
    }
  });
}

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      const oldVersion = event.oldVersion;

      let persons = ensureStore(db, 'persons', { keyPath: 'id' });
      let entries = ensureStore(db, 'entries', { keyPath: 'id' });
      ensureStore(db, 'productsCache', { keyPath: 'barcode' });
      let favorites = ensureStore(db, 'favorites', { keyPath: 'id' });
      let recents = ensureStore(db, 'recents', { keyPath: 'id' });
      let weightLogs = ensureStore(db, 'weightLogs', { keyPath: 'id', autoIncrement: true });
      ensureStore(db, 'meta', { keyPath: 'key' });

      if (!persons) persons = tx.objectStore('persons');
      if (!entries) entries = tx.objectStore('entries');
      if (!favorites) favorites = tx.objectStore('favorites');
      if (!recents) recents = tx.objectStore('recents');
      if (!weightLogs) weightLogs = tx.objectStore('weightLogs');

      ensureIndex(entries, 'byPersonDate', ['personId', 'date']);
      ensureIndex(entries, 'byPersonDateTime', ['personId', 'date', 'time']);
      ensureIndex(entries, 'byPerson', 'personId');

      ensureIndex(favorites, 'byPerson', 'personId');
      ensureIndex(favorites, 'byPersonLabel', ['personId', 'label']);

      ensureIndex(recents, 'byPersonUsedAt', ['personId', 'usedAt']);
      ensureIndex(recents, 'byPersonFood', ['personId', 'foodId']);

      ensureIndex(weightLogs, 'byPersonDate', ['personId', 'date'], { unique: true });
      ensureIndex(weightLogs, 'byPerson', 'personId');
      ensureIndex(weightLogs, 'byDate', 'date');

      if (oldVersion < 2) {
        const cursorReq = persons.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const value = cursor.value;
          if (!value.macroTargets || typeof value.macroTargets !== 'object') {
            value.macroTargets = { p: null, c: null, f: null };
            cursor.update(value);
          }
          cursor.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function seedSampleData() {
  const db = await openDb();
  const tx = db.transaction(['persons', 'entries', 'meta', 'favorites', 'recents', 'weightLogs'], 'readwrite');
  tx.objectStore('persons').clear();
  tx.objectStore('entries').clear();
  tx.objectStore('favorites').clear();
  tx.objectStore('recents').clear();
  tx.objectStore('weightLogs').clear();

  const persons = [
    { id: crypto.randomUUID(), name: 'Alex', kcalGoal: 2200, macroTargets: { p: 160, c: 240, f: 70 } },
    { id: crypto.randomUUID(), name: 'Sam', kcalGoal: 1800, macroTargets: { p: 120, c: 190, f: 60 } }
  ];
  persons.forEach((p) => tx.objectStore('persons').put(p));

  const today = new Date().toISOString().slice(0, 10);
  const sample = [
    {
      id: crypto.randomUUID(),
      personId: persons[0].id,
      date: today,
      time: '08:15',
      foodId: 'gf_oats',
      foodName: 'Oats (dry)',
      amountGrams: 60,
      kcal: 233,
      p: 10,
      c: 40,
      f: 4,
      source: 'Manual (Generic built-in)'
    },
    {
      id: crypto.randomUUID(),
      personId: persons[1].id,
      date: today,
      time: '12:30',
      foodId: 'custom_chicken',
      foodName: 'Chicken breast (cooked)',
      amountGrams: 150,
      kcal: 248,
      p: 46,
      c: 0,
      f: 5,
      source: 'Manual (Custom)'
    }
  ];
  sample.forEach((e) => tx.objectStore('entries').put(e));
  tx.objectStore('meta').put({ key: 'sampleSeededAt', value: new Date().toISOString() });

  await txDone(tx);
  return { persons, sample };
}

export async function getPersons() {
  const db = await openDb();
  const tx = db.transaction('persons', 'readonly');
  return promisify(tx.objectStore('persons').getAll());
}

export async function upsertPerson(person) {
  const db = await openDb();
  const tx = db.transaction('persons', 'readwrite');
  tx.objectStore('persons').put(person);
  await txDone(tx);
  return person;
}

export async function deletePersonCascade(personId) {
  const db = await openDb();
  const tx = db.transaction(['persons', 'entries', 'favorites', 'recents', 'weightLogs'], 'readwrite');
  tx.objectStore('persons').delete(personId);

  const deleteByIndex = (storeName, indexName, keyRange) => {
    const index = tx.objectStore(storeName).index(indexName);
    const req = index.openCursor(keyRange);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  };

  deleteByIndex('entries', 'byPerson', IDBKeyRange.only(personId));
  deleteByIndex('favorites', 'byPerson', IDBKeyRange.only(personId));
  deleteByIndex('recents', 'byPersonUsedAt', IDBKeyRange.bound([personId, 0], [personId, Number.MAX_SAFE_INTEGER]));
  deleteByIndex('weightLogs', 'byPerson', IDBKeyRange.only(personId));

  await txDone(tx);
}

export async function addWeightLog(personId, date, scaleWeight) {
  if (!personId) throw new Error('personId is required');
  if (!date) throw new Error('date is required');

  const parsedWeight = Number(scaleWeight);
  if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
    throw new Error('scaleWeight must be a positive number');
  }

  const db = await openDb();
  const tx = db.transaction('weightLogs', 'readwrite');
  const store = tx.objectStore('weightLogs');
  const byPersonDate = store.index('byPersonDate');
  const existing = await promisify(byPersonDate.get([personId, date]));

  const row = {
    personId,
    date,
    scaleWeight: parsedWeight,
    trendWeight: null
  };
  if (existing?.id != null) row.id = existing.id;

  const id = await promisify(store.put(row));
  await recomputeTrendWeightsForPerson(tx, personId);
  await txDone(tx);

  const readTx = db.transaction('weightLogs', 'readonly');
  const saved = await promisify(readTx.objectStore('weightLogs').get(id));
  return saved || { ...row, id };
}

export async function getWeightLogsByPerson(personId) {
  if (!personId) return [];

  const db = await openDb();
  const tx = db.transaction('weightLogs', 'readonly');
  const index = tx.objectStore('weightLogs').index('byPerson');
  const rows = await promisify(index.getAll(IDBKeyRange.only(personId)));
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getWeightLogsInRange(personId, startDate, endDate) {
  if (!personId || !startDate || !endDate) return [];

  const db = await openDb();
  const tx = db.transaction('weightLogs', 'readonly');
  const index = tx.objectStore('weightLogs').index('byPersonDate');
  const range = IDBKeyRange.bound([personId, startDate], [personId, endDate]);
  const rows = await promisify(index.getAll(range));
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function getEntriesForPersonDate(personId, date) {
  const db = await openDb();
  const tx = db.transaction('entries', 'readonly');
  const idx = tx.objectStore('entries').index('byPersonDate');
  return promisify(idx.getAll([personId, date]));
}

export async function getLoggedDatesByPerson(personId) {
  if (!personId) return [];
  const db = await openDb();
  const tx = db.transaction('entries', 'readonly');
  const idx = tx.objectStore('entries').index('byPerson');
  const rows = await promisify(idx.getAll(IDBKeyRange.only(personId)));
  const uniqueDates = new Set(rows.map((row) => row?.date).filter((date) => typeof date === 'string'));
  return [...uniqueDates].sort((a, b) => b.localeCompare(a));
}

export async function addEntry(entry) {
  const numericFields = ['amountGrams', 'kcal', 'p', 'c', 'f'];
  const cleaned = { ...entry };
  for (const field of numericFields) {
    const value = Number(cleaned[field]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${field} must be a non-negative number`);
    }
    cleaned[field] = value;
  }

  const db = await openDb();
  const tx = db.transaction(['entries', 'recents', 'meta'], 'readwrite');
  const stored = {
    ...cleaned,
    id: entry.id || crypto.randomUUID(),
    createdAt: entry.createdAt || Date.now()
  };
  tx.objectStore('entries').put(stored);

  if (cleaned.recentItem) {
    const recentsStore = tx.objectStore('recents');
    const byPersonFood = recentsStore.index('byPersonFood');
    const key = [cleaned.personId, cleaned.recentItem.foodId];
    const existingReq = byPersonFood.get(key);
    existingReq.onsuccess = () => {
      const existing = existingReq.result;
      if (existing?.id) {
        recentsStore.delete(existing.id);
      }
      recentsStore.put({
        id: crypto.randomUUID(),
        personId: cleaned.personId,
        foodId: cleaned.recentItem.foodId,
        label: cleaned.recentItem.label,
        nutrition: cleaned.recentItem.nutrition,
        pieceGramHint: cleaned.recentItem.pieceGramHint ?? null,
        sourceType: cleaned.recentItem.sourceType,
        usedAt: Date.now()
      });
    };
  }

  if (cleaned.lastPortionKey) {
    tx.objectStore('meta').put({ key: `lastPortion:${cleaned.lastPortionKey}`, value: Number(cleaned.amountGrams) });
  }

  await txDone(tx);
  return stored;
}

function sanitizeWeightLog(item) {
  if (!item || !item.personId || !item.date) return null;
  const scaleWeight = Number(item.scaleWeight);
  if (!Number.isFinite(scaleWeight) || scaleWeight <= 0) return null;
  const trendWeight = Number(item.trendWeight);
  return {
    id: item.id,
    personId: item.personId,
    date: item.date,
    scaleWeight,
    trendWeight: Number.isFinite(trendWeight) ? trendWeight : null
  };
}

export async function getFavorites(personId) {
  const db = await openDb();
  const tx = db.transaction('favorites', 'readonly');
  const idx = tx.objectStore('favorites').index('byPerson');
  return promisify(idx.getAll(personId));
}

export async function isFavorite(personId, foodId) {
  const db = await openDb();
  const tx = db.transaction('favorites', 'readonly');
  const item = await promisify(tx.objectStore('favorites').get(`${personId}:${foodId}`));
  return Boolean(item);
}

export async function toggleFavorite(personId, favoriteItem) {
  const db = await openDb();
  const tx = db.transaction('favorites', 'readwrite');
  const store = tx.objectStore('favorites');
  const id = `${personId}:${favoriteItem.foodId}`;
  const existing = await promisify(store.get(id));
  if (existing) {
    store.delete(id);
  } else {
    store.put({
      id,
      personId,
      foodId: favoriteItem.foodId,
      label: favoriteItem.label,
      nutrition: favoriteItem.nutrition,
      sourceType: favoriteItem.sourceType,
      pieceGramHint: favoriteItem.pieceGramHint ?? null,
      createdAt: Date.now()
    });
  }
  await txDone(tx);
  return !existing;
}

export async function getRecents(personId, limit = 20) {
  const db = await openDb();
  const tx = db.transaction('recents', 'readonly');
  const idx = tx.objectStore('recents').index('byPersonUsedAt');
  const range = IDBKeyRange.bound([personId, 0], [personId, Number.MAX_SAFE_INTEGER]);

  return new Promise((resolve, reject) => {
    const out = [];
    const req = idx.openCursor(range, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out);
        return;
      }
      const row = cursor.value;
      if (!out.some((item) => item.foodId === row.foodId)) {
        out.push(row);
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLastPortion(lastPortionKey) {
  const db = await openDb();
  const tx = db.transaction('meta', 'readonly');
  const row = await promisify(tx.objectStore('meta').get(`lastPortion:${lastPortionKey}`));
  return row?.value ?? null;
}


function uniqueById(items, idKey = 'id') {
  const map = new Map();
  for (const item of items || []) {
    if (!item || item[idKey] == null) continue;
    map.set(item[idKey], item);
  }
  return [...map.values()];
}

export async function exportAllData() {
  const db = await openDb();
  const tx = db.transaction(['persons', 'entries', 'productsCache', 'favorites', 'recents', 'weightLogs'], 'readonly');

  const [persons, entries, productsCache, favorites, recents, weightLogs] = await Promise.all([
    promisify(tx.objectStore('persons').getAll()),
    promisify(tx.objectStore('entries').getAll()),
    promisify(tx.objectStore('productsCache').getAll()),
    promisify(tx.objectStore('favorites').getAll()),
    promisify(tx.objectStore('recents').getAll()),
    promisify(tx.objectStore('weightLogs').getAll())
  ]);

  return {
    schemaVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    persons,
    entries,
    productsCache,
    favorites,
    recents,
    weightLogs
  };
}

export async function importAllData(payload) {
  const db = await openDb();
  const tx = db.transaction(['persons', 'entries', 'productsCache', 'favorites', 'recents', 'weightLogs', 'meta'], 'readwrite');

  const storesToReset = ['persons', 'entries', 'productsCache', 'favorites', 'recents', 'weightLogs'];
  storesToReset.forEach((storeName) => tx.objectStore(storeName).clear());

  const persons = uniqueById(payload.persons || []);
  const entries = uniqueById(payload.entries || []);
  const productsCache = uniqueById(payload.productsCache || [], 'barcode');
  const favorites = uniqueById(payload.favorites || []);
  const recents = uniqueById(payload.recents || []);
  const weightLogs = [];
  const weightByPersonDate = new Map();
  for (const row of payload.weightLogs || []) {
    const cleaned = sanitizeWeightLog(row);
    if (!cleaned) continue;
    weightByPersonDate.set(`${cleaned.personId}:${cleaned.date}`, cleaned);
  }
  weightLogs.push(...weightByPersonDate.values());

  persons.forEach((item) => tx.objectStore('persons').put(item));
  entries.forEach((item) => tx.objectStore('entries').put(item));
  productsCache.forEach((item) => tx.objectStore('productsCache').put(item));
  favorites.forEach((item) => tx.objectStore('favorites').put(item));
  recents.forEach((item) => tx.objectStore('recents').put(item));
  weightLogs.forEach((item) => tx.objectStore('weightLogs').put(item));

  tx.objectStore('meta').put({ key: 'lastImportAt', value: new Date().toISOString() });

  await txDone(tx);
  return {
    persons: persons.length,
    entries: entries.length,
    productsCache: productsCache.length,
    favorites: favorites.length,
    recents: recents.length,
    weightLogs: weightLogs.length
  };
}

export async function deleteAllData() {
  const db = await openDb();
  const tx = db.transaction(['persons', 'entries', 'productsCache', 'favorites', 'recents', 'weightLogs', 'meta'], 'readwrite');
  ['persons', 'entries', 'productsCache', 'favorites', 'recents', 'weightLogs', 'meta'].forEach((storeName) => {
    tx.objectStore(storeName).clear();
  });
  await txDone(tx);
}


export async function getCachedProduct(barcode) {
  const db = await openDb();
  const tx = db.transaction('productsCache', 'readonly');
  return promisify(tx.objectStore('productsCache').get(barcode));
}

export async function upsertCachedProduct(product) {
  const db = await openDb();
  const tx = db.transaction('productsCache', 'readwrite');
  tx.objectStore('productsCache').put(product);
  await txDone(tx);
  return product;
}
