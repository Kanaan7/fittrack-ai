import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  AlertTriangle,
  Beef,
  Brain,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplets,
  FileSpreadsheet,
  Flame,
  History,
  Home,
  Loader,
  LogOut,
  Plus,
  RefreshCw,
  Settings,
  ShieldCheck,
  Target,
  Trash2,
  Upload,
  User,
  Wheat,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import Papa from 'papaparse';

import {
  addEntriesToDay,
  buildExistingFingerprintSet,
  createDayRecord,
  deleteEntryFromDay,
  extractPreservedDates,
  getDayRecord,
  listKnownDateKeys,
  mapEntryFromDatabase,
  organizeEntriesByDay,
  sumEntries,
} from './utils/dayRecords';
import {
  buildFallbackInsight,
  buildInsightFingerprint,
  buildInsightRequestPayload,
  normalizeInsightResponse,
} from './utils/dailyInsight';
import { buildImportPreview, chunkArray } from './utils/importUtils';
import { createDateFromKey, formatDateKey, formatDisplayDate } from './utils/date';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const DEFAULT_PROFILE = {
  username: '',
  height: '',
  weight: '',
  goal: '',
  workout_frequency: '',
  additional_info: '',
};

const DEFAULT_GOALS = {
  calories: 2000,
  protein: 150,
  carbs: 250,
  fats: 65,
};

const GUEST_DAY_RECORDS_KEY = 'fittrack:guest:day-records';
const GUEST_PROFILE_KEY = 'fittrack:guest:profile';
const GUEST_GOALS_KEY = 'fittrack:guest:goals';
const GUEST_INSIGHTS_KEY = 'fittrack:guest:insights';

const getUserDayRegistryKey = (userId) => `fittrack:user:${userId}:day-registry`;
const getUserInsightsKey = (userId) => `fittrack:user:${userId}:insights`;

function readStoredJson(key, fallbackValue) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch (error) {
    console.error('Storage read error:', error);
    return fallbackValue;
  }
}

function writeStoredJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error('Storage write error:', error);
  }
}

function hydrateLocalDayRecords(rawRecords = {}) {
  const hydrated = {};

  Object.entries(rawRecords || {}).forEach(([dateKey, record]) => {
    if (!dateKey) return;

    const entries = Array.isArray(record?.entries)
      ? record.entries.map((entry) => ({
          id: entry.id,
          name: entry.name,
          calories: Number(entry.calories) || 0,
          protein: Number(entry.protein) || 0,
          carbs: Number(entry.carbs) || 0,
          fats: Number(entry.fats) || 0,
          timestamp: entry.timestamp || new Date().toISOString(),
        }))
      : [];

    hydrated[dateKey] = createDayRecord(dateKey, {
      ...record,
      entries,
    });
  });

  return hydrated;
}

function parseCsvText(text) {
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header: true,
      dynamicTyping: false,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      complete: (results) => resolve(results),
      error: (error) => reject(error),
    });
  });
}

function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast-enter pointer-events-auto flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium shadow-xl ${
            toast.type === 'success'
              ? 'bg-emerald-500 text-white'
              : toast.type === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-slate-800 text-white'
          }`}
        >
          {toast.type === 'success' && <Check size={15} strokeWidth={2.5} />}
          {toast.type === 'error' && <AlertTriangle size={15} strokeWidth={2.5} />}
          <span>{toast.message}</span>
          <button
            onClick={() => removeToast(toast.id)}
            className="ml-1 rounded-full opacity-60 transition-opacity hover:opacity-100"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function MacroBar({ label, icon: Icon, current, goal, unit, color, bgColor }) {
  const safeGoal = goal || 1;
  const percentage = Math.min((current / safeGoal) * 100, 100);
  const isOver = current > safeGoal;

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className={color} />
          <span className="text-sm font-medium text-slate-600">{label}</span>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${isOver ? 'text-red-500' : 'text-slate-700'}`}>
          {current.toFixed(0)}
          <span className="font-normal text-slate-400">
            /{goal}
            {unit}
          </span>
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${isOver ? 'bg-red-400' : bgColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function DailyInsightCard({ insight, status, hasEntries, onRefresh }) {
  const isLoading = status === 'loading';
  const isFallback = status === 'error';

  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <Brain size={18} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">Daily Insight</h3>
            <p className="text-sm text-slate-500">
              {hasEntries
                ? 'A concise coaching read on how the day is shaping up.'
                : 'Log a meal to generate a coaching summary for this day.'}
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={!hasEntries || isLoading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh insight
        </button>
      </div>

      {isLoading && (
        <div className="mb-4 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Building a fresh read on the day...
        </div>
      )}

      {isFallback && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Live AI feedback was unavailable, so this card is showing a local fallback read.
        </div>
      )}

      <div className="space-y-4">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-medium leading-6 text-slate-700">{insight.summary}</p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-100 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-600">
              <ShieldCheck size={14} />
              Strengths
            </div>
            <div className="space-y-2">
              {insight.strengths.map((item) => (
                <p key={item} className="text-sm leading-6 text-slate-600">
                  {item}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-100 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-600">
              <AlertTriangle size={14} />
              Improvement Tip
            </div>
            <div className="space-y-2">
              {insight.improvements.map((item) => (
                <p key={item} className="text-sm leading-6 text-slate-600">
                  {item}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900 px-4 py-4 text-white">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-300">Next Best Step</div>
          <p className="text-sm leading-6 text-slate-100">{insight.nextStep}</p>
        </div>
      </div>
    </div>
  );
}

function ImportMetric({ label, value, tone = 'default' }) {
  const toneClasses =
    tone === 'success'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : tone === 'warning'
        ? 'bg-amber-50 text-amber-700 border-amber-100'
        : tone === 'danger'
          ? 'bg-red-50 text-red-700 border-red-100'
          : 'bg-slate-50 text-slate-700 border-slate-100';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClasses}`}>
      <div className="text-xs font-semibold uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

export default function FitnessTracker() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState('home');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState('month');
  const [showMenu, setShowMenu] = useState(false);

  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [dailyData, setDailyData] = useState({});
  const [dailyInsights, setDailyInsights] = useState({});

  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingGoals, setIsGeneratingGoals] = useState(false);
  const [isPreparingImport, setIsPreparingImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [lastParsed, setLastParsed] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [toasts, setToasts] = useState([]);

  const selectedDateKey = formatDateKey(currentDate);
  const selectedDay = getDayRecord(dailyData, selectedDateKey);
  const selectedEntries = selectedDay.entries;
  const totals = sumEntries(selectedEntries);
  const trackedDateKeys = listKnownDateKeys(dailyData);
  const hasTrackedDay = Boolean(dailyData[selectedDateKey]);
  const isToday = selectedDateKey === formatDateKey(new Date());
  const insightFingerprint = buildInsightFingerprint({ entries: selectedEntries, totals, goals });
  const currentInsightState = dailyInsights[selectedDateKey];
  const insight = selectedEntries.length
    ? currentInsightState?.data || buildFallbackInsight({ entries: selectedEntries, totals, goals })
    : buildFallbackInsight({ entries: [], totals, goals });
  const insightStatus = selectedEntries.length ? currentInsightState?.status || 'idle' : 'empty';

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts((previous) => [...previous, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((previous) => previous.filter((toast) => toast.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const loadGuestState = useCallback(() => {
    setProfile({ ...DEFAULT_PROFILE, ...readStoredJson(GUEST_PROFILE_KEY, DEFAULT_PROFILE) });
    setGoals({ ...DEFAULT_GOALS, ...readStoredJson(GUEST_GOALS_KEY, DEFAULT_GOALS) });
    setDailyData(hydrateLocalDayRecords(readStoredJson(GUEST_DAY_RECORDS_KEY, {})));
    setDailyInsights(readStoredJson(GUEST_INSIGHTS_KEY, {}));
  }, []);

  const loadUserData = useCallback(async (currentUser) => {
    try {
      const [profileResult, goalsResult, entriesResult] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle(),
        supabase.from('goals').select('*').eq('user_id', currentUser.id).maybeSingle(),
        supabase.from('food_entries').select('*').eq('user_id', currentUser.id).order('date', { ascending: false }),
      ]);

      if (profileResult.error) throw profileResult.error;
      if (goalsResult.error) throw goalsResult.error;
      if (entriesResult.error) throw entriesResult.error;

      const storedDates = readStoredJson(getUserDayRegistryKey(currentUser.id), []);
      const organized = organizeEntriesByDay(entriesResult.data || [], storedDates);

      setProfile({
        ...DEFAULT_PROFILE,
        ...(profileResult.data || {}),
      });
      setGoals({
        ...DEFAULT_GOALS,
        ...(goalsResult.data || {}),
      });
      setDailyData(organized);
      setDailyInsights(readStoredJson(getUserInsightsKey(currentUser.id), {}));
    } catch (error) {
      console.error('Error loading user data:', error);
      addToast('Unable to load your saved nutrition data right now.', 'error');
    }
  }, [addToast]);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!isMounted) return;

        if (session?.user) {
          setUser(session.user);
          await loadUserData(session.user);
        } else {
          setUser(null);
          loadGuestState();
        }
      } catch (error) {
        console.error(error);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!isMounted) return;

      setShowMenu(false);

      if (session?.user) {
        setUser(session.user);
        await loadUserData(session.user);
      } else {
        setUser(null);
        loadGuestState();
      }

      setLoading(false);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [loadGuestState, loadUserData]);

  useEffect(() => {
    if (loading || user) return;

    writeStoredJson(GUEST_DAY_RECORDS_KEY, dailyData);
    writeStoredJson(GUEST_PROFILE_KEY, profile);
    writeStoredJson(GUEST_GOALS_KEY, goals);
    writeStoredJson(GUEST_INSIGHTS_KEY, dailyInsights);
  }, [dailyData, dailyInsights, goals, loading, profile, user]);

  useEffect(() => {
    if (loading || !user) return;
    writeStoredJson(getUserDayRegistryKey(user.id), extractPreservedDates(dailyData));
  }, [dailyData, loading, user]);

  useEffect(() => {
    if (loading) return;

    if (user) {
      writeStoredJson(getUserInsightsKey(user.id), dailyInsights);
      return;
    }

    writeStoredJson(GUEST_INSIGHTS_KEY, dailyInsights);
  }, [dailyInsights, loading, user]);

  const saveProfile = useCallback(async () => {
    if (!user) return;

    try {
      await supabase.from('profiles').upsert(
        {
          id: user.id,
          username: profile.username || user.user_metadata?.username || user.email?.split('@')[0] || '',
          height: profile.height,
          weight: profile.weight,
          goal: profile.goal,
          workout_frequency: profile.workout_frequency,
          additional_info: profile.additional_info,
        },
        { onConflict: 'id' }
      );
    } catch (error) {
      console.error('Profile save error:', error);
    }
  }, [profile, user]);

  const saveGoals = useCallback(async () => {
    if (!user) return;

    try {
      await supabase.from('goals').upsert(
        {
          user_id: user.id,
          calories: goals.calories,
          protein: goals.protein,
          carbs: goals.carbs,
          fats: goals.fats,
        },
        { onConflict: 'user_id' }
      );
    } catch (error) {
      console.error('Goals save error:', error);
    }
  }, [goals, user]);

  useEffect(() => {
    if (!user || !profile.height) return undefined;

    const timeout = window.setTimeout(() => {
      saveProfile();
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [profile, saveProfile, user]);

  useEffect(() => {
    if (!user) return undefined;

    const timeout = window.setTimeout(() => {
      saveGoals();
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [goals, saveGoals, user]);

  const handleAuth = async () => {
    setAuthError('');

    if (!email || !password) {
      setAuthError('Please fill in both fields.');
      return;
    }

    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { username: email.split('@')[0] } },
        });

        if (error) throw error;

        addToast('Account created. Check your inbox to verify your email.', 'success', 5000);
        setAuthMode('login');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        setShowAuthModal(false);
        setEmail('');
        setPassword('');
        addToast('Welcome back.', 'success');
      }
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleGoogleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      addToast(error.message, 'error');
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowMenu(false);
    addToast('Signed out.', 'info');
  };

  const refreshDailyInsight = useCallback(async (forceRefresh = false) => {
    if (!selectedEntries.length) return;

    const fingerprint = buildInsightFingerprint({ entries: selectedEntries, totals, goals });
    const existingInsight = dailyInsights[selectedDateKey];

    if (
      !forceRefresh &&
      existingInsight?.fingerprint === fingerprint &&
      ['ready', 'loading', 'error'].includes(existingInsight.status)
    ) {
      return;
    }

    setDailyInsights((previous) => ({
      ...previous,
      [selectedDateKey]: {
        ...previous[selectedDateKey],
        status: 'loading',
        fingerprint,
        data: previous[selectedDateKey]?.data || buildFallbackInsight({ entries: selectedEntries, totals, goals }),
      },
    }));

    try {
      const response = await fetch('/.netlify/functions/daily-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildInsightRequestPayload({
            dateKey: selectedDateKey,
            entries: selectedEntries,
            totals,
            goals,
          })
        ),
      });

      if (!response.ok) {
        const errorPayload = await response.json();
        throw new Error(errorPayload.error || 'Unable to refresh daily insight');
      }

      const payload = await response.json();
      const normalized = normalizeInsightResponse(payload);

      setDailyInsights((previous) => ({
        ...previous,
        [selectedDateKey]: {
          status: 'ready',
          fingerprint,
          updatedAt: new Date().toISOString(),
          data: normalized,
        },
      }));
    } catch (error) {
      console.error('Insight refresh error:', error);

      setDailyInsights((previous) => ({
        ...previous,
        [selectedDateKey]: {
          status: 'error',
          fingerprint,
          updatedAt: new Date().toISOString(),
          errorMessage: error.message,
          data: buildFallbackInsight({ entries: selectedEntries, totals, goals }),
        },
      }));

      if (forceRefresh) {
        addToast('Insight refresh fell back to local coaching.', 'info');
      }
    }
  }, [addToast, dailyInsights, goals, selectedDateKey, selectedEntries, totals]);

  useEffect(() => {
    if (!selectedEntries.length) return undefined;

    if (
      currentInsightState?.fingerprint === insightFingerprint &&
      ['ready', 'loading', 'error'].includes(currentInsightState.status)
    ) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      refreshDailyInsight(false);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [currentInsightState?.fingerprint, currentInsightState?.status, insightFingerprint, refreshDailyInsight, selectedEntries.length]);

  const processInput = async () => {
    if (!inputText.trim()) return;

    setIsProcessing(true);
    setLastParsed(null);

    try {
      const response = await fetch('/.netlify/functions/parse-food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText }),
      });

      if (!response.ok) {
        const errorPayload = await response.json();
        throw new Error(errorPayload.error || 'Failed to parse food');
      }

      const payload = await response.json();
      const parsedItems = Array.isArray(payload.items) ? payload.items : [];

      if (!parsedItems.length) {
        throw new Error('No foods were returned from the parser.');
      }

      let newEntries = [];

      if (user) {
        const rowsToInsert = parsedItems.map((item) => ({
          user_id: user.id,
          date: selectedDateKey,
          food_name: item.name,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fats: item.fats,
        }));

        const { data, error } = await supabase.from('food_entries').insert(rowsToInsert).select();
        if (error) throw error;

        newEntries = (data || []).map(mapEntryFromDatabase);
      } else {
        const timestamp = new Date().toISOString();
        newEntries = parsedItems.map((item, index) => ({
          id: `local-${Date.now()}-${index}`,
          name: item.name,
          calories: Number(item.calories) || 0,
          protein: Number(item.protein) || 0,
          carbs: Number(item.carbs) || 0,
          fats: Number(item.fats) || 0,
          timestamp,
        }));
      }

      setDailyData((previous) => addEntriesToDay(previous, selectedDateKey, newEntries));

      const totalCalories = parsedItems.reduce((sum, item) => sum + (Number(item.calories) || 0), 0);
      const totalProtein = parsedItems.reduce((sum, item) => sum + (Number(item.protein) || 0), 0);

      setLastParsed({
        items: parsedItems,
        totalCalories,
        totalProtein,
      });
      setInputText('');
      addToast(
        `Logged ${parsedItems.length > 1 ? `${parsedItems.length} items` : parsedItems[0].name} - ${Math.round(totalCalories)} kcal`,
        'success'
      );
    } catch (error) {
      console.error(error);
      addToast(`Error: ${error.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteEntry = async (entry) => {
    try {
      if (user) {
        const { error } = await supabase.from('food_entries').delete().eq('id', entry.id);
        if (error) throw error;
      }

      const willBeEmpty = selectedEntries.length === 1;

      setDailyData((previous) => deleteEntryFromDay(previous, selectedDateKey, entry.id));
      setConfirmDeleteId(null);

      addToast(
        willBeEmpty
          ? `Removed ${entry.name}. The day stays visible in history.`
          : `Removed ${entry.name}.`,
        'success'
      );
    } catch (error) {
      console.error(error);
      addToast('Unable to delete that entry right now.', 'error');
    }
  };

  const generateGoals = async () => {
    if (!profile.height || !profile.weight || !profile.goal) {
      addToast('Fill in height, weight, and goal first.', 'error');
      return;
    }

    setIsGeneratingGoals(true);

    try {
      let historicalData = null;
      const recentDates = trackedDateKeys.slice(0, 30).filter((dateKey) => getDayRecord(dailyData, dateKey).entries.length > 0);

      if (recentDates.length > 0) {
        const averageCalories =
          recentDates.reduce((sum, dateKey) => sum + sumEntries(getDayRecord(dailyData, dateKey).entries).calories, 0) /
          recentDates.length;

        historicalData = {
          daysTracked: recentDates.length,
          avgCalories: Math.round(averageCalories),
        };
      }

      const response = await fetch('/.netlify/functions/generate-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          height: profile.height,
          weight: profile.weight,
          goal: profile.goal,
          workoutFrequency: profile.workout_frequency,
          historicalData,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json();
        throw new Error(errorPayload.error || 'Failed to generate goals');
      }

      const result = await response.json();
      const nextGoals = {
        calories: Number(result.calories) || DEFAULT_GOALS.calories,
        protein: Number(result.protein) || DEFAULT_GOALS.protein,
        carbs: Number(result.carbs) || DEFAULT_GOALS.carbs,
        fats: Number(result.fats) || DEFAULT_GOALS.fats,
      };

      setGoals(nextGoals);

      if (user) {
        await supabase.from('goals').upsert(
          {
            user_id: user.id,
            ...nextGoals,
          },
          { onConflict: 'user_id' }
        );
      }

      addToast(`Goals updated. ${nextGoals.calories} kcal is the new target.`, 'success', 5000);
    } catch (error) {
      console.error(error);
      addToast(`Error: ${error.message}`, 'error');
    } finally {
      setIsGeneratingGoals(false);
    }
  };

  const handleFileImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsPreparingImport(true);
    setImportPreview(null);
    setImportSummary(null);

    try {
      const text = await file.text();
      const results = await parseCsvText(text);
      const existingFingerprints = buildExistingFingerprintSet(dailyData);
      const preview = buildImportPreview(results.data || [], existingFingerprints, {
        fileName: file.name,
        fallbackYear: currentDate.getFullYear(),
      });

      setImportPreview(preview);

      if (preview.summary.readyToImport > 0) {
        addToast(`Preview ready: ${preview.summary.readyToImport} rows can be imported.`, 'success');
      } else {
        addToast('No new valid rows were found in that file.', 'info');
      }
    } catch (error) {
      console.error(error);
      addToast('That file could not be parsed as an import.', 'error');
    } finally {
      setIsPreparingImport(false);
      event.target.value = '';
    }
  };

  const confirmImport = async () => {
    if (!importPreview?.validRows?.length) return;

    setIsImporting(true);

    const importedGroups = {};
    let importedCount = 0;

    try {
      if (user) {
        const chunks = chunkArray(importPreview.validRows, 100);

        for (const chunk of chunks) {
          const rows = chunk.map((item) => ({
            user_id: user.id,
            date: item.dateKey,
            food_name: item.entry.name,
            calories: item.entry.calories,
            protein: item.entry.protein,
            carbs: item.entry.carbs,
            fats: item.entry.fats,
          }));

          const { data, error } = await supabase.from('food_entries').insert(rows).select();
          if (error) throw error;

          (data || []).forEach((row) => {
            if (!importedGroups[row.date]) importedGroups[row.date] = [];
            importedGroups[row.date].push(mapEntryFromDatabase(row));
            importedCount += 1;
          });
        }
      } else {
        importPreview.validRows.forEach((item, index) => {
          if (!importedGroups[item.dateKey]) importedGroups[item.dateKey] = [];
          importedGroups[item.dateKey].push({
            id: `import-${Date.now()}-${index}`,
            name: item.entry.name,
            calories: item.entry.calories,
            protein: item.entry.protein,
            carbs: item.entry.carbs,
            fats: item.entry.fats,
            timestamp: new Date().toISOString(),
          });
          importedCount += 1;
        });
      }

      setDailyData((previous) => {
        let nextRecords = previous;

        Object.entries(importedGroups).forEach(([dateKey, entries]) => {
          nextRecords = addEntriesToDay(nextRecords, dateKey, entries);
        });

        return nextRecords;
      });

      setImportSummary({
        ...importPreview.summary,
        importedCount,
        skippedCount: importPreview.summary.duplicateCount + importPreview.summary.invalidCount,
        fileName: importPreview.fileName,
      });

      if (importPreview.latestDate) {
        const nextDate = createDateFromKey(importPreview.latestDate);
        if (nextDate) {
          setCurrentDate(nextDate);
        }
      }

      addToast(
        `Imported ${importedCount} rows. ${importPreview.summary.skippedCount} rows were safely skipped.`,
        'success',
        5000
      );
    } catch (error) {
      console.error(error);

      if (importedCount > 0) {
        setDailyData((previous) => {
          let nextRecords = previous;

          Object.entries(importedGroups).forEach(([dateKey, entries]) => {
            nextRecords = addEntriesToDay(nextRecords, dateKey, entries);
          });

          return nextRecords;
        });
      }

      addToast('Import stopped before completion. Existing data was left untouched.', 'error', 5000);
    } finally {
      setIsImporting(false);
    }
  };

  const clearImportPreview = () => {
    setImportPreview(null);
    setImportSummary(null);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      processInput();
    }
  };

  const MonthView = ({ year, month }) => {
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDayOfWeek = firstDay.getDay();
    const cells = [
      ...Array(startDayOfWeek).fill(null),
      ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
    ];

    return (
      <>
        <div className="mb-2 grid grid-cols-7">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => (
            <div key={day} className="py-2 text-center text-xs font-semibold text-slate-400">
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1.5">
          {cells.map((day, index) => {
            if (!day) {
              return <div key={`empty-${index}`} className="min-h-[86px] rounded-xl border border-transparent" />;
            }

            const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const record = dailyData[dateKey];
            const entryTotals = record ? sumEntries(record.entries) : null;
            const hasEntriesForDay = Boolean(record?.entries.length);
            const isSelected = selectedDateKey === dateKey;
            const isCalendarToday = formatDateKey(new Date()) === dateKey;

            return (
              <button
                key={dateKey}
                onClick={() => {
                  const nextDate = createDateFromKey(dateKey);
                  if (nextDate) {
                    setCurrentDate(nextDate);
                    setActiveTab('home');
                  }
                }}
                className={`min-h-[86px] rounded-2xl border p-2 text-left transition-all ${
                  isSelected
                    ? 'border-emerald-400 bg-emerald-50'
                    : hasEntriesForDay
                      ? 'border-slate-200 bg-slate-50 hover:border-slate-300'
                      : record
                        ? 'border-dashed border-slate-200 bg-white hover:border-slate-300'
                        : 'border-slate-100 bg-white hover:border-slate-200'
                }`}
              >
                <div className={`mb-1 text-xs font-bold ${isCalendarToday || isSelected ? 'text-emerald-600' : 'text-slate-600'}`}>
                  {day}
                </div>

                {hasEntriesForDay && entryTotals && (
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-orange-500">{entryTotals.calories.toFixed(0)} cal</div>
                    <div className="text-[11px] text-rose-400">P{entryTotals.protein.toFixed(0)}</div>
                    <div className="text-[11px] text-blue-400">C{entryTotals.carbs.toFixed(0)}</div>
                  </div>
                )}

                {!hasEntriesForDay && record && (
                  <div className="text-[11px] font-medium text-slate-400">Saved day</div>
                )}
              </button>
            );
          })}
        </div>
      </>
    );
  };

  const getMonthStats = (year, month) => {
    const monthKeys = trackedDateKeys.filter((dateKey) => {
      const [dateYear, dateMonth] = dateKey.split('-').map(Number);
      return dateYear === year && dateMonth === month + 1;
    });

    if (!monthKeys.length) return null;

    const daysWithEntries = monthKeys.filter((dateKey) => getDayRecord(dailyData, dateKey).entries.length > 0);
    const totalCalories = daysWithEntries.reduce(
      (sum, dateKey) => sum + sumEntries(getDayRecord(dailyData, dateKey).entries).calories,
      0
    );

    return {
      daysTracked: monthKeys.length,
      daysWithEntries: daysWithEntries.length,
      averageCalories: daysWithEntries.length ? totalCalories / daysWithEntries.length : 0,
    };
  };

  const YearView = ({ year }) => {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return (
      <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
        {Array.from({ length: 12 }, (_, month) => {
          const stats = getMonthStats(year, month);
          const isCurrentMonth = month === currentDate.getMonth() && year === currentDate.getFullYear();

          return (
            <button
              key={`${year}-${month}`}
              onClick={() => {
                setCurrentDate(new Date(year, month, 1));
                setCalendarView('month');
              }}
              className={`rounded-2xl border-2 p-4 text-left transition-all hover:shadow-md ${
                isCurrentMonth
                  ? 'border-emerald-400 bg-emerald-50'
                  : stats
                    ? 'border-slate-200 bg-slate-50'
                    : 'border-slate-100 bg-white'
              }`}
            >
              <div className="mb-1 font-semibold text-slate-700">{monthNames[month]}</div>
              {stats ? (
                <div className="space-y-0.5 text-xs text-slate-500">
                  <div>{stats.daysTracked} tracked days</div>
                  <div className="font-semibold text-orange-500">
                    {stats.daysWithEntries ? `${stats.averageCalories.toFixed(0)} cal/day` : 'No logged meals'}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-300">No history yet</div>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const MultiYearView = ({ focusYear }) => {
    const years = Array.from({ length: 12 }, (_, index) => focusYear + index - 6);

    return (
      <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
        {years.map((year) => {
          const yearKeys = trackedDateKeys.filter((dateKey) => Number(dateKey.slice(0, 4)) === year);
          const daysWithEntries = yearKeys.filter((dateKey) => getDayRecord(dailyData, dateKey).entries.length > 0);
          const totalCalories = daysWithEntries.reduce(
            (sum, dateKey) => sum + sumEntries(getDayRecord(dailyData, dateKey).entries).calories,
            0
          );
          const averageCalories = daysWithEntries.length ? totalCalories / daysWithEntries.length : 0;

          return (
            <button
              key={year}
              onClick={() => {
                setCurrentDate(new Date(year, 0, 1));
                setCalendarView('year');
              }}
              className={`rounded-2xl border-2 p-5 text-left transition-all hover:shadow-md ${
                year === currentDate.getFullYear()
                  ? 'border-emerald-400 bg-emerald-50'
                  : yearKeys.length
                    ? 'border-slate-200 bg-slate-50'
                    : 'border-slate-100 bg-white'
              }`}
            >
              <div className="mb-1 text-lg font-bold text-slate-700">{year}</div>
              {yearKeys.length ? (
                <div className="text-xs text-slate-500">
                  {yearKeys.length} tracked days
                  <div className="mt-1 font-semibold text-orange-500">
                    {daysWithEntries.length ? `${averageCalories.toFixed(0)} cal/day` : 'No logged meals'}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-300">No history yet</div>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const CalendarView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];

    const changeMonth = (delta) => setCurrentDate(new Date(year, month + delta, 1));
    const changeYear = (delta) => setCurrentDate(new Date(year + delta, month, 1));
    const zoomIn = () => {
      if (calendarView === 'multi-year') setCalendarView('year');
      else if (calendarView === 'year') setCalendarView('month');
    };
    const zoomOut = () => {
      if (calendarView === 'month') setCalendarView('year');
      else if (calendarView === 'year') setCalendarView('multi-year');
    };
    const previous = () =>
      calendarView === 'month' ? changeMonth(-1) : calendarView === 'year' ? changeYear(-1) : changeYear(-6);
    const next = () =>
      calendarView === 'month' ? changeMonth(1) : calendarView === 'year' ? changeYear(1) : changeYear(6);

    return (
      <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <button onClick={previous} className="rounded-xl p-2 transition-colors hover:bg-slate-100">
            <ChevronLeft size={20} className="text-slate-600" />
          </button>

          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">
              {calendarView === 'month' && `${monthNames[month]} ${year}`}
              {calendarView === 'year' && year}
              {calendarView === 'multi-year' && `${year - 6} - ${year + 5}`}
            </h2>
            <div className="flex gap-1.5">
              <button
                onClick={zoomOut}
                disabled={calendarView === 'multi-year'}
                className="rounded-lg p-1.5 transition-colors hover:bg-slate-100 disabled:opacity-30"
              >
                <ZoomOut size={16} className="text-slate-500" />
              </button>
              <button
                onClick={zoomIn}
                disabled={calendarView === 'month'}
                className="rounded-lg p-1.5 transition-colors hover:bg-slate-100 disabled:opacity-30"
              >
                <ZoomIn size={16} className="text-slate-500" />
              </button>
            </div>
          </div>

          <button onClick={next} className="rounded-xl p-2 transition-colors hover:bg-slate-100">
            <ChevronRight size={20} className="text-slate-600" />
          </button>
        </div>

        <p className="mb-6 text-sm text-slate-500">Tap any day to open its daily dashboard.</p>

        {calendarView === 'month' && <MonthView year={year} month={month} />}
        {calendarView === 'year' && <YearView year={year} />}
        {calendarView === 'multi-year' && <MultiYearView focusYear={year} />}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader className="animate-spin text-emerald-500" size={36} />
      </div>
    );
  }

  const progressPercentage = Math.round((totals.calories / (goals.calories || 1)) * 100);
  const remainingCalories = Math.max(0, goals.calories - totals.calories);
  const selectedDateLabel = isToday
    ? 'Today'
    : formatDisplayDate(currentDate, { weekday: 'long', month: 'short', day: 'numeric' });
  const selectedDateFullLabel = formatDisplayDate(currentDate, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-3xl bg-white p-8 shadow-2xl">
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute top-5 right-5 rounded-xl p-1.5 transition-colors hover:bg-slate-100"
            >
              <X size={20} className="text-slate-400" />
            </button>

            <h1 className="mb-1 text-2xl font-bold text-slate-800">
              {authMode === 'signup' ? 'Create account' : 'Welcome back'}
            </h1>
            <p className="mb-6 text-sm text-slate-500">
              {authMode === 'signup' ? 'Save history, goals, and imports across devices.' : 'Sign in to keep your history secure.'}
            </p>

            <div className="mb-6 flex gap-2 rounded-xl bg-slate-100 p-1">
              {['login', 'signup'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setAuthMode(mode)}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
                    authMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  {mode === 'login' ? 'Log in' : 'Sign up'}
                </button>
              ))}
            </div>

            <div className="mb-4 space-y-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleAuth()}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleAuth()}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
            </div>

            {authError && (
              <div className="mb-4 rounded-xl border border-red-100 bg-red-50 p-3">
                <p className="text-xs text-red-600">{authError}</p>
              </div>
            )}

            <button
              onClick={handleAuth}
              className="mb-4 w-full rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
            >
              {authMode === 'login' ? 'Log in' : 'Create account'}
            </button>

            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              onClick={handleGoogleSignIn}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-40 border-b border-slate-100 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500">
              <Flame size={15} className="text-white" />
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">FitTrack AI</div>
              <div className="text-xs text-slate-400">Nutrition tracking with smarter daily feedback</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!user && (
              <button
                onClick={() => setShowAuthModal(true)}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-600"
              >
                Sign in
              </button>
            )}

            {user && (
              <div className="relative">
                <button
                  onClick={() => setShowMenu((previous) => !previous)}
                  className="flex items-center gap-2 rounded-xl p-2 transition-colors hover:bg-slate-100"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-100">
                    <span className="text-xs font-bold text-emerald-600">{user.email?.[0]?.toUpperCase()}</span>
                  </div>
                </button>

                {showMenu && (
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-slate-100 bg-white py-2 shadow-xl">
                    <div className="mb-1 border-b border-slate-50 px-4 py-2">
                      <p className="truncate text-xs text-slate-400">{user.email}</p>
                    </div>

                    <button
                      onClick={() => {
                        setActiveTab('profile');
                        setShowMenu(false);
                      }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <Settings size={16} className="text-slate-400" />
                      Profile and goals
                    </button>

                    <div className="mt-1 border-t border-slate-100 pt-1">
                      <button
                        onClick={handleLogout}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-500 transition-colors hover:bg-red-50"
                      >
                        <LogOut size={16} />
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {!user && (
        <div className="mx-auto max-w-3xl px-5 pt-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-700">
              Guest mode is saved on this device only. Sign in to sync history, imports, and insights.
            </p>
            <button onClick={() => setShowAuthModal(true)} className="text-sm font-semibold text-amber-700 underline">
              Save it
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-3xl space-y-4 px-5 pt-5">
        {activeTab === 'home' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">{selectedDateLabel}</h2>
                <p className="text-sm text-slate-400">{selectedDateFullLabel}</p>
              </div>

              <div className="flex gap-1.5">
                <button
                  onClick={() => setCurrentDate((previous) => new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() - 1))}
                  className="rounded-xl border border-slate-200 p-2 transition-colors hover:bg-white"
                >
                  <ChevronLeft size={18} className="text-slate-500" />
                </button>
                <button
                  onClick={() => setCurrentDate(new Date())}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 transition-colors hover:bg-white"
                >
                  Today
                </button>
                <button
                  onClick={() => setCurrentDate((previous) => new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + 1))}
                  className="rounded-xl border border-slate-200 p-2 transition-colors hover:bg-white"
                >
                  <ChevronRight size={18} className="text-slate-500" />
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-6">
                <div className="relative h-20 w-20 flex-shrink-0">
                  <svg className="h-20 w-20 -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="30" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                    <circle
                      cx="40"
                      cy="40"
                      r="30"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="8"
                      strokeDasharray={`${2 * Math.PI * 30}`}
                      strokeDashoffset={`${2 * Math.PI * 30 * (1 - Math.min(totals.calories / (goals.calories || 1), 1))}`}
                      strokeLinecap="round"
                      className="transition-all duration-700"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs font-bold leading-none text-slate-700">{Number.isFinite(progressPercentage) ? progressPercentage : 0}%</span>
                  </div>
                </div>

                <div>
                  <div className="text-3xl font-bold tabular-nums text-slate-800">{totals.calories.toFixed(0)}</div>
                  <div className="text-sm text-slate-400">of {goals.calories} kcal</div>
                  <div className="mt-0.5 text-xs font-medium text-emerald-600">{remainingCalories.toFixed(0)} remaining</div>
                </div>
              </div>

              <MacroBar
                label="Protein"
                icon={Beef}
                current={totals.protein}
                goal={goals.protein}
                unit="g"
                color="text-rose-400"
                bgColor="bg-rose-400"
              />
              <MacroBar
                label="Carbs"
                icon={Wheat}
                current={totals.carbs}
                goal={goals.carbs}
                unit="g"
                color="text-blue-400"
                bgColor="bg-blue-400"
              />
              <MacroBar
                label="Fats"
                icon={Droplets}
                current={totals.fats}
                goal={goals.fats}
                unit="g"
                color="text-amber-400"
                bgColor="bg-amber-400"
              />
            </div>

            <DailyInsightCard
              insight={insight}
              status={insightStatus}
              hasEntries={selectedEntries.length > 0}
              onRefresh={() => refreshDailyInsight(true)}
            />

            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-700">Log food</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">Natural language enabled</span>
              </div>

              <textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isProcessing}
                rows={2}
                placeholder="Try: grilled chicken sandwich, 2 eggs with toast, large coffee with oat milk..."
                className="mb-3 w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700 transition-all placeholder:text-slate-300 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
              />

              <button
                onClick={processInput}
                disabled={isProcessing || !inputText.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-3 text-sm font-semibold text-white transition-all hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400"
              >
                {isProcessing ? (
                  <>
                    <Loader className="animate-spin" size={16} />
                    Estimating nutrition...
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Add food
                  </>
                )}
              </button>

              {lastParsed && (
                <div className="mt-3 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Check size={14} className="text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-700">
                      Logged successfully. Daily insight refreshes automatically.
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {lastParsed.items.map((item) => (
                      <div key={`${item.name}-${item.calories}-${item.protein}`} className="flex items-center justify-between gap-4">
                        <span className="min-w-0 truncate text-xs font-medium text-slate-600">{item.name}</span>
                        <div className="flex gap-2 text-xs text-slate-400">
                          <span className="font-semibold text-orange-500">{item.calories} cal</span>
                          <span>P{item.protein}g</span>
                          <span>C{item.carbs}g</span>
                          <span>F{item.fats}g</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-700">Food log</h3>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                  {selectedEntries.length} items
                </span>
              </div>

              {selectedEntries.length === 0 ? (
                <div className="rounded-3xl bg-slate-50 px-6 py-10 text-center">
                  <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
                    <History size={20} />
                  </div>
                  <p className="text-base font-semibold text-slate-700">
                    {hasTrackedDay ? 'No foods are left on this day.' : 'Nothing is logged yet.'}
                  </p>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                    {hasTrackedDay
                      ? 'This date is still preserved in your history, so edits and deletions do not quietly erase the day.'
                      : 'Log your first meal above, or import past data to build a more complete history.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedEntries.map((entry) => {
                    const isConfirmingDelete = confirmDeleteId === entry.id;

                    return (
                      <div
                        key={entry.id}
                        className="group flex items-center gap-3 rounded-2xl border border-transparent p-3 transition-colors hover:border-slate-100 hover:bg-slate-50"
                      >
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-sm font-semibold text-slate-700">{entry.name}</h4>
                          <div className="mt-0.5 flex gap-2.5 text-xs">
                            <span className="font-semibold text-orange-500">{entry.calories} cal</span>
                            <span className="text-slate-400">
                              P{entry.protein}g - C{entry.carbs}g - F{entry.fats}g
                            </span>
                          </div>
                        </div>

                        {!isConfirmingDelete ? (
                          <button
                            onClick={() => setConfirmDeleteId(entry.id)}
                            className="rounded-lg p-2 text-red-400 opacity-0 transition-all hover:bg-red-50 group-hover:opacity-100"
                          >
                            <Trash2 size={15} />
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteEntry(entry)}
                              className="rounded-lg bg-red-500 p-2 text-white transition-colors hover:bg-red-600"
                            >
                              <Check size={14} />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg bg-slate-100 p-2 text-slate-500 transition-colors hover:bg-slate-200"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'calendar' && <CalendarView />}

        {activeTab === 'import' && (
          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-6 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <FileSpreadsheet size={18} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Import history</h2>
                  <p className="text-sm text-slate-500">Review rows before anything is added to your tracker.</p>
                </div>
              </div>

              <div className="mb-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
                <p className="mb-2 font-semibold text-slate-700">Supported columns</p>
                <p>Date or Day</p>
                <p>Calories, Protein, Carbs, Fat</p>
                <p>Optional food label columns such as Food, Name, Item, Meal, or Description</p>
                <p className="mt-2 text-xs text-slate-500">
                  Common date formats like 2025-03-24, 3/24/2025, and March 24 are handled automatically.
                </p>
              </div>

              <label className="block cursor-pointer">
                <input
                  type="file"
                  accept=".csv,.txt,.tsv"
                  onChange={handleFileImport}
                  className="hidden"
                  disabled={isPreparingImport || isImporting}
                />
                <div
                  className={`flex w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-sm font-semibold transition-all ${
                    isPreparingImport || isImporting
                      ? 'bg-slate-100 text-slate-400'
                      : 'bg-emerald-500 text-white hover:bg-emerald-600'
                  }`}
                >
                  {isPreparingImport ? (
                    <>
                      <Loader className="animate-spin" size={18} />
                      Preparing preview...
                    </>
                  ) : isImporting ? (
                    <>
                      <Loader className="animate-spin" size={18} />
                      Importing rows...
                    </>
                  ) : (
                    <>
                      <Upload size={18} />
                      Choose file
                    </>
                  )}
                </div>
              </label>
            </div>

            {importPreview && (
              <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-800">Import preview</h3>
                    <p className="text-sm text-slate-500">{importPreview.fileName}</p>
                  </div>

                  <button
                    onClick={clearImportPreview}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    Clear preview
                  </button>
                </div>

                <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <ImportMetric label="Ready" value={importPreview.summary.readyToImport} tone="success" />
                  <ImportMetric label="Skipped" value={importPreview.summary.skippedCount} tone="warning" />
                  <ImportMetric label="Duplicates" value={importPreview.summary.duplicateCount} />
                  <ImportMetric label="Invalid" value={importPreview.summary.invalidCount} tone="danger" />
                </div>

                <div className="mb-5 rounded-2xl bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-700">What will happen</div>
                  <div className="mt-2 space-y-1 text-sm text-slate-600">
                    <p>Only validated rows will be inserted.</p>
                    <p>Duplicate rows are skipped before import.</p>
                    <p>Existing meals and history stay untouched.</p>
                  </div>
                </div>

                {importPreview.previewRows.length > 0 && (
                  <div className="mb-5">
                    <div className="mb-3 text-sm font-semibold text-slate-700">Preview rows</div>
                    <div className="space-y-2">
                      {importPreview.previewRows.map((row) => (
                        <div
                          key={`${row.rowNumber}-${row.dateKey}-${row.entry.name}`}
                          className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 p-3"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-700">{row.entry.name}</div>
                            <div className="text-xs text-slate-400">
                              Row {row.rowNumber} - {row.dateKey}
                            </div>
                          </div>
                          <div className="text-right text-xs text-slate-500">
                            <div className="font-semibold text-orange-500">{row.entry.calories} cal</div>
                            <div>
                              P{row.entry.protein}g - C{row.entry.carbs}g - F{row.entry.fats}g
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(importPreview.duplicateRows.length > 0 || importPreview.invalidRows.length > 0) && (
                  <div className="mb-5 grid gap-3 md:grid-cols-2">
                    {importPreview.duplicateRows.length > 0 && (
                      <div className="rounded-2xl border border-slate-100 p-4">
                        <div className="mb-2 text-sm font-semibold text-slate-700">Duplicate rows skipped</div>
                        <div className="space-y-2 text-sm text-slate-500">
                          {importPreview.duplicateRows.slice(0, 4).map((row) => (
                            <p key={`dup-${row.rowNumber}`}>
                              Row {row.rowNumber}: {row.name} on {row.dateKey}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {importPreview.invalidRows.length > 0 && (
                      <div className="rounded-2xl border border-slate-100 p-4">
                        <div className="mb-2 text-sm font-semibold text-slate-700">Invalid rows skipped</div>
                        <div className="space-y-2 text-sm text-slate-500">
                          {importPreview.invalidRows.slice(0, 4).map((row) => (
                            <p key={`bad-${row.rowNumber}`}>
                              Row {row.rowNumber}: {row.reason}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={confirmImport}
                  disabled={!importPreview.summary.readyToImport || isImporting}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {isImporting ? (
                    <>
                      <Loader className="animate-spin" size={16} />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      Import {importPreview.summary.readyToImport} validated rows
                    </>
                  )}
                </button>
              </div>
            )}

            {importSummary && (
              <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-6 shadow-sm">
                <div className="mb-2 text-base font-semibold text-emerald-800">Import complete</div>
                <div className="space-y-1 text-sm text-emerald-700">
                  <p>{importSummary.importedCount} rows imported</p>
                  <p>{importSummary.skippedCount} rows skipped</p>
                  <p>{importSummary.duplicateCount} duplicates skipped</p>
                  <p>{importSummary.invalidCount} invalid rows skipped</p>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setActiveTab('calendar')}
                    className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    Review calendar
                  </button>
                  <button
                    onClick={() => setActiveTab('home')}
                    className="rounded-xl border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    Open selected day
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-100">
                <User size={18} className="text-indigo-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Profile and goals</h2>
                <p className="text-sm text-slate-500">{user ? 'Saved automatically' : 'Stored on this device in guest mode'}</p>
              </div>
            </div>

            <div className="mb-6 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Height', key: 'height', placeholder: 'e.g. 183 cm or 6 ft' },
                  { label: 'Weight', key: 'weight', placeholder: 'e.g. 180 lb or 82 kg' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
                    <input
                      type="text"
                      value={profile[key]}
                      onChange={(event) => setProfile((previous) => ({ ...previous, [key]: event.target.value }))}
                      placeholder={placeholder}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    />
                  </div>
                ))}
              </div>

              {[
                { label: 'Fitness goal', key: 'goal', placeholder: 'e.g. lose fat while keeping muscle' },
                { label: 'Workout frequency', key: 'workout_frequency', placeholder: 'e.g. 4 to 5 sessions per week' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
                  <input
                    type="text"
                    value={profile[key]}
                    onChange={(event) => setProfile((previous) => ({ ...previous, [key]: event.target.value }))}
                    placeholder={placeholder}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
                  />
                </div>
              ))}

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Additional info</label>
                <textarea
                  value={profile.additional_info}
                  onChange={(event) => setProfile((previous) => ({ ...previous, additional_info: event.target.value }))}
                  placeholder="Diet preferences, allergies, or anything the goal setting should consider..."
                  className="min-h-20 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
            </div>

            <button
              onClick={generateGoals}
              disabled={isGeneratingGoals}
              className="mb-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-500 py-3 text-sm font-semibold text-white transition-all hover:bg-indigo-600 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {isGeneratingGoals ? (
                <>
                  <Loader className="animate-spin" size={16} />
                  Generating targets...
                </>
              ) : (
                <>
                  <Target size={16} />
                  Generate goals with AI
                </>
              )}
            </button>

            <div className="rounded-2xl bg-slate-50 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Current goals</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Calories', value: goals.calories, unit: '', color: 'text-orange-500' },
                  { label: 'Protein', value: goals.protein, unit: 'g', color: 'text-rose-500' },
                  { label: 'Carbs', value: goals.carbs, unit: 'g', color: 'text-blue-500' },
                  { label: 'Fats', value: goals.fats, unit: 'g', color: 'text-amber-500' },
                ].map(({ label, value, unit, color }) => (
                  <div key={label} className="rounded-xl bg-white p-3">
                    <div className="mb-0.5 text-xs text-slate-400">{label}</div>
                    <div className={`text-xl font-bold ${color}`}>
                      {value}
                      <span className="text-sm font-normal text-slate-400">{unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="safe-area-pb fixed bottom-0 left-0 right-0 border-t border-slate-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl">
          {[
            { tab: 'home', icon: Home, label: 'Today' },
            { tab: 'calendar', icon: Calendar, label: 'Calendar' },
            { tab: 'import', icon: Upload, label: 'Import' },
            { tab: 'profile', icon: User, label: 'Profile' },
          ].map(({ tab, icon: Icon, label }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-1 flex-col items-center gap-1 py-3.5 transition-colors ${
                activeTab === tab ? 'text-emerald-500' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Icon size={22} strokeWidth={activeTab === tab ? 2.5 : 1.8} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
