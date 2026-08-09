import React, { Suspense, lazy, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Beef,
  Brain,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
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
} from 'lucide-react';

import { logout, signInWithEmail, signInWithGoogle, signUpWithEmail, subscribeToAuth } from './lib/authService';
import { addMeals, deleteAllMeals, deleteMeal, getMeals } from './lib/mealService';
import { getUserSettings, resetUserSettings, saveGoals as saveUserGoals, saveProfile as saveUserProfile } from './lib/userService';
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

const CalendarView = lazy(() => import('./components/CalendarView.jsx'));

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
const GUEST_ENTRY_SOURCES_KEY = 'fittrack:guest:entry-sources';

const getUserProfileKey = (userId) => `fittrack:user:${userId}:profile`;
const getUserGoalsKey = (userId) => `fittrack:user:${userId}:goals`;
const getUserDayRecordsKey = (userId) => `fittrack:user:${userId}:day-records`;
const getUserDayRegistryKey = (userId) => `fittrack:user:${userId}:day-registry`;
const getUserInsightsKey = (userId) => `fittrack:user:${userId}:insights`;
const getUserEntrySourcesKey = (userId) => `fittrack:user:${userId}:entry-sources`;

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

function removeStoredKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.error('Storage remove error:', error);
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
          source: entry.source || null,
        }))
      : [];

    hydrated[dateKey] = createDayRecord(dateKey, {
      ...record,
      entries,
    });
  });

  return hydrated;
}

async function loadPapaParse() {
  const module = await import('papaparse');
  return module.default;
}

async function parseCsvText(text) {
  const Papa = await loadPapaParse();

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

function applyEntrySourcesToDayRecords(dayRecords, sourceMap = {}) {
  const nextRecords = {};

  Object.entries(dayRecords || {}).forEach(([dateKey, record]) => {
    nextRecords[dateKey] = createDayRecord(dateKey, {
      ...record,
      entries: (record.entries || []).map((entry) => ({
        ...entry,
        source: sourceMap[entry.id] || entry.source || 'logged',
      })),
    });
  });

  return nextRecords;
}

function hasProfileDetails(profile) {
  return Object.values(profile || {}).some((value) => String(value || '').trim());
}

function buildEntrySourceMap(entries = [], source) {
  return entries.reduce((accumulator, entry) => {
    accumulator[entry.id] = source;
    return accumulator;
  }, {});
}

function toAppUser(firebaseUser) {
  if (!firebaseUser) return null;

  return {
    id: firebaseUser.uid,
    email: firebaseUser.email || '',
    user_metadata: {
      username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || '',
    },
  };
}

function flattenEntriesForExport(dayRecords) {
  return listKnownDateKeys(dayRecords)
    .slice()
    .reverse()
    .flatMap((dateKey) =>
      getDayRecord(dayRecords, dateKey).entries
        .slice()
        .sort((left, right) => new Date(left.timestamp || 0).getTime() - new Date(right.timestamp || 0).getTime())
        .map((entry) => ({
          date: dateKey,
          entry_name: entry.name,
          calories: entry.calories,
          protein: entry.protein,
          carbs: entry.carbs,
          fats: entry.fats,
          source: entry.source || 'logged',
          created_at: entry.timestamp || '',
        }))
    );
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
    <div className="mb-5 last:mb-0">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50">
            <Icon size={14} className={color} />
          </span>
          <span className="text-sm font-semibold text-slate-600">{label}</span>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${isOver ? 'text-red-500' : 'text-slate-700'}`}>
          {current.toFixed(0)}
          <span className="font-normal text-slate-400">
            /{goal}
            {unit}
          </span>
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100/90">
        <div
          className={`h-2.5 rounded-full shadow-sm transition-all duration-500 ${isOver ? 'bg-red-400' : bgColor}`}
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
    <div className="surface-card rounded-[1.75rem] bg-white p-5 sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 text-white shadow-lg shadow-slate-200">
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

function ResetDataModal({ open, confirmationText, setConfirmationText, isResetting, onClose, onConfirm }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-5 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-red-100 bg-white p-7 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800">Reset all nutrition data?</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              This will permanently remove your tracked meals, daily history, imported records, and saved nutrition data
              for this account. This action cannot be undone.
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
          Type <span className="font-bold">RESET</span> to confirm.
        </div>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">Confirmation</label>
          <input
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
            placeholder="Type RESET"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-400"
          />
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            disabled={isResetting}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isResetting || confirmationText.trim().toUpperCase() !== 'RESET'}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-600 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {isResetting ? (
              <>
                <Loader size={16} className="animate-spin" />
                Resetting...
              </>
            ) : (
              'Reset all data'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function LoadingPulse({ className }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-200/80 ${className}`} />;
}

function HomeStartupShell() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <LoadingPulse className="h-8 w-36" />
          <LoadingPulse className="h-4 w-44" />
        </div>
        <div className="flex gap-1.5">
          <LoadingPulse className="h-10 w-10 rounded-xl" />
          <LoadingPulse className="h-10 w-16 rounded-xl" />
          <LoadingPulse className="h-10 w-10 rounded-xl" />
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-6 flex items-center gap-6">
          <LoadingPulse className="h-20 w-20 rounded-full" />
          <div className="space-y-2">
            <LoadingPulse className="h-9 w-28" />
            <LoadingPulse className="h-4 w-24" />
            <LoadingPulse className="h-3 w-20" />
          </div>
        </div>
        <div className="space-y-4">
          <LoadingPulse className="h-12 w-full" />
          <LoadingPulse className="h-12 w-full" />
          <LoadingPulse className="h-12 w-full" />
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <LoadingPulse className="h-11 w-11" />
            <div className="space-y-2">
              <LoadingPulse className="h-5 w-28" />
              <LoadingPulse className="h-4 w-56" />
            </div>
          </div>
          <LoadingPulse className="h-10 w-28 rounded-xl" />
        </div>
        <div className="space-y-3">
          <LoadingPulse className="h-20 w-full" />
          <div className="grid gap-3 md:grid-cols-2">
            <LoadingPulse className="h-28 w-full" />
            <LoadingPulse className="h-28 w-full" />
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <LoadingPulse className="h-5 w-24" />
          <LoadingPulse className="h-6 w-36 rounded-full" />
        </div>
        <LoadingPulse className="mb-3 h-24 w-full" />
        <LoadingPulse className="h-12 w-full" />
      </div>
    </div>
  );
}

function CalendarPanelFallback() {
  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
      <div className="mb-6 flex items-center justify-between">
        <LoadingPulse className="h-10 w-10 rounded-xl" />
        <LoadingPulse className="h-8 w-40" />
        <LoadingPulse className="h-10 w-10 rounded-xl" />
      </div>
      <LoadingPulse className="mb-6 h-4 w-52" />
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 35 }, (_, index) => (
          <LoadingPulse key={index} className="min-h-[86px] w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

export default function FitnessTracker() {
  const skipNextProfileSaveRef = useRef(false);
  const skipNextGoalsSaveRef = useRef(false);
  const hydrationRunRef = useRef(0);

  const [user, setUser] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isHydratingUserData, setIsHydratingUserData] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

  const [activeTab, setActiveTab] = useState('home');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState('month');
  const [showMenu, setShowMenu] = useState(false);

  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [goals, setGoals] = useState(DEFAULT_GOALS);
  const [dailyData, setDailyData] = useState({});
  const [dailyInsights, setDailyInsights] = useState({});
  const [entrySources, setEntrySources] = useState({});

  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSavingMeal, setIsSavingMeal] = useState(false);
  const [isGeneratingGoals, setIsGeneratingGoals] = useState(false);
  const [isPreparingImport, setIsPreparingImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isResettingData, setIsResettingData] = useState(false);
  const [lastParsed, setLastParsed] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  const [importSummary, setImportSummary] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetConfirmationText, setResetConfirmationText] = useState('');

  const [toasts, setToasts] = useState([]);

  const selectedDateKey = useMemo(() => formatDateKey(currentDate), [currentDate]);
  const selectedDay = useMemo(() => getDayRecord(dailyData, selectedDateKey), [dailyData, selectedDateKey]);
  const selectedEntries = selectedDay.entries;
  const totals = useMemo(() => sumEntries(selectedEntries), [selectedEntries]);
  const trackedDateKeys = useMemo(() => listKnownDateKeys(dailyData), [dailyData]);
  const trackedEntryCount = useMemo(
    () => trackedDateKeys.reduce((sum, dateKey) => sum + getDayRecord(dailyData, dateKey).entries.length, 0),
    [dailyData, trackedDateKeys]
  );
  const hasTrackedDay = Boolean(dailyData[selectedDateKey]);
  const isToday = selectedDateKey === formatDateKey(new Date());
  const insightFingerprint = useMemo(
    () => buildInsightFingerprint({ entries: selectedEntries, totals, goals }),
    [goals, selectedEntries, totals]
  );
  const currentInsightState = dailyInsights[selectedDateKey];
  const insight = useMemo(
    () =>
      selectedEntries.length
        ? currentInsightState?.data || buildFallbackInsight({ entries: selectedEntries, totals, goals })
        : buildFallbackInsight({ entries: [], totals, goals }),
    [currentInsightState?.data, goals, selectedEntries, totals]
  );
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

  const applyTrackerSnapshot = useCallback(({ nextProfile, nextGoals, nextDailyData, nextDailyInsights, nextEntrySources }, options = {}) => {
    const commit = () => {
      setProfile({ ...DEFAULT_PROFILE, ...(nextProfile || {}) });
      setGoals({ ...DEFAULT_GOALS, ...(nextGoals || {}) });
      setEntrySources(nextEntrySources || {});
      setDailyData(applyEntrySourcesToDayRecords(nextDailyData || {}, nextEntrySources || {}));
      setDailyInsights(nextDailyInsights || {});
    };

    if (options.nonUrgent) {
      startTransition(commit);
      return;
    }

    commit();
  }, []);

  const loadGuestState = useCallback(() => {
    const storedSources = readStoredJson(GUEST_ENTRY_SOURCES_KEY, {});
    const storedDayRecords = hydrateLocalDayRecords(readStoredJson(GUEST_DAY_RECORDS_KEY, {}));

    applyTrackerSnapshot({
      nextProfile: readStoredJson(GUEST_PROFILE_KEY, DEFAULT_PROFILE),
      nextGoals: readStoredJson(GUEST_GOALS_KEY, DEFAULT_GOALS),
      nextDailyData: storedDayRecords,
      nextDailyInsights: readStoredJson(GUEST_INSIGHTS_KEY, {}),
      nextEntrySources: storedSources,
    });
  }, [applyTrackerSnapshot]);

  const restoreUserCache = useCallback((userId) => {
    const cachedProfile = readStoredJson(getUserProfileKey(userId), DEFAULT_PROFILE);
    const cachedGoals = readStoredJson(getUserGoalsKey(userId), DEFAULT_GOALS);
    const cachedInsights = readStoredJson(getUserInsightsKey(userId), {});
    const cachedSources = readStoredJson(getUserEntrySourcesKey(userId), {});
    const cachedDayRecords = hydrateLocalDayRecords(readStoredJson(getUserDayRecordsKey(userId), {}));

    const hasCache =
      Object.keys(cachedDayRecords).length > 0 ||
      Object.keys(cachedInsights).length > 0 ||
      Object.keys(cachedSources).length > 0 ||
      hasProfileDetails(cachedProfile) ||
      JSON.stringify(cachedGoals) !== JSON.stringify(DEFAULT_GOALS);

    if (!hasCache) {
      return false;
    }

    applyTrackerSnapshot({
      nextProfile: cachedProfile,
      nextGoals: cachedGoals,
      nextDailyData: cachedDayRecords,
      nextDailyInsights: cachedInsights,
      nextEntrySources: cachedSources,
    });

    return true;
  }, [applyTrackerSnapshot]);

  const loadUserData = useCallback(async (currentUser, { hasCache = false, runId } = {}) => {
    const storedDates = readStoredJson(getUserDayRegistryKey(currentUser.id), []);
    const storedSources = readStoredJson(getUserEntrySourcesKey(currentUser.id), {});
    const storedInsights = readStoredJson(getUserInsightsKey(currentUser.id), {});

    try {
      const todayDateKey = formatDateKey(new Date());
      const [settings, todayEntries] = await Promise.all([
        getUserSettings(currentUser.id),
        getMeals(currentUser.id, { date: todayDateKey }),
      ]);

      if (runId !== hydrationRunRef.current) return;

      const nextProfile = { ...DEFAULT_PROFILE, ...(settings.profile || {}) };
      const nextGoals = { ...DEFAULT_GOALS, ...(settings.goals || {}) };

      if (hasCache) {
        startTransition(() => {
          setProfile(nextProfile);
          setGoals(nextGoals);
        });
      } else {
        const todaysRecords = organizeEntriesByDay(todayEntries || [], storedDates);

        applyTrackerSnapshot(
          {
            nextProfile,
            nextGoals,
            nextDailyData: todaysRecords,
            nextDailyInsights: storedInsights,
            nextEntrySources: storedSources,
          },
          { nonUrgent: true }
        );
      }

      const entries = await getMeals(currentUser.id);

      if (runId !== hydrationRunRef.current) return;

      applyTrackerSnapshot(
        {
          nextProfile,
          nextGoals,
          nextDailyData: organizeEntriesByDay(entries || [], storedDates),
          nextDailyInsights: storedInsights,
          nextEntrySources: storedSources,
        },
        { nonUrgent: true }
      );
    } catch (error) {
      if (runId !== hydrationRunRef.current) return;
      console.error('Error loading user data:', error);
      addToast('Unable to load your saved nutrition data right now. Cached data is still available.', 'error');
    } finally {
      if (runId === hydrationRunRef.current) {
        setIsHydratingUserData(false);
      }
    }
  }, [addToast, applyTrackerSnapshot]);

  const beginUserHydration = useCallback((nextUser) => {
    const runId = hydrationRunRef.current + 1;
    hydrationRunRef.current = runId;

    setUser(nextUser);
    setIsHydratingUserData(true);
    const hasCache = restoreUserCache(nextUser.id);
    setIsBootstrapping(false);

    void loadUserData(nextUser, { hasCache, runId });
  }, [loadUserData, restoreUserCache]);

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      try {
        if (!isMounted) return;
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setUser(null);
          loadGuestState();
          setIsBootstrapping(false);
          setIsHydratingUserData(false);
        }
      }
    };

    bootstrap();

    const unsubscribe = subscribeToAuth((firebaseUser) => {
      if (!isMounted) return;

      setShowMenu(false);

      const appUser = toAppUser(firebaseUser);

      if (appUser) {
        beginUserHydration(appUser);
      } else {
        hydrationRunRef.current += 1;
        setUser(null);
        loadGuestState();
        setIsHydratingUserData(false);
        setIsBootstrapping(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [beginUserHydration, loadGuestState]);

  useEffect(() => {
    if (isBootstrapping || user) return;

    writeStoredJson(GUEST_DAY_RECORDS_KEY, dailyData);
    writeStoredJson(GUEST_PROFILE_KEY, profile);
    writeStoredJson(GUEST_GOALS_KEY, goals);
    writeStoredJson(GUEST_INSIGHTS_KEY, dailyInsights);
    writeStoredJson(GUEST_ENTRY_SOURCES_KEY, entrySources);
  }, [dailyData, dailyInsights, entrySources, goals, isBootstrapping, profile, user]);

  useEffect(() => {
    if (isBootstrapping || !user || isHydratingUserData) return;

    writeStoredJson(getUserDayRecordsKey(user.id), dailyData);
    writeStoredJson(getUserDayRegistryKey(user.id), extractPreservedDates(dailyData));
  }, [dailyData, isBootstrapping, isHydratingUserData, user]);

  useEffect(() => {
    if (isBootstrapping) return;

    if (user) {
      if (isHydratingUserData) return;

      writeStoredJson(getUserProfileKey(user.id), profile);
      writeStoredJson(getUserGoalsKey(user.id), goals);
      writeStoredJson(getUserInsightsKey(user.id), dailyInsights);
      writeStoredJson(getUserEntrySourcesKey(user.id), entrySources);
      return;
    }

    writeStoredJson(GUEST_INSIGHTS_KEY, dailyInsights);
    writeStoredJson(GUEST_ENTRY_SOURCES_KEY, entrySources);
  }, [dailyInsights, entrySources, goals, isBootstrapping, isHydratingUserData, profile, user]);

  const saveProfile = useCallback(async () => {
    if (!user) return;

    try {
      await saveUserProfile(user.id, {
        username: profile.username || user.user_metadata?.username || user.email?.split('@')[0] || '',
        height: profile.height,
        weight: profile.weight,
        goal: profile.goal,
        workout_frequency: profile.workout_frequency,
        additional_info: profile.additional_info,
      });
    } catch (error) {
      console.error('Profile save error:', error);
      addToast('Couldn’t save profile changes. Try again.', 'error');
    }
  }, [addToast, profile, user]);

  const saveGoals = useCallback(async () => {
    if (!user) return;

    try {
      await saveUserGoals(user.id, goals);
    } catch (error) {
      console.error('Goals save error:', error);
      addToast('Couldn’t save goals. Try again.', 'error');
    }
  }, [addToast, goals, user]);

  useEffect(() => {
    if (!user || !profile.height || isBootstrapping || isHydratingUserData) return undefined;
    if (skipNextProfileSaveRef.current) {
      skipNextProfileSaveRef.current = false;
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      saveProfile();
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [isBootstrapping, isHydratingUserData, profile, saveProfile, user]);

  useEffect(() => {
    if (!user || isBootstrapping || isHydratingUserData) return undefined;
    if (skipNextGoalsSaveRef.current) {
      skipNextGoalsSaveRef.current = false;
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      saveGoals();
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [goals, isBootstrapping, isHydratingUserData, saveGoals, user]);

  const handleAuth = async () => {
    setAuthError('');

    if (!email || !password) {
      setAuthError('Please fill in both fields.');
      return;
    }

    setIsAuthSubmitting(true);

    try {
      if (authMode === 'signup') {
        await signUpWithEmail(email, password);
        setShowAuthModal(false);
        setEmail('');
        setPassword('');
        addToast('Account created. Verification email sent.', 'success', 5000);
      } else {
        await signInWithEmail(email, password);
        setShowAuthModal(false);
        setEmail('');
        setPassword('');
        addToast('Welcome back.', 'success');
      }
    } catch (error) {
      setAuthError(error.message || 'Authentication failed. Try again.');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError('');
    setIsAuthSubmitting(true);

    try {
      await signInWithGoogle();
      setShowAuthModal(false);
      addToast('Signed in with Google.', 'success');
    } catch (error) {
      setAuthError(error.message || 'Google sign-in failed. Try again.');
      addToast(error.message || 'Google sign-in failed. Try again.', 'error');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setShowMenu(false);
      addToast('Signed out.', 'info');
    } catch (error) {
      console.error('Logout error:', error);
      addToast('Couldn’t sign out. Try again.', 'error');
    }
  };

  const refreshDailyInsight = useCallback(async (forceRefresh = false) => {
    if (!selectedEntries.length || isBootstrapping || isHydratingUserData) return;

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
  }, [addToast, dailyInsights, goals, isBootstrapping, isHydratingUserData, selectedDateKey, selectedEntries, totals]);

  useEffect(() => {
    if (!selectedEntries.length || isBootstrapping || isHydratingUserData || activeTab !== 'home') return undefined;

    if (
      currentInsightState?.fingerprint === insightFingerprint &&
      ['ready', 'loading', 'error'].includes(currentInsightState.status)
    ) {
      return undefined;
    }

    let timeoutId = null;
    let idleId = null;

    const runInsightRefresh = () => {
      timeoutId = window.setTimeout(() => {
        refreshDailyInsight(false);
      }, 900);
    };

    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(runInsightRefresh, { timeout: 1500 });
    } else {
      runInsightRefresh();
    }

    return () => {
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    activeTab,
    currentInsightState?.fingerprint,
    currentInsightState?.status,
    insightFingerprint,
    isBootstrapping,
    isHydratingUserData,
    refreshDailyInsight,
    selectedEntries.length,
  ]);

  const processInput = async () => {
    if (!inputText.trim() || isMutationLocked) return;

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
        setIsSavingMeal(true);
        const mealsToInsert = parsedItems.map((item) => ({
          date: selectedDateKey,
          name: item.name,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fats,
          source: 'ai_parsed',
        }));

        const savedMeals = await addMeals(user.id, mealsToInsert);
        newEntries = (savedMeals || []).map((entry) => ({
          ...mapEntryFromDatabase(entry),
          source: 'ai_parsed',
        }));
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
          source: 'ai_parsed',
        }));
      }

      setDailyData((previous) => addEntriesToDay(previous, selectedDateKey, newEntries));
      setEntrySources((previous) => ({ ...previous, ...buildEntrySourceMap(newEntries, 'ai_parsed') }));

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
      addToast(user ? 'Couldn’t save. Try again.' : `Error: ${error.message}`, 'error');
    } finally {
      setIsSavingMeal(false);
      setIsProcessing(false);
    }
  };

  const deleteEntry = async (entry) => {
    if (isMutationLocked) return;

    try {
      if (user) {
        await deleteMeal(user.id, entry.id);
      }

      const willBeEmpty = selectedEntries.length === 1;

      setDailyData((previous) => deleteEntryFromDay(previous, selectedDateKey, entry.id));
      setEntrySources((previous) => {
        const nextSources = { ...previous };
        delete nextSources[entry.id];
        return nextSources;
      });
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
    if (isMutationLocked) return;

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
        await saveUserGoals(user.id, nextGoals);
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
    if (isMutationLocked) return;

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
    if (isMutationLocked) return;

    if (!importPreview?.validRows?.length) return;

    setIsImporting(true);

    const importedGroups = {};
    let importedCount = 0;

    try {
      if (user) {
        const chunks = chunkArray(importPreview.validRows, 100);

        for (const chunk of chunks) {
          const rows = chunk.map((item) => ({
            date: item.dateKey,
            name: item.entry.name,
            calories: item.entry.calories,
            protein: item.entry.protein,
            carbs: item.entry.carbs,
            fat: item.entry.fats,
            source: 'imported',
          }));

          const savedMeals = await addMeals(user.id, rows);

          (savedMeals || []).forEach((row) => {
            if (!importedGroups[row.date]) importedGroups[row.date] = [];
            importedGroups[row.date].push({
              ...mapEntryFromDatabase(row),
              source: 'imported',
            });
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
            source: 'imported',
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
      setEntrySources((previous) => {
        let nextSources = { ...previous };

        Object.values(importedGroups).forEach((entries) => {
          nextSources = { ...nextSources, ...buildEntrySourceMap(entries, 'imported') };
        });

        return nextSources;
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

  const exportCsv = async () => {
    const exportRows = flattenEntriesForExport(dailyData);

    if (!exportRows.length) {
      addToast('There is no nutrition history to export yet.', 'info');
      return;
    }

    const Papa = await loadPapaParse();
    const csv = Papa.unparse(exportRows, {
      columns: ['date', 'entry_name', 'calories', 'protein', 'carbs', 'fats', 'source', 'created_at'],
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    const exportDate = formatDateKey(new Date()) || 'today';

    link.href = url;
    link.setAttribute('download', `nutrition-log-${exportDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    addToast(`Downloaded ${exportRows.length} nutrition rows.`, 'success');
  };

  const clearTrackingState = useCallback(() => {
    setDailyData({});
    setDailyInsights({});
    setEntrySources({});
    setGoals(DEFAULT_GOALS);
    setProfile(DEFAULT_PROFILE);
    setInputText('');
    setLastParsed(null);
    setImportPreview(null);
    setImportSummary(null);
    setConfirmDeleteId(null);
    setCurrentDate(new Date());
    setActiveTab('home');
  }, []);

  const closeResetModal = () => {
    setShowResetModal(false);
    setResetConfirmationText('');
  };

  const handleResetAllData = async () => {
    if (resetConfirmationText.trim().toUpperCase() !== 'RESET') return;

    setIsResettingData(true);

    try {
      skipNextProfileSaveRef.current = true;
      skipNextGoalsSaveRef.current = true;

      if (user) {
        await Promise.all([
          deleteAllMeals(user.id),
          resetUserSettings(
            user.id,
            {
              ...DEFAULT_PROFILE,
              username: user.user_metadata?.username || user.email?.split('@')[0] || '',
            },
            DEFAULT_GOALS
          ),
        ]);

        removeStoredKey(getUserDayRegistryKey(user.id));
        removeStoredKey(getUserInsightsKey(user.id));
        removeStoredKey(getUserEntrySourcesKey(user.id));
      } else {
        removeStoredKey(GUEST_DAY_RECORDS_KEY);
        removeStoredKey(GUEST_PROFILE_KEY);
        removeStoredKey(GUEST_GOALS_KEY);
        removeStoredKey(GUEST_INSIGHTS_KEY);
        removeStoredKey(GUEST_ENTRY_SOURCES_KEY);
      }

      clearTrackingState();
      closeResetModal();
      addToast('All nutrition tracking data has been reset.', 'success', 5000);
    } catch (error) {
      console.error('Reset data error:', error);
      addToast('Unable to reset data right now.', 'error');
    } finally {
      setIsResettingData(false);
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      processInput();
    }
  };

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
  const hasVisibleShellData = trackedDateKeys.length > 0 || selectedEntries.length > 0 || hasProfileDetails(profile);
  const showHomeStartupShell = activeTab === 'home' && (isBootstrapping || isHydratingUserData) && !hasVisibleShellData;
  const isAccountSyncing = isBootstrapping || isHydratingUserData;
  const isMutationLocked = Boolean(user && isHydratingUserData);

  return (
    <div className="app-shell min-h-screen pb-28">
      <ToastContainer toasts={toasts} removeToast={removeToast} />
      <ResetDataModal
        open={showResetModal}
        confirmationText={resetConfirmationText}
        setConfirmationText={setResetConfirmationText}
        isResetting={isResettingData}
        onClose={closeResetModal}
        onConfirm={handleResetAllData}
      />

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
                  disabled={isAuthSubmitting}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-emerald-400"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-600">Password</label>
                <input
                  type="password"
                  value={password}
                  disabled={isAuthSubmitting}
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
              disabled={isAuthSubmitting}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400"
            >
              {isAuthSubmitting ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  {authMode === 'login' ? 'Signing in...' : 'Creating account...'}
                </>
              ) : (
                authMode === 'login' ? 'Log in' : 'Create account'
              )}
            </button>

            <div className="mb-4 flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400">or</span>
              <div className="h-px flex-1 bg-slate-200" />
            </div>

            <button
              onClick={handleGoogleSignIn}
              disabled={isAuthSubmitting}
              className="flex w-full items-center justify-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:bg-slate-100 disabled:text-slate-400"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {isAuthSubmitting ? 'Opening Google...' : 'Continue with Google'}
            </button>
          </div>
        </div>
      )}

      <div className="app-header sticky top-0 z-40 border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4 sm:px-7">
          <div className="flex items-center gap-2.5">
            <div className="brand-mark flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600">
              <Flame size={18} className="text-white" />
            </div>
            <div>
              <div className="text-lg font-extrabold tracking-tight text-slate-900">FitTrack <span className="text-emerald-600">AI</span></div>
              <div className="hidden text-xs font-medium text-slate-400 sm:block">Daily nutrition, made clear</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!user && (
              <button
                onClick={() => setShowAuthModal(true)}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-800"
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
        <div className="mx-auto max-w-4xl px-5 pt-5 sm:px-7">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-emerald-100 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-sm">
            <p className="text-sm font-medium text-slate-600">
              Guest mode is saved on this device only. Sign in to sync history, imports, and insights.
            </p>
            <button onClick={() => setShowAuthModal(true)} className="whitespace-nowrap text-sm font-bold text-emerald-700 hover:text-emerald-800">
              Save it
            </button>
          </div>
        </div>
      )}

      {isAccountSyncing && (
        <div className="mx-auto max-w-4xl px-5 pt-4 sm:px-7">
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-100 bg-white px-4 py-3 shadow-sm">
            <Loader size={16} className="animate-spin text-emerald-500" />
            <div>
              <p className="text-sm font-semibold text-slate-700">
                {isBootstrapping ? 'Loading your tracker shell...' : 'Syncing your nutrition history...'}
              </p>
              <p className="text-xs text-slate-500">
                The app is usable now, and the rest of your data will finish loading in the background.
              </p>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-4xl space-y-5 px-5 pt-7 sm:px-7 sm:pt-9">
        {activeTab === 'home' && (
          showHomeStartupShell ? (
            <HomeStartupShell />
          ) : (
          <>
            <div className="flex items-end justify-between gap-3 px-1">
              <div>
                <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Nutrition overview</p>
                <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">{selectedDateLabel}</h2>
                <p className="mt-1 text-sm font-medium text-slate-400">{selectedDateFullLabel}</p>
              </div>

              <div className="flex gap-1.5">
                <button
                  onClick={() => setCurrentDate((previous) => new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() - 1))}
                  aria-label="Previous day"
                  className="rounded-xl border border-white bg-white/70 p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white"
                >
                  <ChevronLeft size={18} className="text-slate-500" />
                </button>
                <button
                  onClick={() => setCurrentDate(new Date())}
                  className="rounded-xl border border-white bg-white/70 px-3 py-2.5 text-xs font-bold text-slate-600 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white"
                >
                  Today
                </button>
                <button
                  onClick={() => setCurrentDate((previous) => new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() + 1))}
                  aria-label="Next day"
                  className="rounded-xl border border-white bg-white/70 p-2.5 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white"
                >
                  <ChevronRight size={18} className="text-slate-500" />
                </button>
              </div>
            </div>

            <div className="nutrition-card surface-card rounded-[1.75rem] p-5 sm:p-7">
              <div className="relative z-10 mb-7 flex items-center justify-between gap-5">
                <div className="flex items-center gap-5">
                <div className="relative h-24 w-24 flex-shrink-0">
                  <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
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
                    <span className="text-sm font-extrabold leading-none text-slate-800">{Number.isFinite(progressPercentage) ? progressPercentage : 0}%</span>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Calories</div>
                  <div className="mt-1 text-4xl font-extrabold tabular-nums tracking-tight text-slate-900">{totals.calories.toFixed(0)}</div>
                  <div className="text-sm font-medium text-slate-400">of {goals.calories} kcal</div>
                  <div className="mt-2 inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">{remainingCalories.toFixed(0)} remaining</div>
                </div>
                </div>
                <Target className="hidden text-emerald-200 sm:block" size={54} strokeWidth={1.4} />
              </div>

              <div className="relative z-10 rounded-2xl border border-slate-100/80 bg-white/70 p-4 backdrop-blur-sm">
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
            </div>

            <DailyInsightCard
              insight={insight}
              status={insightStatus}
              hasEntries={selectedEntries.length > 0}
              onRefresh={() => refreshDailyInsight(true)}
            />

            <div className="surface-card rounded-[1.75rem] bg-white p-5 sm:p-6">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Log a meal</h3>
                  <p className="text-sm text-slate-400">Describe it naturally—we’ll estimate the macros.</p>
                </div>
                <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 sm:block">AI assisted</span>
              </div>

              <textarea
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isProcessing || isMutationLocked}
                rows={2}
                placeholder="Try: grilled chicken sandwich, 2 eggs with toast, large coffee with oat milk..."
                className="mb-3 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3.5 text-sm text-slate-700 transition-all placeholder:text-slate-400 focus:border-emerald-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />

              <button
                onClick={processInput}
                disabled={isProcessing || isMutationLocked || !inputText.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-emerald-100 transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:bg-slate-200 disabled:from-slate-200 disabled:to-slate-200 disabled:text-slate-400 disabled:shadow-none"
              >
                {isProcessing ? (
                  <>
                    <Loader className="animate-spin" size={16} />
                    {isSavingMeal ? 'Saving meal...' : 'Estimating nutrition...'}
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    Add food
                  </>
                )}
              </button>

              {isMutationLocked && (
                <p className="mt-3 text-xs font-medium text-slate-400">
                  Account data is still syncing, so food logging will unlock in a moment.
                </p>
              )}

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

            <div className="surface-card rounded-[1.75rem] bg-white p-5 sm:p-6">
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
                    {hasTrackedDay ? 'No foods are left on this day.' : 'No meals logged yet. Add your first meal.'}
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
                            disabled={isMutationLocked}
                            className="rounded-lg p-2 text-red-400 opacity-0 transition-all hover:bg-red-50 group-hover:opacity-100"
                          >
                            <Trash2 size={15} />
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => deleteEntry(entry)}
                              disabled={isMutationLocked}
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
          )
        )}

        {activeTab === 'calendar' && (
          <Suspense fallback={<CalendarPanelFallback />}>
            <CalendarView
              currentDate={currentDate}
              setCurrentDate={setCurrentDate}
              calendarView={calendarView}
              setCalendarView={setCalendarView}
              dailyData={dailyData}
              selectedDateKey={selectedDateKey}
              trackedDateKeys={trackedDateKeys}
              setActiveTab={setActiveTab}
            />
          </Suspense>
        )}

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
                  disabled={isPreparingImport || isImporting || isMutationLocked}
                />
                <div
                  className={`flex w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-sm font-semibold transition-all ${
                    isPreparingImport || isImporting || isMutationLocked
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
                  disabled={!importPreview.summary.readyToImport || isImporting || isMutationLocked}
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
          <div className="space-y-4">
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

              <div className="mb-6 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tracked days</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{trackedDateKeys.length}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Logged entries</div>
                  <div className="mt-1 text-2xl font-bold text-slate-800">{trackedEntryCount}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">History health</div>
                  <div className="mt-1 text-sm font-semibold text-slate-700">
                    {trackedEntryCount ? 'History is active' : 'Ready for your first entry'}
                  </div>
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
                disabled={isGeneratingGoals || isMutationLocked}
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

            <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100">
                  <Settings size={18} className="text-slate-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-800">Data tools</h2>
                  <p className="text-sm text-slate-500">
                    Export your nutrition history or permanently clear tracker data when needed.
                  </p>
                </div>
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <button
                  onClick={exportCsv}
                  disabled={!trackedEntryCount || isMutationLocked}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download size={16} />
                  Export CSV
                </button>

                <button
                  onClick={() => {
                    setResetConfirmationText('');
                    setShowResetModal(true);
                  }}
                  disabled={isMutationLocked}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 size={16} />
                  Reset all data
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="mb-1 text-sm font-semibold text-slate-700">CSV export</div>
                  <p className="text-sm leading-6 text-slate-500">
                    Download entry-level history with dates, names, macros, source labels, and timestamps for Excel or Google Sheets.
                  </p>
                  {!trackedEntryCount && (
                    <p className="mt-2 text-xs font-medium text-slate-400">
                      Add or import at least one entry before exporting.
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
                  <div className="mb-1 text-sm font-semibold text-red-700">Permanent reset</div>
                  <p className="text-sm leading-6 text-red-600">
                    This removes meals, daily history, imports, saved dates, insights, and local nutrition caches for this tracker.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <div className="bottom-dock safe-area-pb fixed bottom-0 left-0 right-0 z-40 border-t border-slate-100">
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
              className={`relative flex flex-1 flex-col items-center gap-1 py-3.5 transition-colors ${
                activeTab === tab ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {activeTab === tab && <span className="absolute top-1.5 h-1 w-5 rounded-full bg-emerald-500" />}
              <Icon size={22} strokeWidth={activeTab === tab ? 2.5 : 1.8} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
