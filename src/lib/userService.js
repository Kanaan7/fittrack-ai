import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from './firebase';

const userDoc = (userId) => doc(db, 'users', userId);

export async function getUserSettings(userId) {
  const snapshot = await getDoc(userDoc(userId));
  return snapshot.exists() ? snapshot.data() : {};
}

export async function saveProfile(userId, profile) {
  await setDoc(
    userDoc(userId),
    {
      profile: {
        username: profile.username || '',
        height: profile.height || '',
        weight: profile.weight || '',
        goal: profile.goal || '',
        workout_frequency: profile.workout_frequency || '',
        additional_info: profile.additional_info || '',
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function saveGoals(userId, goals) {
  await setDoc(
    userDoc(userId),
    {
      goals: {
        calories: Number(goals.calories) || 0,
        protein: Number(goals.protein) || 0,
        carbs: Number(goals.carbs) || 0,
        fats: Number(goals.fats) || 0,
      },
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function resetUserSettings(userId, profile, goals) {
  await setDoc(
    userDoc(userId),
    {
      profile,
      goals,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}
