import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Plus, Trash2, Target, Loader, User, Calendar, Home, Upload, ZoomIn, ZoomOut, Menu, LogOut, Settings, X, Check, ChevronLeft, ChevronRight, Flame, Beef, Wheat, Droplets } from 'lucide-react';
import Papa from 'papaparse';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── Toast System ────────────────────────────────────────────────────────────
function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl text-sm font-medium toast-enter ${
          t.type === 'success' ? 'bg-emerald-500 text-white' :
          t.type === 'error'   ? 'bg-red-500 text-white' :
                                 'bg-slate-800 text-white'
        }`}>
          {t.type === 'success' && <Check size={15} strokeWidth={2.5} />}
          {t.type === 'error'   && <X size={15} strokeWidth={2.5} />}
          <span>{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="ml-1 opacity-60 hover:opacity-100 transition-opacity">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── Macro Progress Bar ──────────────────────────────────────────────────────
function MacroBar({ label, icon: Icon, current, goal, unit, color, bgColor }) {
  const pct = Math.min((current / goal) * 100, 100);
  const isOver = current > goal;
  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1.5">
        <div className="flex items-center gap-1.5">
          <Icon size={14} className={color} />
          <span className="text-sm font-medium text-slate-600">{label}</span>
        </div>
        <span className={`text-sm font-semibold tabular-nums ${isOver ? 'text-red-500' : 'text-slate-700'}`}>
          {current.toFixed(0)}<span className="text-slate-400 font-normal">/{goal}{unit}</span>
        </span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${isOver ? 'bg-red-400' : bgColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
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

  const [profile, setProfile] = useState({
    username: '', height: '', weight: '', goal: '', workout_frequency: '', additional_info: ''
  });

  const [goals, setGoals] = useState({ calories: 2000, protein: 150, carbs: 250, fats: 65 });
  const [dailyData, setDailyData] = useState({});
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingGoals, setIsGeneratingGoals] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [lastParsed, setLastParsed] = useState(null); // shows what was just logged

  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const dateKey = currentDate.toISOString().split('T')[0];
  const todayEntries = dailyData[dateKey] || [];
  const totals = todayEntries.reduce((acc, e) => ({
    calories: acc.calories + e.calories,
    protein:  acc.protein  + e.protein,
    carbs:    acc.carbs    + e.carbs,
    fats:     acc.fats     + e.fats,
  }), { calories: 0, protein: 0, carbs: 0, fats: 0 });

  useEffect(() => {
    checkUser();
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
      if (session?.user) loadUserData(session.user.id);
    });
    return () => authListener.subscription.unsubscribe();
  }, []);

  const checkUser = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      if (session?.user) await loadUserData(session.user.id);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadUserData = async (userId) => {
    try {
      const { data: profileData } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (profileData) {
        setProfile({
          username: profileData.username || '', height: profileData.height || '',
          weight: profileData.weight || '', goal: profileData.goal || '',
          workout_frequency: profileData.workout_frequency || '',
          additional_info: profileData.additional_info || ''
        });
      }
      const { data: goalsData } = await supabase.from('goals').select('*').eq('user_id', userId).single();
      if (goalsData) setGoals({ calories: goalsData.calories, protein: goalsData.protein, carbs: goalsData.carbs, fats: goalsData.fats });

      const { data: entriesData } = await supabase.from('food_entries').select('*').eq('user_id', userId).order('date', { ascending: false });
      if (entriesData) {
        const organized = {};
        entriesData.forEach(entry => {
          if (!organized[entry.date]) organized[entry.date] = [];
          organized[entry.date].push({
            id: entry.id, name: entry.food_name,
            calories: parseFloat(entry.calories), protein: parseFloat(entry.protein),
            carbs: parseFloat(entry.carbs), fats: parseFloat(entry.fats),
            timestamp: entry.created_at
          });
        });
        setDailyData(organized);
      }
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  const handleAuth = async () => {
    setAuthError('');
    if (!email || !password) { setAuthError('Please fill in all fields'); return; }
    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password, options: { data: { username: email.split('@')[0] } } });
        if (error) throw error;
        addToast('Account created! Check your email to verify.', 'success', 5000);
        setAuthMode('login');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setShowAuthModal(false);
        setEmail(''); setPassword('');
        addToast('Welcome back!', 'success');
      }
    } catch (err) {
      setAuthError(err.message);
    }
  };
const handleGoogleSignIn = async () => {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) addToast(error.message, 'error');
};
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowMenu(false);
    addToast('Logged out', 'info');
  };

  const saveProfile = async () => {
    if (!user) return;
    try {
      await supabase.from('profiles').update({
        height: profile.height, weight: profile.weight, goal: profile.goal,
        workout_frequency: profile.workout_frequency, additional_info: profile.additional_info
      }).eq('id', user.id);
    } catch (err) { console.error(err); }
  };

  const saveGoals = async () => {
    if (!user) return;
    try {
      await supabase.from('goals').update({
        calories: goals.calories, protein: goals.protein, carbs: goals.carbs, fats: goals.fats
      }).eq('user_id', user.id);
    } catch (err) { console.error(err); }
  };

  useEffect(() => {
    if (user && profile.height) { const t = setTimeout(() => saveProfile(), 1000); return () => clearTimeout(t); }
  }, [profile, user]);

  useEffect(() => {
    if (user) { const t = setTimeout(() => saveGoals(), 1000); return () => clearTimeout(t); }
  }, [goals, user]);

  const processInput = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    setLastParsed(null);

    try {
      const response = await fetch('/.netlify/functions/parse-food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to parse food');
      }

      const data = await response.json();
      const parsedItems = data.items;

      if (user) {
        const entries = parsedItems.map(item => ({
          user_id: user.id, date: dateKey,
          food_name: item.name, calories: item.calories,
          protein: item.protein, carbs: item.carbs, fats: item.fats
        }));
        const { data: insertedData } = await supabase.from('food_entries').insert(entries).select();
        if (insertedData) {
          const newEntries = insertedData.map(e => ({
            id: e.id, name: e.food_name,
            calories: parseFloat(e.calories), protein: parseFloat(e.protein),
            carbs: parseFloat(e.carbs), fats: parseFloat(e.fats),
            timestamp: e.created_at
          }));
          setDailyData({ ...dailyData, [dateKey]: [...todayEntries, ...newEntries] });
        }
      } else {
        const newEntries = parsedItems.map(item => ({
          id: Date.now() + Math.random(), name: item.name,
          calories: item.calories, protein: item.protein, carbs: item.carbs, fats: item.fats,
          timestamp: new Date().toISOString()
        }));
        setDailyData({ ...dailyData, [dateKey]: [...todayEntries, ...newEntries] });
      }

      // Show what was logged
      const totalCal = parsedItems.reduce((s, i) => s + i.calories, 0);
      const totalPro = parsedItems.reduce((s, i) => s + i.protein, 0);
      setLastParsed({ items: parsedItems, totalCal, totalPro });
      setInputText('');
      addToast(`Logged ${parsedItems.length > 1 ? parsedItems.length + ' items' : parsedItems[0]?.name} · ${totalCal} cal`, 'success');
    } catch (err) {
      console.error(err);
      addToast(`Error: ${err.message}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteEntry = async (id) => {
    if (user) await supabase.from('food_entries').delete().eq('id', id);
    setDailyData({ ...dailyData, [dateKey]: todayEntries.filter(e => e.id !== id) });
  };

  const generateGoals = async () => {
    if (!profile.height || !profile.weight || !profile.goal) {
      addToast('Fill in height, weight, and goal first', 'error');
      return;
    }
    setIsGeneratingGoals(true);
    try {
      let historicalData = null;
      if (user && Object.keys(dailyData).length > 0) {
        const recentDays = Object.keys(dailyData).slice(-30);
        const avgCalories = recentDays.reduce((sum, key) => {
          return sum + dailyData[key].reduce((acc, e) => acc + e.calories, 0);
        }, 0) / recentDays.length;
        historicalData = { daysTracked: recentDays.length, avgCalories: Math.round(avgCalories) };
      }

      const response = await fetch('/.netlify/functions/generate-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ height: profile.height, weight: profile.weight, goal: profile.goal, workoutFrequency: profile.workout_frequency, historicalData })
      });

      if (!response.ok) { const err = await response.json(); throw new Error(err.error || 'Failed to generate goals'); }

      const result = await response.json();
      setGoals({ calories: result.calories, protein: result.protein, carbs: result.carbs, fats: result.fats });

      if (user) {
        await supabase.from('goals').update({
          calories: result.calories, protein: result.protein, carbs: result.carbs, fats: result.fats
        }).eq('user_id', user.id);
      }

      addToast(`Goals updated — ${result.calories} cal target set`, 'success', 5000);
    } catch (err) {
      console.error(err);
      addToast(`Error: ${err.message}`, 'error');
    } finally {
      setIsGeneratingGoals(false);
    }
  };

  const handleFileImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);

    try {
      const text = await file.text();
      Papa.parse(text, {
        header: true, dynamicTyping: true, skipEmptyLines: true,
        complete: async (results) => {
          const newData = { ...dailyData };
          let importedCount = 0;
          const currentYear = new Date().getFullYear();

          for (const row of results.data) {
            const dateField = Object.keys(row).find(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('day'));
            if (!dateField || !row[dateField]) continue;

            let dateStr = row[dateField];
            if (typeof dateStr === 'string') {
              if (!dateStr.includes('-') && !dateStr.includes('/')) {
                dateStr = `${dateStr} ${currentYear}`;
              }
              const date = new Date(dateStr);
              if (!isNaN(date.getTime())) dateStr = date.toISOString().split('T')[0];
              else continue;
            }

            const hasNameCol = Object.keys(row).some(k => k.toLowerCase().includes('food') || k.toLowerCase().includes('name'));
            let foodName = 'Daily Total';
            if (hasNameCol) {
              const nameField = Object.keys(row).find(k => k.toLowerCase().includes('food') || k.toLowerCase().includes('name'));
              foodName = row[nameField] || 'Imported Food';
            }

            const calories = parseFloat(row.Calories || row.calories || 0);
            const protein  = parseFloat(row['Protein (g)'] || row.Protein || row.protein || 0);
            const carbs    = parseFloat(row['Carbs (g)'] || row.Carbs || row.carbs || 0);
            const fats     = parseFloat(row['Fat (g)'] || row.Fat || row.fats || 0);

            if (user) {
              const { data: inserted } = await supabase.from('food_entries').insert({
                user_id: user.id, date: dateStr, food_name: foodName, calories, protein, carbs, fats
              }).select();
              if (inserted?.[0]) {
                if (!newData[dateStr]) newData[dateStr] = [];
                newData[dateStr].push({ id: inserted[0].id, name: foodName, calories, protein, carbs, fats, timestamp: inserted[0].created_at });
              }
            } else {
              if (!newData[dateStr]) newData[dateStr] = [];
              newData[dateStr].push({ id: Date.now() + Math.random(), name: foodName, calories, protein, carbs, fats, timestamp: new Date().toISOString() });
            }
            importedCount++;
          }

          setDailyData(newData);
          addToast(`Imported ${importedCount} entries${user ? ' · Saved' : ' · Sign in to save'}`, 'success', 5000);
          setActiveTab('calendar');
        }
      });
    } catch (err) {
      console.error(err);
      addToast('Error importing file', 'error');
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); processInput(); }
  };

  // ─── Sub-views ─────────────────────────────────────────────────────────────
  const MonthView = ({ year, month }) => {
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startDOW = firstDay.getDay();
    const days = [...Array(startDOW).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];

    const getDayData = (day) => {
      if (!day) return null;
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return dailyData[key];
    };

    const getDayTotals = (dayData) => {
      if (!dayData?.length) return null;
      return dayData.reduce((acc, e) => ({ calories: acc.calories + e.calories, protein: acc.protein + e.protein, carbs: acc.carbs + e.carbs, fats: acc.fats + e.fats }), { calories: 0, protein: 0, carbs: 0, fats: 0 });
    };

    return (
      <>
        <div className="grid grid-cols-7 mb-2">
          {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
            <div key={d} className="text-center text-xs font-semibold text-slate-400 py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((day, i) => {
            const dayData = getDayData(day);
            const t = getDayTotals(dayData);
            const isToday = day === new Date().getDate() && month === new Date().getMonth() && year === new Date().getFullYear();
            return (
              <div key={i} className={`min-h-16 rounded-xl p-1.5 border transition-colors ${
                !day ? 'border-transparent' :
                isToday ? 'bg-emerald-50 border-emerald-400' :
                t ? 'bg-slate-50 border-slate-200' : 'border-slate-100'
              }`}>
                {day && (
                  <>
                    <div className={`text-xs font-bold mb-1 ${isToday ? 'text-emerald-600' : 'text-slate-600'}`}>{day}</div>
                    {t && (
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-orange-500">{t.calories.toFixed(0)}</div>
                        <div className="text-xs text-rose-400">P{t.protein.toFixed(0)}</div>
                        <div className="text-xs text-blue-400">C{t.carbs.toFixed(0)}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  };

  const YearView = ({ year }) => {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const getMonthStats = (month) => {
      const keys = Object.keys(dailyData).filter(k => { const [y, m] = k.split('-'); return +y === year && +m === month + 1; });
      if (!keys.length) return null;
      const totalCals = keys.reduce((sum, k) => sum + dailyData[k].reduce((acc, e) => acc + e.calories, 0), 0);
      return { daysLogged: keys.length, avgCalories: totalCals / keys.length };
    };
    return (
      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
        {Array.from({ length: 12 }, (_, m) => {
          const stats = getMonthStats(m);
          const isCurrent = m === new Date().getMonth() && year === new Date().getFullYear();
          return (
            <button key={m} onClick={() => { setCurrentDate(new Date(year, m, 1)); setCalendarView('month'); }}
              className={`p-4 rounded-2xl border-2 text-left transition-all hover:shadow-md ${
                isCurrent ? 'bg-emerald-50 border-emerald-400' :
                stats ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-100'
              }`}>
              <div className="font-semibold text-slate-700 mb-1">{monthNames[m]}</div>
              {stats ? (
                <div className="space-y-0.5">
                  <div className="text-xs text-slate-500">{stats.daysLogged} days</div>
                  <div className="text-xs font-semibold text-orange-500">{stats.avgCalories.toFixed(0)} cal/day</div>
                </div>
              ) : <div className="text-xs text-slate-300">No data</div>}
            </button>
          );
        })}
      </div>
    );
  };

  const MultiYearView = ({ startYear }) => {
    const years = Array.from({ length: 12 }, (_, i) => startYear + i - 6);
    const getYearStats = (year) => {
      const keys = Object.keys(dailyData).filter(k => +k.split('-')[0] === year);
      if (!keys.length) return null;
      const totalCals = keys.reduce((sum, k) => sum + dailyData[k].reduce((acc, e) => acc + e.calories, 0), 0);
      return { daysLogged: keys.length, avgCalories: totalCals / keys.length };
    };
    return (
      <div className="grid grid-cols-3 md:grid-cols-4 gap-3">
        {years.map(y => {
          const stats = getYearStats(y);
          const isCurrent = y === new Date().getFullYear();
          return (
            <button key={y} onClick={() => { setCurrentDate(new Date(y, 0, 1)); setCalendarView('year'); }}
              className={`p-5 rounded-2xl border-2 text-left transition-all hover:shadow-md ${
                isCurrent ? 'bg-emerald-50 border-emerald-400' :
                stats ? 'bg-slate-50 border-slate-200' : 'bg-white border-slate-100'
              }`}>
              <div className="font-bold text-lg text-slate-700 mb-1">{y}</div>
              {stats ? (
                <div className="text-xs text-slate-500">{stats.daysLogged} days · <span className="text-orange-500 font-semibold">{stats.avgCalories.toFixed(0)} cal</span></div>
              ) : <div className="text-xs text-slate-300">No data</div>}
            </button>
          );
        })}
      </div>
    );
  };

  const CalView = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const changeMonth = (d) => setCurrentDate(new Date(year, month + d, 1));
    const changeYear  = (d) => setCurrentDate(new Date(year + d, month, 1));
    const zoomIn  = () => { if (calendarView === 'multi-year') setCalendarView('year'); else if (calendarView === 'year') setCalendarView('month'); };
    const zoomOut = () => { if (calendarView === 'month') setCalendarView('year'); else if (calendarView === 'year') setCalendarView('multi-year'); };
    const prev = () => calendarView === 'month' ? changeMonth(-1) : calendarView === 'year' ? changeYear(-1) : changeYear(-6);
    const next = () => calendarView === 'month' ? changeMonth(1)  : calendarView === 'year' ? changeYear(1)  : changeYear(6);

    return (
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
        <div className="flex justify-between items-center mb-6">
          <button onClick={prev} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <ChevronLeft size={20} className="text-slate-600" />
          </button>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">
              {calendarView === 'month' && `${monthNames[month]} ${year}`}
              {calendarView === 'year' && year}
              {calendarView === 'multi-year' && `${year - 6} – ${year + 5}`}
            </h2>
            <div className="flex gap-1.5">
              <button onClick={zoomOut} disabled={calendarView === 'multi-year'} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
                <ZoomOut size={16} className="text-slate-500" />
              </button>
              <button onClick={zoomIn} disabled={calendarView === 'month'} className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors">
                <ZoomIn size={16} className="text-slate-500" />
              </button>
            </div>
          </div>
          <button onClick={next} className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <ChevronRight size={20} className="text-slate-600" />
          </button>
        </div>
        {calendarView === 'month'      && <MonthView year={year} month={month} />}
        {calendarView === 'year'       && <YearView year={year} />}
        {calendarView === 'multi-year' && <MultiYearView startYear={year} />}
      </div>
    );
  };

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <Loader className="animate-spin text-emerald-500" size={36} />
    </div>
  );

  const isToday = dateKey === new Date().toISOString().split('T')[0];

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <ToastContainer toasts={toasts} removeToast={removeToast} />

{/* Auth Modal */}
{showAuthModal && (
  <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-5 z-50">
    <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-sm relative">
      <button onClick={() => setShowAuthModal(false)} className="absolute top-5 right-5 p-1.5 rounded-xl hover:bg-slate-100 transition-colors">
        <X size={20} className="text-slate-400" />
      </button>

      <h1 className="text-2xl font-bold text-slate-800 mb-1">
        {authMode === 'signup' ? 'Create account' : 'Welcome back'}
      </h1>
      <p className="text-sm text-slate-500 mb-6">
        {authMode === 'signup' ? 'Start saving your nutrition data' : 'Log in to your account'}
      </p>

      <div className="flex gap-2 mb-6 p-1 bg-slate-100 rounded-xl">
        {['login','signup'].map(m => (
          <button key={m} onClick={() => setAuthMode(m)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
            authMode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
          }`}>{m === 'login' ? 'Log in' : 'Sign up'}</button>
        ))}
      </div>

      <div className="space-y-3 mb-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAuth()}
            placeholder="you@example.com"
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAuth()}
            placeholder="••••••••"
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all" />
        </div>
      </div>

      {authError && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-4">
          <p className="text-xs text-red-600">{authError}</p>
        </div>
      )}

      <button onClick={handleAuth} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl font-semibold text-sm transition-colors mb-4">
        {authMode === 'login' ? 'Log in' : 'Create account'}
      </button>

      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400">or</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      <button onClick={handleGoogleSignIn}
        className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
        <svg width="16" height="16" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        Continue with Google
      </button>

    </div>
  </div>
)}

      {/* Top Bar */}
      <div className="bg-white border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-2xl mx-auto px-5 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Flame size={14} className="text-white" />
            </div>
            <span className="text-lg font-bold text-slate-800">FitTrack</span>
          </div>

          <div className="flex items-center gap-3">
            {!user && (
              <button onClick={() => setShowAuthModal(true)}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-semibold transition-colors">
                Sign in
              </button>
            )}
            {user && (
              <div className="relative">
                <button onClick={() => setShowMenu(!showMenu)} className="flex items-center gap-2 p-2 rounded-xl hover:bg-slate-100 transition-colors">
                  <div className="w-7 h-7 bg-emerald-100 rounded-lg flex items-center justify-center">
                    <span className="text-xs font-bold text-emerald-600">{user.email?.[0]?.toUpperCase()}</span>
                  </div>
                </button>
                {showMenu && (
                  <div className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 z-50">
                    <div className="px-4 py-2 border-b border-slate-50 mb-1">
                      <p className="text-xs text-slate-400 truncate">{user.email}</p>
                    </div>
                    {[
                      { icon: Upload, label: 'Import data', tab: 'import' },
                      { icon: Settings, label: 'Profile & Goals', tab: 'profile' },
                    ].map(({ icon: Icon, label, tab }) => (
                      <button key={tab} onClick={() => { setActiveTab(tab); setShowMenu(false); }}
                        className="w-full px-4 py-2.5 text-left hover:bg-slate-50 flex items-center gap-2.5 text-sm text-slate-700 transition-colors">
                        <Icon size={16} className="text-slate-400" />
                        {label}
                      </button>
                    ))}
                    <div className="border-t border-slate-100 mt-1 pt-1">
                      <button onClick={handleLogout}
                        className="w-full px-4 py-2.5 text-left hover:bg-red-50 flex items-center gap-2.5 text-sm text-red-500 transition-colors">
                        <LogOut size={16} />
                        Log out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Guest banner */}
      {!user && (
        <div className="max-w-2xl mx-auto px-5 pt-4">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-amber-700">Guest mode — data resets on refresh</p>
            <button onClick={() => setShowAuthModal(true)} className="text-sm font-semibold text-amber-700 underline">Save it →</button>
          </div>
        </div>
      )}

      {/* Page content */}
      <div className="max-w-2xl mx-auto px-5 pt-5 space-y-4">

        {/* ── HOME ── */}
        {activeTab === 'home' && (
          <>
            {/* Date header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-800">
                  {isToday ? "Today" : currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                </h2>
                <p className="text-sm text-slate-400">{currentDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() - 1); return n; })}
                  className="p-2 rounded-xl hover:bg-white border border-slate-200 transition-colors">
                  <ChevronLeft size={18} className="text-slate-500" />
                </button>
                <button onClick={() => setCurrentDate(new Date())}
                  className="px-3 py-2 rounded-xl text-xs font-semibold hover:bg-white border border-slate-200 transition-colors text-slate-500">
                  Today
                </button>
                <button onClick={() => setCurrentDate(d => { const n = new Date(d); n.setDate(n.getDate() + 1); return n; })}
                  className="p-2 rounded-xl hover:bg-white border border-slate-200 transition-colors">
                  <ChevronRight size={18} className="text-slate-500" />
                </button>
              </div>
            </div>

            {/* Calorie ring + macros */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
              <div className="flex items-center gap-6 mb-6">
                {/* Ring */}
                <div className="relative flex-shrink-0 w-20 h-20">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="30" fill="none" stroke="#f1f5f9" strokeWidth="8" />
                    <circle cx="40" cy="40" r="30" fill="none" stroke="#10b981" strokeWidth="8"
                      strokeDasharray={`${2 * Math.PI * 30}`}
                      strokeDashoffset={`${2 * Math.PI * 30 * (1 - Math.min(totals.calories / goals.calories, 1))}`}
                      strokeLinecap="round" className="transition-all duration-700" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs font-bold text-slate-700 leading-none">{Math.round((totals.calories / goals.calories) * 100)}%</span>
                  </div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-slate-800 tabular-nums">{totals.calories.toFixed(0)}</div>
                  <div className="text-sm text-slate-400">of {goals.calories} kcal</div>
                  <div className="text-xs text-emerald-600 font-medium mt-0.5">
                    {Math.max(0, goals.calories - totals.calories).toFixed(0)} remaining
                  </div>
                </div>
              </div>

              <MacroBar label="Protein"  icon={Beef}    current={totals.protein} goal={goals.protein} unit="g" color="text-rose-400"   bgColor="bg-rose-400" />
              <MacroBar label="Carbs"    icon={Wheat}   current={totals.carbs}   goal={goals.carbs}   unit="g" color="text-blue-400"   bgColor="bg-blue-400" />
              <MacroBar label="Fats"     icon={Droplets} current={totals.fats}   goal={goals.fats}    unit="g" color="text-amber-400"  bgColor="bg-amber-400" />
            </div>

            {/* AI Food Input */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
              <h3 className="text-base font-semibold text-slate-700 mb-3">Log food</h3>
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isProcessing}
                placeholder="e.g. grilled chicken sandwich, 2 eggs with toast, large coffee with oat milk..."
                rows={2}
                className="w-full px-4 py-3 border border-slate-200 rounded-2xl text-sm text-slate-700 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent resize-none transition-all mb-3"
              />
              <button onClick={processInput} disabled={isProcessing || !inputText.trim()}
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400 text-white py-3 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2">
                {isProcessing ? <><Loader className="animate-spin" size={16} />Estimating...</> : <><Plus size={16} />Add food</>}
              </button>

              {/* Post-parse success state */}
              {lastParsed && (
                <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Check size={14} className="text-emerald-500" />
                    <span className="text-xs font-semibold text-emerald-600">Logged successfully</span>
                  </div>
                  <div className="space-y-1.5">
                    {lastParsed.items.map((item, i) => (
                      <div key={i} className="flex justify-between items-center">
                        <span className="text-xs text-slate-600 font-medium">{item.name}</span>
                        <div className="flex gap-2 text-xs text-slate-400">
                          <span className="text-orange-500 font-semibold">{item.calories} cal</span>
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

            {/* Food log */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-semibold text-slate-700">Food log</h3>
                <span className="text-xs text-slate-400 bg-slate-100 rounded-full px-2.5 py-1">{todayEntries.length} items</span>
              </div>
              {todayEntries.length === 0 ? (
                <div className="text-center py-10">
                  <div className="text-3xl mb-2">🥗</div>
                  <p className="text-sm text-slate-400">Nothing logged yet — add your first meal above</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 transition-colors group">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-slate-700 truncate">{entry.name}</h4>
                        <div className="flex gap-2.5 mt-0.5">
                          <span className="text-xs font-semibold text-orange-500">{entry.calories} cal</span>
                          <span className="text-xs text-slate-400">P{entry.protein}g · C{entry.carbs}g · F{entry.fats}g</span>
                        </div>
                      </div>
                      <button onClick={() => deleteEntry(entry.id)}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-red-400 transition-all">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── CALENDAR ── */}
        {activeTab === 'calendar' && <CalView />}

        {/* ── IMPORT ── */}
        {activeTab === 'import' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-purple-100 rounded-2xl flex items-center justify-center">
                <Upload size={18} className="text-purple-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Import data</h2>
                <p className="text-xs text-slate-400">Upload a CSV file to import past logs</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-2xl p-4 mb-4 text-sm text-slate-600 space-y-1">
              <p className="font-semibold text-slate-700 mb-2">Supported CSV columns:</p>
              <p>• Date · Calories · Protein (g) · Carbs (g) · Fat (g)</p>
              <p>• Date formats: "March 24", "2025-03-24", "3/24/2025"</p>
              <p>• Optional: Food / Name column</p>
            </div>

            <label className="cursor-pointer block">
              <input type="file" accept=".csv" onChange={handleFileImport} className="hidden" disabled={isImporting} />
              <div className={`w-full flex items-center justify-center gap-2.5 px-6 py-4 rounded-2xl font-semibold text-sm transition-all ${
                isImporting ? 'bg-slate-100 text-slate-400' : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }`}>
                {isImporting ? <><Loader className="animate-spin" size={18} />Importing...</> : <><Upload size={18} />Choose CSV file</>}
              </div>
            </label>
          </div>
        )}

        {/* ── PROFILE ── */}
        {activeTab === 'profile' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-indigo-100 rounded-2xl flex items-center justify-center">
                <User size={18} className="text-indigo-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">Profile & Goals</h2>
                <p className="text-xs text-slate-400">Saved automatically</p>
              </div>
            </div>

            <div className="space-y-3 mb-6">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Height', key: 'height', placeholder: 'e.g. 6ft or 183cm' },
                  { label: 'Weight', key: 'weight', placeholder: 'e.g. 180 lbs' },
                ].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">{label}</label>
                    <input type="text" value={profile[key]} onChange={e => setProfile({ ...profile, [key]: e.target.value })}
                      placeholder={placeholder}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all" />
                  </div>
                ))}
              </div>
              {[
                { label: 'Fitness Goal', key: 'goal', placeholder: 'e.g. lose weight and gain muscle' },
                { label: 'Workout Frequency', key: 'workout_frequency', placeholder: 'e.g. 4–6 times a week' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">{label}</label>
                  <input type="text" value={profile[key]} onChange={e => setProfile({ ...profile, [key]: e.target.value })}
                    placeholder={placeholder}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wide">Additional info</label>
                <textarea value={profile.additional_info} onChange={e => setProfile({ ...profile, additional_info: e.target.value })}
                  placeholder="Dietary restrictions, allergies, preferences..."
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent resize-none transition-all min-h-20" />
              </div>
            </div>

            <button onClick={generateGoals} disabled={isGeneratingGoals}
              className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-200 disabled:text-slate-400 text-white py-3 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2 mb-5">
              {isGeneratingGoals ? <><Loader className="animate-spin" size={16} />Generating...</> : <><Target size={16} />Generate goals with AI</>}
            </button>

            {/* Current goals */}
            <div className="bg-slate-50 rounded-2xl p-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Current goals</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Calories', val: goals.calories, unit: '', color: 'text-orange-500' },
                  { label: 'Protein', val: goals.protein, unit: 'g', color: 'text-rose-500' },
                  { label: 'Carbs', val: goals.carbs, unit: 'g', color: 'text-blue-500' },
                  { label: 'Fats', val: goals.fats, unit: 'g', color: 'text-amber-500' },
                ].map(({ label, val, unit, color }) => (
                  <div key={label} className="bg-white rounded-xl p-3">
                    <div className="text-xs text-slate-400 mb-0.5">{label}</div>
                    <div className={`text-xl font-bold ${color}`}>{val}<span className="text-sm font-normal text-slate-400">{unit}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-slate-100 safe-area-pb">
        <div className="max-w-2xl mx-auto flex">
          {[
            { tab: 'home', icon: Home, label: 'Today' },
            { tab: 'calendar', icon: Calendar, label: 'Calendar' },
            { tab: 'profile', icon: User, label: 'Profile' },
          ].map(({ tab, icon: Icon, label }) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3.5 flex flex-col items-center gap-1 transition-colors ${
                activeTab === tab ? 'text-emerald-500' : 'text-slate-400 hover:text-slate-600'
              }`}>
              <Icon size={22} strokeWidth={activeTab === tab ? 2.5 : 1.8} />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
