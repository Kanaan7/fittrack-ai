import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { db } from './firebase';

const mealsCollection = (userId) => collection(db, 'users', userId, 'meals');

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toIsoString = (value) => {
  if (!value) return new Date().toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

export function mapMealFromFirestore(snapshot) {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    name: data.name || '',
    date: data.date || null,
    calories: toSafeNumber(data.calories),
    protein: toSafeNumber(data.protein),
    carbs: toSafeNumber(data.carbs),
    fat: toSafeNumber(data.fat ?? data.fats),
    notes: data.notes || '',
    source: data.source || null,
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt || data.createdAt),
  };
}

export async function addMeal(userId, meal) {
  const now = serverTimestamp();
  const mealRef = await addDoc(mealsCollection(userId), {
    name: String(meal.name || '').trim(),
    date: meal.date,
    calories: toSafeNumber(meal.calories),
    protein: toSafeNumber(meal.protein),
    carbs: toSafeNumber(meal.carbs),
    fat: toSafeNumber(meal.fat ?? meal.fats),
    notes: meal.notes || '',
    source: meal.source || 'logged',
    createdAt: now,
    updatedAt: now,
  });

  return {
    id: mealRef.id,
    name: String(meal.name || '').trim(),
    date: meal.date,
    calories: toSafeNumber(meal.calories),
    protein: toSafeNumber(meal.protein),
    carbs: toSafeNumber(meal.carbs),
    fat: toSafeNumber(meal.fat ?? meal.fats),
    notes: meal.notes || '',
    source: meal.source || 'logged',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function addMeals(userId, meals = []) {
  const savedMeals = [];

  for (const meal of meals) {
    savedMeals.push(await addMeal(userId, meal));
  }

  return savedMeals;
}

export async function getMeals(userId, options = {}) {
  const constraints = [];

  if (options.date) {
    constraints.push(where('date', '==', options.date));
  }

  constraints.push(orderBy('date', 'desc'));

  if (options.limit) {
    constraints.push(limit(options.limit));
  }

  const snapshot = await getDocs(query(mealsCollection(userId), ...constraints));
  return snapshot.docs
    .map(mapMealFromFirestore)
    .sort((left, right) => {
      if (left.date !== right.date) return left.date < right.date ? 1 : -1;
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });
}

export async function deleteMeal(userId, mealId) {
  await deleteDoc(doc(db, 'users', userId, 'meals', mealId));
}

export async function updateMeal(userId, mealId, updates) {
  const nextUpdates = {
    ...updates,
    updatedAt: serverTimestamp(),
  };

  if ('fats' in nextUpdates && !('fat' in nextUpdates)) {
    nextUpdates.fat = nextUpdates.fats;
    delete nextUpdates.fats;
  }

  await updateDoc(doc(db, 'users', userId, 'meals', mealId), nextUpdates);
}

export async function deleteAllMeals(userId) {
  const snapshot = await getDocs(mealsCollection(userId));
  const chunks = [];

  for (let index = 0; index < snapshot.docs.length; index += 450) {
    chunks.push(snapshot.docs.slice(index, index + 450));
  }

  for (const chunk of chunks) {
    const batch = writeBatch(db);
    chunk.forEach((mealDoc) => batch.delete(mealDoc.ref));
    await batch.commit();
  }
}
