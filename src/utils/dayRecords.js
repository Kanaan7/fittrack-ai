import { formatDateKey, isValidDateKey } from './date';

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const aTime = new Date(a.timestamp || 0).getTime();
    const bTime = new Date(b.timestamp || 0).getTime();
    return bTime - aTime;
  });
}

export function mapEntryFromDatabase(entry) {
  return {
    id: entry.id,
    name: entry.food_name || entry.name,
    calories: safeNumber(entry.calories),
    protein: safeNumber(entry.protein),
    carbs: safeNumber(entry.carbs),
    fats: safeNumber(entry.fats ?? entry.fat),
    timestamp: entry.created_at || entry.createdAt || new Date().toISOString(),
    source: entry.source || null,
  };
}

export function createDayRecord(dateKey, overrides = {}) {
  return {
    date: dateKey,
    preserved: true,
    placeholderReason: overrides.placeholderReason || null,
    entries: sortEntries(overrides.entries || []),
    ...overrides,
  };
}

export function getDayRecord(dayRecords, dateKey) {
  return dayRecords[dateKey] || createDayRecord(dateKey);
}

export function sumEntries(entries = []) {
  return entries.reduce(
    (accumulator, entry) => ({
      calories: accumulator.calories + safeNumber(entry.calories),
      protein: accumulator.protein + safeNumber(entry.protein),
      carbs: accumulator.carbs + safeNumber(entry.carbs),
      fats: accumulator.fats + safeNumber(entry.fats),
    }),
    { calories: 0, protein: 0, carbs: 0, fats: 0 }
  );
}

export function listKnownDateKeys(dayRecords) {
  return Object.keys(dayRecords)
    .filter((dateKey) => isValidDateKey(dateKey))
    .sort((left, right) => (left < right ? 1 : -1));
}

export function organizeEntriesByDay(entries = [], preservedDates = []) {
  const organized = {};

  preservedDates.forEach((dateKey) => {
    if (isValidDateKey(dateKey)) {
      organized[dateKey] = createDayRecord(dateKey, { placeholderReason: 'history' });
    }
  });

  entries.forEach((entry) => {
    const dateKey = formatDateKey(entry.date || entry.created_at);
    if (!dateKey) return;

    const existing = organized[dateKey] || createDayRecord(dateKey);
    organized[dateKey] = {
      ...existing,
      placeholderReason: null,
      entries: sortEntries([...existing.entries, mapEntryFromDatabase(entry)]),
    };
  });

  return organized;
}

export function addEntriesToDay(dayRecords, dateKey, entries, overrides = {}) {
  const existing = getDayRecord(dayRecords, dateKey);

  return {
    ...dayRecords,
    [dateKey]: createDayRecord(dateKey, {
      ...existing,
      ...overrides,
      placeholderReason: null,
      entries: sortEntries([...existing.entries, ...entries]),
    }),
  };
}

export function deleteEntryFromDay(dayRecords, dateKey, entryId) {
  const existing = getDayRecord(dayRecords, dateKey);

  return {
    ...dayRecords,
    [dateKey]: createDayRecord(dateKey, {
      ...existing,
      placeholderReason: 'empty',
      entries: existing.entries.filter((entry) => entry.id !== entryId),
    }),
  };
}

export function extractPreservedDates(dayRecords) {
  return listKnownDateKeys(dayRecords);
}

export function buildEntryFingerprint(dateKey, entry) {
  const normalizedName = String(entry.name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  return [
    dateKey,
    normalizedName,
    safeNumber(entry.calories),
    safeNumber(entry.protein),
    safeNumber(entry.carbs),
    safeNumber(entry.fats),
  ].join('|');
}

export function buildExistingFingerprintSet(dayRecords) {
  const fingerprints = new Set();

  listKnownDateKeys(dayRecords).forEach((dateKey) => {
    const record = dayRecords[dateKey];
    record.entries.forEach((entry) => {
      fingerprints.add(buildEntryFingerprint(dateKey, entry));
    });
  });

  return fingerprints;
}
