function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanSentence(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function cleanList(items, limit, fallbackItems = []) {
  const cleaned = Array.isArray(items)
    ? items
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];

  return cleaned.length ? cleaned : fallbackItems;
}

export function buildInsightFingerprint({ entries, totals, goals }) {
  return JSON.stringify({
    entries: entries.map((entry) => ({
      name: entry.name,
      calories: safeNumber(entry.calories),
      protein: safeNumber(entry.protein),
      carbs: safeNumber(entry.carbs),
      fats: safeNumber(entry.fats),
    })),
    totals: {
      calories: safeNumber(totals.calories),
      protein: safeNumber(totals.protein),
      carbs: safeNumber(totals.carbs),
      fats: safeNumber(totals.fats),
    },
    goals: {
      calories: safeNumber(goals.calories),
      protein: safeNumber(goals.protein),
      carbs: safeNumber(goals.carbs),
      fats: safeNumber(goals.fats),
    },
  });
}

export function normalizeInsightResponse(payload) {
  return {
    summary: cleanSentence(payload?.summary, 'Your day is logged, but the insight summary needs a refresh.'),
    strengths: cleanList(payload?.strengths, 2, ['You are keeping your intake visible and trackable.']),
    improvements: cleanList(payload?.improvements, 2, ['Use your next meal to correct the biggest gap.']),
    nextStep: cleanSentence(payload?.nextStep, 'Refresh the insight after your next meal.'),
  };
}

function proteinRatio(totals, goals) {
  if (!safeNumber(goals.protein)) return 0;
  return safeNumber(totals.protein) / safeNumber(goals.protein);
}

function calorieRatio(totals, goals) {
  if (!safeNumber(goals.calories)) return 0;
  return safeNumber(totals.calories) / safeNumber(goals.calories);
}

export function buildFallbackInsight({ entries, totals, goals }) {
  if (!entries.length) {
    return {
      summary: 'No meals are logged for this day yet.',
      strengths: ['The date is preserved in your history, so you can fill it in later.'],
      improvements: ['Add your first meal to unlock a full daily insight.'],
      nextStep: 'Log your next meal with calories and macros.',
    };
  }

  const proteinProgress = proteinRatio(totals, goals);
  const calorieProgress = calorieRatio(totals, goals);
  const strengths = [];
  const improvements = [];

  if (proteinProgress >= 0.75) {
    strengths.push('Protein is moving well and gives the day a solid base.');
  } else {
    improvements.push('Protein is still behind target, so make the next meal protein-forward.');
  }

  if (calorieProgress >= 0.85 && calorieProgress <= 1.1) {
    strengths.push('Calories are in a workable range right now.');
  } else if (calorieProgress > 1.1) {
    improvements.push('Calories are running high, so keep the next meal lighter and simpler.');
  } else {
    improvements.push('Calories are still low, so do not leave the rest of the day too sparse.');
  }

  if (!strengths.length) {
    strengths.push('You are still building a complete picture by logging the day honestly.');
  }

  if (!improvements.length) {
    improvements.push('Keep the remaining meals balanced so the day finishes cleanly.');
  }

  const summary =
    proteinProgress >= 0.75 && calorieProgress <= 1.1
      ? 'Protein looks steady and the day is still manageable.'
      : 'The day is workable, but your next meal matters if you want a stronger finish.';

  const nextStep =
    proteinProgress < 0.75
      ? 'Aim for a higher-protein next meal with moderate fats.'
      : calorieProgress > 1.1
        ? 'Keep the next meal leaner and lower in extras.'
        : 'Stay consistent with one more balanced meal or snack.';

  return normalizeInsightResponse({ summary, strengths, improvements, nextStep });
}

export function buildInsightRequestPayload({ dateKey, entries, totals, goals }) {
  return {
    date: dateKey,
    entries: entries.map((entry) => ({
      name: entry.name,
      calories: safeNumber(entry.calories),
      protein: safeNumber(entry.protein),
      carbs: safeNumber(entry.carbs),
      fats: safeNumber(entry.fats),
    })),
    totals: {
      calories: safeNumber(totals.calories),
      protein: safeNumber(totals.protein),
      carbs: safeNumber(totals.carbs),
      fats: safeNumber(totals.fats),
    },
    targets: {
      calories: safeNumber(goals.calories),
      protein: safeNumber(goals.protein),
      carbs: safeNumber(goals.carbs),
      fats: safeNumber(goals.fats),
    },
  };
}
