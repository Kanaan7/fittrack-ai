import { buildEntryFingerprint } from './dayRecords';
import { parseFlexibleDate } from './date';

const FIELD_ALIASES = {
  date: ['date', 'day', 'loggedat', 'logdate', 'mealdate', 'entrydate'],
  name: ['food', 'foodname', 'name', 'item', 'description', 'meal', 'title'],
  calories: ['calories', 'calorie', 'kcal', 'energy'],
  protein: ['protein', 'proteing', 'proteingrams'],
  carbs: ['carbs', 'carbohydrates', 'carbohydrate', 'carbg', 'carbohydratesg'],
  fats: ['fat', 'fats', 'fatg', 'dietaryfat'],
};

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findField(row, type) {
  const keys = Object.keys(row || {});
  const aliases = FIELD_ALIASES[type];

  return keys.find((key) => aliases.includes(normalizeHeader(key))) || null;
}

function parseMetric(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const normalized = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!normalized) return 0;

  const parsed = Number(normalized[0]);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMetric(value) {
  return Math.max(0, Math.round(value));
}

export function normalizeImportRow(row, rowIndex, fallbackYear = new Date().getFullYear()) {
  const dateField = findField(row, 'date');
  if (!dateField) {
    return { valid: false, reason: 'Missing date column', rowNumber: rowIndex + 2 };
  }

  const dateKey = parseFlexibleDate(row[dateField], fallbackYear);
  if (!dateKey) {
    return { valid: false, reason: 'Could not parse the date', rowNumber: rowIndex + 2 };
  }

  const nameField = findField(row, 'name');
  const caloriesField = findField(row, 'calories');
  const proteinField = findField(row, 'protein');
  const carbsField = findField(row, 'carbs');
  const fatsField = findField(row, 'fats');

  const entry = {
    name: String(row[nameField] || 'Imported entry').trim() || 'Imported entry',
    calories: roundMetric(parseMetric(row[caloriesField])),
    protein: roundMetric(parseMetric(row[proteinField])),
    carbs: roundMetric(parseMetric(row[carbsField])),
    fats: roundMetric(parseMetric(row[fatsField])),
  };

  const hasNutritionData =
    entry.calories > 0 || entry.protein > 0 || entry.carbs > 0 || entry.fats > 0;

  if (!hasNutritionData) {
    return {
      valid: false,
      reason: 'No usable calories or macro data found',
      rowNumber: rowIndex + 2,
      dateKey,
    };
  }

  return {
    valid: true,
    rowNumber: rowIndex + 2,
    dateKey,
    entry,
    fingerprint: buildEntryFingerprint(dateKey, entry),
  };
}

export function buildImportPreview(rows, existingFingerprints, options = {}) {
  const fallbackYear = options.fallbackYear || new Date().getFullYear();
  const validRows = [];
  const invalidRows = [];
  const duplicateRows = [];
  const seenFingerprints = new Set();
  const dateKeys = new Set();

  rows.forEach((row, index) => {
    const normalized = normalizeImportRow(row, index, fallbackYear);

    if (!normalized.valid) {
      invalidRows.push(normalized);
      return;
    }

    if (seenFingerprints.has(normalized.fingerprint) || existingFingerprints.has(normalized.fingerprint)) {
      duplicateRows.push({
        rowNumber: normalized.rowNumber,
        dateKey: normalized.dateKey,
        name: normalized.entry.name,
      });
      return;
    }

    seenFingerprints.add(normalized.fingerprint);
    dateKeys.add(normalized.dateKey);
    validRows.push(normalized);
  });

  const sortedDates = [...dateKeys].sort();

  return {
    fileName: options.fileName || 'Import',
    totalRows: rows.length,
    validRows,
    previewRows: validRows.slice(0, 8),
    invalidRows,
    duplicateRows,
    summary: {
      importedCount: 0,
      readyToImport: validRows.length,
      duplicateCount: duplicateRows.length,
      invalidCount: invalidRows.length,
      skippedCount: duplicateRows.length + invalidRows.length,
    },
    latestDate: sortedDates.at(-1) || null,
    earliestDate: sortedDates[0] || null,
  };
}

export function chunkArray(items, size = 100) {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
