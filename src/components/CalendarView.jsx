import React from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';

import { getDayRecord, sumEntries } from '../utils/dayRecords';
import { createDateFromKey, formatDateKey } from '../utils/date';

function MonthView({ year, month, dailyData, selectedDateKey, setCurrentDate, setActiveTab }) {
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

              {!hasEntriesForDay && record && <div className="text-[11px] font-medium text-slate-400">Saved day</div>}
            </button>
          );
        })}
      </div>
    </>
  );
}

function getMonthStats(year, month, trackedDateKeys, dailyData) {
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
}

function YearView({ year, trackedDateKeys, dailyData, currentDate, setCurrentDate, setCalendarView }) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return (
    <div className="grid grid-cols-3 gap-3 md:grid-cols-4">
      {Array.from({ length: 12 }, (_, month) => {
        const stats = getMonthStats(year, month, trackedDateKeys, dailyData);
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
}

function MultiYearView({ focusYear, trackedDateKeys, dailyData, currentDate, setCurrentDate, setCalendarView }) {
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
}

export default function CalendarView({
  currentDate,
  setCurrentDate,
  calendarView,
  setCalendarView,
  dailyData,
  selectedDateKey,
  trackedDateKeys,
  setActiveTab,
}) {
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

      {calendarView === 'month' && (
        <MonthView
          year={year}
          month={month}
          dailyData={dailyData}
          selectedDateKey={selectedDateKey}
          setCurrentDate={setCurrentDate}
          setActiveTab={setActiveTab}
        />
      )}
      {calendarView === 'year' && (
        <YearView
          year={year}
          trackedDateKeys={trackedDateKeys}
          dailyData={dailyData}
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
          setCalendarView={setCalendarView}
        />
      )}
      {calendarView === 'multi-year' && (
        <MultiYearView
          focusYear={year}
          trackedDateKeys={trackedDateKeys}
          dailyData={dailyData}
          currentDate={currentDate}
          setCurrentDate={setCurrentDate}
          setCalendarView={setCalendarView}
        />
      )}
    </div>
  );
}
