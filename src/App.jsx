import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Plus, Trash2, Target, Loader, User, Calendar, TrendingUp, Home, Upload, ZoomIn, ZoomOut, Menu, LogOut, Settings, X } from 'lucide-react';
import Papa from 'papaparse';

// Initialize Supabase
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default function FitnessTracker() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState('signup');
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

  const dateKey = currentDate.toISOString().split('T')[0];
  const todayEntries = dailyData[dateKey] || [];

  const totals = todayEntries.reduce((acc, entry) => ({
    calories: acc.calories + entry.calories,
    protein: acc.protein + entry.protein,
    carbs: acc.carbs + entry.carbs,
    fats: acc.fats + entry.fats
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
    } catch (error) {
      console.error('Error:', error);
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
      if (goalsData) {
        setGoals({
          calories: goalsData.calories, protein: goalsData.protein,
          carbs: goalsData.carbs, fats: goalsData.fats
        });
      }

      const { data: entriesData } = await supabase.from('food_entries').select('*')
        .eq('user_id', userId).order('date', { ascending: false });
      
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
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    if (!email || !password) {
      setAuthError('Please fill in all fields');
      return;
    }

    try {
      if (authMode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { username: email.split('@')[0] } }
        });
        if (error) throw error;
        alert('Account created! Check your email to verify.');
        setAuthMode('login');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        setShowAuthModal(false);
        setEmail('');
        setPassword('');
      }
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowMenu(false);
  };

  const saveProfile = async () => {
    if (!user) return;
    try {
      await supabase.from('profiles').update({
        height: profile.height, weight: profile.weight, goal: profile.goal,
        workout_frequency: profile.workout_frequency, additional_info: profile.additional_info
      }).eq('id', user.id);
    } catch (error) {
      console.error('Error saving profile:', error);
    }
  };

  const saveGoals = async () => {
    if (!user) return;
    try {
      await supabase.from('goals').update({
        calories: goals.calories, protein: goals.protein,
        carbs: goals.carbs, fats: goals.fats
      }).eq('user_id', user.id);
    } catch (error) {
      console.error('Error saving goals:', error);
    }
  };

  useEffect(() => {
    if (user && profile.height) {
      const timer = setTimeout(() => saveProfile(), 1000);
      return () => clearTimeout(timer);
    }
  }, [profile, user]);

  useEffect(() => {
    if (user) {
      const timer = setTimeout(() => saveGoals(), 1000);
      return () => clearTimeout(timer);
    }
  }, [goals, user]);

  // ✅ UPDATED: Calls Netlify function instead of Anthropic directly
  const processInput = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    
    try {
      // Call YOUR serverless function instead of Anthropic directly
      const response = await fetch('/.netlify/functions/parse-food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to parse food');
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
          const newEntries = insertedData.map(entry => ({
            id: entry.id, name: entry.food_name,
            calories: parseFloat(entry.calories), protein: parseFloat(entry.protein),
            carbs: parseFloat(entry.carbs), fats: parseFloat(entry.fats),
            timestamp: entry.created_at
          }));
          setDailyData({ ...dailyData, [dateKey]: [...todayEntries, ...newEntries] });
        }
      } else {
        const newEntries = parsedItems.map(item => ({
          id: Date.now() + Math.random(),
          name: item.name, calories: item.calories,
          protein: item.protein, carbs: item.carbs, fats: item.fats,
          timestamp: new Date().toISOString()
        }));
        setDailyData({ ...dailyData, [dateKey]: [...todayEntries, ...newEntries] });
      }
      
      setInputText('');
    } catch (error) {
      console.error('Error:', error);
      alert(`Error: ${error.message}\n\nMake sure you deployed the Netlify functions!`);
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteEntry = async (id) => {
    if (user) {
      await supabase.from('food_entries').delete().eq('id', id);
    }
    setDailyData({ ...dailyData, [dateKey]: todayEntries.filter(entry => entry.id !== id) });
  };

  // ✅ UPDATED: Calls Netlify function instead of Anthropic directly
  const generateGoals = async () => {
    if (!profile.height || !profile.weight || !profile.goal) {
      alert('Please fill in height, weight, and goal first!');
      return;
    }
    
    setIsGeneratingGoals(true);
    
    try {
      let historicalData = null;
      if (user && Object.keys(dailyData).length > 0) {
        const recentDays = Object.keys(dailyData).slice(-30);
        const avgCalories = recentDays.reduce((sum, key) => {
          const dayTotal = dailyData[key].reduce((acc, e) => acc + e.calories, 0);
          return sum + dayTotal;
        }, 0) / recentDays.length;
        
        historicalData = {
          daysTracked: recentDays.length,
          avgCalories: Math.round(avgCalories)
        };
      }
      
      // Call YOUR serverless function
      const response = await fetch('/.netlify/functions/generate-goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          height: profile.height,
          weight: profile.weight,
          goal: profile.goal,
          workoutFrequency: profile.workout_frequency,
          historicalData
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate goals');
      }

      const result = await response.json();
      
      setGoals({
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fats: result.fats
      });
      
      if (user) {
        await supabase.from('goals').update({
          calories: result.calories,
          protein: result.protein,
          carbs: result.carbs,
          fats: result.fats
        }).eq('user_id', user.id);
      }
      
      alert(`Goals updated!${user ? ' (Saved)' : ''}\n\n${result.explanation}`);
    } catch (error) {
      console.error('Error:', error);
      alert(`Error: ${error.message}`);
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
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const newData = { ...dailyData };
          let importedCount = 0;
          
          for (const row of results.data) {
            const dateField = Object.keys(row).find(k => 
              k.toLowerCase().includes('date') || k.toLowerCase().includes('day')
            );
            
            if (!dateField || !row[dateField]) continue;
            
            let dateStr = row[dateField];
            if (typeof dateStr === 'string') {
              if (!dateStr.includes('-') && !dateStr.includes('/')) {
                dateStr = `${dateStr} 2025`;
              }
              const date = new Date(dateStr);
              if (!isNaN(date.getTime())) {
                dateStr = date.toISOString().split('T')[0];
              } else {
                continue;
              }
            }
            
            const hasNameColumn = Object.keys(row).some(k => 
              k.toLowerCase().includes('food') || k.toLowerCase().includes('name')
            );
            
            let foodName = 'Daily Total';
            if (hasNameColumn) {
              const nameField = Object.keys(row).find(k => 
                k.toLowerCase().includes('food') || k.toLowerCase().includes('name')
              );
              foodName = row[nameField] || 'Imported Food';
            }
            
            const calories = parseFloat(row.Calories || row.calories || 0);
            const protein = parseFloat(row['Protein (g)'] || row.Protein || row.protein || 0);
            const carbs = parseFloat(row['Carbs (g)'] || row.Carbs || row.carbs || 0);
            const fats = parseFloat(row['Fat (g)'] || row.Fat || row.fats || 0);
            
            if (user) {
              const { data: inserted } = await supabase.from('food_entries').insert({
                user_id: user.id, date: dateStr, food_name: foodName,
                calories, protein, carbs, fats
              }).select();
              
              if (inserted && inserted[0]) {
                if (!newData[dateStr]) newData[dateStr] = [];
                newData[dateStr].push({
                  id: inserted[0].id, name: foodName, calories, protein, carbs, fats,
                  timestamp: inserted[0].created_at
                });
              }
            } else {
              if (!newData[dateStr]) newData[dateStr] = [];
              newData[dateStr].push({
                id: Date.now() + Math.random(), name: foodName,
                calories, protein, carbs, fats, timestamp: new Date().toISOString()
              });
            }
            
            importedCount++;
          }
          
          setDailyData(newData);
          alert(`Imported ${importedCount} entries!${user ? ' Saved to account.' : ' Create account to save!'}`);
          setActiveTab('calendar');
        }
      });
    } catch (error) {
      console.error('Import error:', error);
      alert('Error importing file.');
    } finally {
      setIsImporting(false);
      event.target.value = '';
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      processInput();
    }
  };

  const ProgressBar = ({ label, current, goal, unit, color }) => {
    const percentage = Math.min((current / goal) * 100, 100);
    const isOver = current > goal;
    
    return (
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-sm font-semibold text-gray-700">{label}</span>
          <span className={`text-sm font-bold ${isOver ? 'text-red-600' : 'text-gray-700'}`}>
            {current.toFixed(0)} / {goal}{unit}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-5">
          <div className={`h-5 rounded-full transition-all duration-300 flex items-center justify-end pr-2 ${color}`}
            style={{ width: `${percentage}%` }}>
            {percentage > 10 && (
              <span className="text-xs font-bold text-white">{percentage.toFixed(0)}%</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const MonthView = ({ year, month }) => {
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    for (let i = 0; i < startingDayOfWeek; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(i);
    
    const getDayData = (day) => {
      if (!day) return null;
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return dailyData[key];
    };
    
    const getDayTotals = (dayData) => {
      if (!dayData || dayData.length === 0) return null;
      return dayData.reduce((acc, entry) => ({
        calories: acc.calories + entry.calories, protein: acc.protein + entry.protein,
        carbs: acc.carbs + entry.carbs, fats: acc.fats + entry.fats
      }), { calories: 0, protein: 0, carbs: 0, fats: 0 });
    };
    
    return (
      <>
        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="text-center font-bold text-gray-700 py-2">{day}</div>
          ))}
        </div>
        
        <div className="grid grid-cols-7 gap-2">
          {days.map((day, index) => {
            const dayData = getDayData(day);
            const totals = getDayTotals(dayData);
            const hasData = totals !== null;
            const isToday = day === new Date().getDate() && 
                           month === new Date().getMonth() && 
                           year === new Date().getFullYear();
            
            return (
              <div key={index}
                className={`min-h-24 border rounded-lg p-2 ${
                  !day ? 'bg-gray-50' : 
                  isToday ? 'bg-indigo-100 border-indigo-600' :
                  hasData ? 'bg-green-50 border-green-300' : 'bg-white'
                }`}>
                {day && (
                  <>
                    <div className="font-bold text-gray-700 mb-1">{day}</div>
                    {hasData && (
                      <div className="text-xs space-y-0.5">
                        <div className="text-orange-600 font-semibold">{totals.calories.toFixed(0)} cal</div>
                        <div className="text-red-600">P: {totals.protein.toFixed(0)}g</div>
                        <div className="text-blue-600">C: {totals.carbs.toFixed(0)}g</div>
                        <div className="text-yellow-600">F: {totals.fats.toFixed(0)}g</div>
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
    const months = Array.from({ length: 12 }, (_, i) => i);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const getMonthStats = (month) => {
      const monthDays = Object.keys(dailyData).filter(key => {
        const [y, m] = key.split('-');
        return parseInt(y) === year && parseInt(m) === month + 1;
      });
      
      if (monthDays.length === 0) return null;
      
      const totalCals = monthDays.reduce((sum, key) => {
        const dayTotal = dailyData[key].reduce((acc, e) => acc + e.calories, 0);
        return sum + dayTotal;
      }, 0);
      
      return {
        daysLogged: monthDays.length,
        avgCalories: totalCals / monthDays.length
      };
    };
    
    return (
      <div className="grid grid-cols-3 md:grid-cols-4 gap-4">
        {months.map(month => {
          const stats = getMonthStats(month);
          const hasData = stats !== null;
          const isCurrentMonth = month === new Date().getMonth() && year === new Date().getFullYear();
          
          return (
            <button key={month}
              onClick={() => {
                setCurrentDate(new Date(year, month, 1));
                setCalendarView('month');
              }}
              className={`p-4 rounded-lg border-2 transition-all hover:shadow-md ${
                isCurrentMonth ? 'bg-indigo-100 border-indigo-600' :
                hasData ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'
              }`}>
              <div className="font-bold text-gray-800 mb-2">{monthNames[month]}</div>
              {hasData && (
                <div className="text-xs space-y-1">
                  <div className="text-gray-600">{stats.daysLogged} days</div>
                  <div className="text-orange-600 font-semibold">{stats.avgCalories.toFixed(0)} cal/day</div>
                </div>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const MultiYearView = ({ startYear }) => {
    const years = Array.from({ length: 12 }, (_, i) => startYear + i - 6);
    
    const getYearStats = (year) => {
      const yearDays = Object.keys(dailyData).filter(key => {
        const [y] = key.split('-');
        return parseInt(y) === year;
      });
      
      if (yearDays.length === 0) return null;
      
      const totalCals = yearDays.reduce((sum, key) => {
        const dayTotal = dailyData[key].reduce((acc, e) => acc + e.calories, 0);
        return sum + dayTotal;
      }, 0);
      
      return {
        daysLogged: yearDays.length,
        avgCalories: totalCals / yearDays.length
      };
    };
    
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {years.map(year => {
          const stats = getYearStats(year);
          const hasData = stats !== null;
          const isCurrentYear = year === new Date().getFullYear();
          
          return (
            <button key={year}
              onClick={() => {
                setCurrentDate(new Date(year, 0, 1));
                setCalendarView('year');
              }}
              className={`p-6 rounded-lg border-2 transition-all hover:shadow-md ${
                isCurrentYear ? 'bg-indigo-100 border-indigo-600' :
                hasData ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'
              }`}>
              <div className="font-bold text-xl text-gray-800 mb-2">{year}</div>
              {hasData && (
                <div className="text-sm space-y-1">
                  <div className="text-gray-600">{stats.daysLogged} days</div>
                  <div className="text-orange-600 font-semibold">{stats.avgCalories.toFixed(0)} cal/day</div>
                </div>
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
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    
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
    
    return (
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <button 
            onClick={() => calendarView === 'month' ? changeMonth(-1) : calendarView === 'year' ? changeYear(-1) : changeYear(-6)} 
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            Previous
          </button>
          
          <div className="flex items-center gap-4">
            <h2 className="text-2xl font-bold">
              {calendarView === 'month' && `${monthNames[month]} ${year}`}
              {calendarView === 'year' && year}
              {calendarView === 'multi-year' && `${year - 6} - ${year + 5}`}
            </h2>
            
            <div className="flex gap-2">
              <button onClick={zoomOut} disabled={calendarView === 'multi-year'}
                className="p-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50">
                <ZoomOut size={20} />
              </button>
              <button onClick={zoomIn} disabled={calendarView === 'month'}
                className="p-2 bg-gray-200 rounded-lg hover:bg-gray-300 disabled:opacity-50">
                <ZoomIn size={20} />
              </button>
            </div>
          </div>
          
          <button 
            onClick={() => calendarView === 'month' ? changeMonth(1) : calendarView === 'year' ? changeYear(1) : changeYear(6)} 
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            Next
          </button>
        </div>
        
        {calendarView === 'month' && <MonthView year={year} month={month} />}
        {calendarView === 'year' && <YearView year={year} />}
        {calendarView === 'multi-year' && <MultiYearView startYear={year} />}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <Loader className="animate-spin text-indigo-600" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 pb-20">
      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-6 z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md relative">
            <button onClick={() => setShowAuthModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
              <X size={24} />
            </button>

            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-800 mb-2">
                {authMode === 'signup' ? 'Create Account' : 'Welcome Back'}
              </h1>
              <p className="text-gray-600">
                {authMode === 'signup' ? 'Save your data permanently' : 'Log in to continue'}
              </p>
            </div>

            <div className="flex gap-2 mb-6">
              <button onClick={() => setAuthMode('login')}
                className={`flex-1 py-2 rounded-lg font-semibold transition-colors ${
                  authMode === 'login' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}>
                Login
              </button>
              <button onClick={() => setAuthMode('signup')}
                className={`flex-1 py-2 rounded-lg font-semibold transition-colors ${
                  authMode === 'signup' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700'
                }`}>
                Sign Up
              </button>
            </div>

            <form onSubmit={handleAuth} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
              </div>

              {authError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-600">{authError}</p>
                </div>
              )}

              <button type="submit"
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700">
                {authMode === 'login' ? 'Login' : 'Create Account'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <div className="bg-white shadow-md">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-indigo-600">FitTrack AI</h1>
          
          <div className="flex items-center gap-4">
            {!user && (
              <button onClick={() => setShowAuthModal(true)}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-semibold">
                Login / Sign Up
              </button>
            )}
            
            {user && (
              <>
                <span className="text-gray-700 text-sm hidden md:block">
                  {user.email?.split('@')[0]}
                </span>
                <div className="relative">
                  <button onClick={() => setShowMenu(!showMenu)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                    <Menu size={24} />
                  </button>
                  
                  {showMenu && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-50">
                      <button onClick={() => { setActiveTab('import'); setShowMenu(false); }}
                        className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2">
                        <Upload size={18} />
                        Import Data
                      </button>
                      <button onClick={() => { setActiveTab('profile'); setShowMenu(false); }}
                        className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2">
                        <Settings size={18} />
                        Settings
                      </button>
                      <hr className="my-2" />
                      <button onClick={handleLogout}
                        className="w-full px-4 py-2 text-left hover:bg-gray-100 flex items-center gap-2 text-red-600">
                        <LogOut size={18} />
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {!user && (
        <div className="max-w-4xl mx-auto mt-4 px-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-sm text-yellow-800">
              <strong>Guest Mode:</strong> Your data will be lost on refresh.{' '}
              <button onClick={() => setShowAuthModal(true)}
                className="underline font-semibold hover:text-yellow-900">
                Create account
              </button>{' '}to save permanently!
            </p>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto p-6">
        {activeTab === 'home' && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Target className="text-indigo-600" />
              Today's Tracking
            </h2>

            <div className="mb-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">Progress</h3>
              <ProgressBar label="Calories" current={totals.calories} goal={goals.calories} unit="" 
                color="bg-gradient-to-r from-orange-400 to-orange-600" />
              <ProgressBar label="Protein" current={totals.protein} goal={goals.protein} unit="g" 
                color="bg-gradient-to-r from-red-400 to-red-600" />
              <ProgressBar label="Carbs" current={totals.carbs} goal={goals.carbs} unit="g" 
                color="bg-gradient-to-r from-blue-400 to-blue-600" />
              <ProgressBar label="Fats" current={totals.fats} goal={goals.fats} unit="g" 
                color="bg-gradient-to-r from-yellow-400 to-yellow-600" />
            </div>

            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-6 mb-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2">Add Food with AI</h3>
              <textarea value={inputText} onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress} disabled={isProcessing}
                placeholder="protein shake 30g protein 180 cal, jr chicken, 300g rice with vegetables..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 mb-3 min-h-20" />
              <button onClick={processInput} disabled={isProcessing || !inputText.trim()}
                className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:bg-gray-400">
                {isProcessing ? <><Loader className="animate-spin" size={20} />Processing...</> : <><Plus size={20} />Add Food</>}
              </button>
            </div>

            <div>
              <h3 className="text-xl font-bold text-gray-800 mb-4">Food Log</h3>
              {todayEntries.length === 0 ? (
                <p className="text-gray-500 text-center py-8 bg-gray-50 rounded-lg">No entries yet today!</p>
              ) : (
                <div className="space-y-2">
                  {todayEntries.map((entry) => (
                    <div key={entry.id} className="bg-gray-50 rounded-lg p-3 flex justify-between items-center hover:bg-gray-100">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-800">{entry.name}</h4>
                        <div className="text-xs text-gray-600 mt-1 flex gap-3">
                          <span className="font-medium text-orange-600">{entry.calories} cal</span>
                          <span className="text-red-600">P: {entry.protein}g</span>
                          <span className="text-blue-600">C: {entry.carbs}g</span>
                          <span className="text-yellow-600">F: {entry.fats}g</span>
                        </div>
                      </div>
                      <button onClick={() => deleteEntry(entry.id)} className="text-red-500 hover:text-red-700 p-2">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="bg-white rounded-2xl shadow-xl">
            <CalendarView />
          </div>
        )}

        {activeTab === 'import' && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Upload className="text-indigo-600" />
              Import Data
            </h2>

            <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-3">Upload CSV File</h3>
              <p className="text-gray-600 mb-4">
                Import your previous nutrition logs from a CSV file.
              </p>
              
              <div className="bg-white rounded-lg p-4 mb-4">
                <h4 className="font-semibold text-gray-800 mb-2">Supported Formats:</h4>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>• Date formats: "March 24", "2025-03-24", "3/24/2025"</li>
                  <li>• Required: Date, Calories, Protein, Carbs, Fats</li>
                  <li>• Optional: Food/Meal name</li>
                </ul>
              </div>

              <label className="cursor-pointer">
                <input type="file" accept=".csv" onChange={handleFileImport}
                  className="hidden" disabled={isImporting} />
                <div className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                  {isImporting ? (
                    <><Loader className="animate-spin" size={24} /><span>Importing...</span></>
                  ) : (
                    <><Upload size={24} /><span className="font-semibold">Choose CSV File</span></>
                  )}
                </div>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'profile' && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-3xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <User className="text-indigo-600" />
              Your Profile
            </h2>

            <div className="space-y-4 mb-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Height</label>
                  <input type="text" value={profile.height}
                    onChange={(e) => setProfile({...profile, height: e.target.value})}
                    placeholder="e.g., 6ft or 183cm"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Weight</label>
                  <input type="text" value={profile.weight}
                    onChange={(e) => setProfile({...profile, weight: e.target.value})}
                    placeholder="e.g., 180 lbs"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fitness Goal</label>
                <input type="text" value={profile.goal}
                  onChange={(e) => setProfile({...profile, goal: e.target.value})}
                  placeholder="e.g., lose weight and gain muscle"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Workout Frequency</label>
                <input type="text" value={profile.workout_frequency}
                  onChange={(e) => setProfile({...profile, workout_frequency: e.target.value})}
                  placeholder="e.g., 4-6 times a week"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500" />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Additional Info</label>
                <textarea value={profile.additional_info}
                  onChange={(e) => setProfile({...profile, additional_info: e.target.value})}
                  placeholder="Dietary restrictions, preferences..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 min-h-24" />
              </div>
            </div>

            <button onClick={generateGoals} disabled={isGeneratingGoals}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 flex items-center justify-center gap-2 disabled:opacity-50">
              {isGeneratingGoals ? (
                <><Loader className="animate-spin" size={20} />Generating...</>
              ) : (
                <><Target size={20} />Generate My Goals with AI</>
              )}
            </button>

            <div className="mt-6 bg-indigo-50 rounded-xl p-6">
              <h3 className="font-bold text-gray-800 mb-3">Current Goals</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-lg p-3">
                  <div className="text-sm text-gray-600">Calories</div>
                  <div className="text-xl font-bold text-orange-600">{goals.calories}</div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-sm text-gray-600">Protein</div>
                  <div className="text-xl font-bold text-red-600">{goals.protein}g</div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-sm text-gray-600">Carbs</div>
                  <div className="text-xl font-bold text-blue-600">{goals.carbs}g</div>
                </div>
                <div className="bg-white rounded-lg p-3">
                  <div className="text-sm text-gray-600">Fats</div>
                  <div className="text-xl font-bold text-yellow-600">{goals.fats}g</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 bg-white shadow-lg border-t border-gray-200">
        <div className="max-w-4xl mx-auto flex">
          <button onClick={() => setActiveTab('home')}
            className={`flex-1 py-4 px-6 font-semibold flex flex-col items-center justify-center gap-1 ${
              activeTab === 'home' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}>
            <Home size={24} />
            <span className="text-xs">Today</span>
          </button>
          <button onClick={() => setActiveTab('calendar')}
            className={`flex-1 py-4 px-6 font-semibold flex flex-col items-center justify-center gap-1 ${
              activeTab === 'calendar' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}>
            <Calendar size={24} />
            <span className="text-xs">Calendar</span>
          </button>
          <button onClick={() => setActiveTab('profile')}
            className={`flex-1 py-4 px-6 font-semibold flex flex-col items-center justify-center gap-1 ${
              activeTab === 'profile' ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-100'
            }`}>
            <User size={24} />
            <span className="text-xs">Profile</span>
          </button>
        </div>
      </div>
    </div>
  );
}
