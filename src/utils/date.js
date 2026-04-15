const MONTH_LOOKUP = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const pad = (value) => String(value).padStart(2, '0');

export function formatDateKey(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function createDateFromKey(dateKey) {
  if (!isValidDateKey(dateKey)) return null;

  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function isValidDateKey(dateKey) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey || '');
}

function parseTwoDigitYear(year, fallbackYear) {
  if (year >= 100) return year;

  const currentCentury = Math.floor(fallbackYear / 100) * 100;
  const currentTwoDigitYear = fallbackYear % 100;

  if (year <= currentTwoDigitYear + 5) {
    return currentCentury + year;
  }

  return currentCentury - 100 + year;
}

function tryBuildDate(year, month, day) {
  const date = new Date(year, month - 1, day);

  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return formatDateKey(date);
}

function parseExcelSerial(serial) {
  if (!Number.isFinite(serial) || serial <= 0) return null;

  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const date = new Date(utcValue * 1000);

  if (Number.isNaN(date.getTime())) return null;
  return formatDateKey(date);
}

export function parseFlexibleDate(value, fallbackYear = new Date().getFullYear()) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return formatDateKey(value);
  }

  if (typeof value === 'number') {
    if (value > 20000) {
      return parseExcelSerial(value);
    }

    return null;
  }

  const rawValue = String(value).trim();
  if (!rawValue) return null;

  const isoMatch = rawValue.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    return tryBuildDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = rawValue.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const year = slashMatch[3]
      ? parseTwoDigitYear(Number(slashMatch[3]), fallbackYear)
      : fallbackYear;

    return tryBuildDate(year, month, day);
  }

  const normalizedText = rawValue
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const monthFirstMatch = normalizedText.match(/^([a-z]+)\s+(\d{1,2})(?:\s+(\d{2,4}))?$/);
  if (monthFirstMatch) {
    const month = MONTH_LOOKUP[monthFirstMatch[1]];
    const day = Number(monthFirstMatch[2]);
    const year = monthFirstMatch[3]
      ? parseTwoDigitYear(Number(monthFirstMatch[3]), fallbackYear)
      : fallbackYear;

    if (month) {
      return tryBuildDate(year, month, day);
    }
  }

  const dayFirstMatch = normalizedText.match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{2,4}))?$/);
  if (dayFirstMatch) {
    const day = Number(dayFirstMatch[1]);
    const month = MONTH_LOOKUP[dayFirstMatch[2]];
    const year = dayFirstMatch[3]
      ? parseTwoDigitYear(Number(dayFirstMatch[3]), fallbackYear)
      : fallbackYear;

    if (month) {
      return tryBuildDate(year, month, day);
    }
  }

  const fallbackDate = new Date(rawValue);
  if (!Number.isNaN(fallbackDate.getTime())) {
    return formatDateKey(fallbackDate);
  }

  return null;
}

export function formatDisplayDate(input, options) {
  const date = typeof input === 'string' ? createDateFromKey(input) : input;
  if (!date) return '';

  return new Intl.DateTimeFormat('en-US', options).format(date);
}
