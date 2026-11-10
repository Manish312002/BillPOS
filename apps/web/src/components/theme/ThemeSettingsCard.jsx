import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setThemeMode, setThemeColor, THEME_COLORS } from '../../app/store/themeSlice.js';

export function ThemeSettingsCard() {
  const dispatch = useDispatch();
  const themeState = useSelector((state) => state?.theme);
  const mode = themeState?.mode || 'system';
  const color = themeState?.color || 'blue';

  const selectedColorDef = THEME_COLORS.find((c) => c.id === color) || THEME_COLORS[0];

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 sm:p-6 shadow-xs space-y-6 transition-colors">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <span>🎨</span> Theme & Visual Appearance
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Customize between Light and Dark modes, and select your preferred operational accent color.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: selectedColorDef.primary }}
          />
          <span className="text-slate-700 dark:text-slate-300 font-medium capitalize">
            {selectedColorDef.label} • {mode}
          </span>
        </div>
      </div>

      {/* 1. Theme Mode: Light vs Dark vs System */}
      <div className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Appearance Mode
        </label>
        <div className="grid grid-cols-3 gap-3">
          {/* Light Mode */}
          <button
            type="button"
            onClick={() => dispatch(setThemeMode('light'))}
            className={`flex flex-col items-center justify-center p-3.5 rounded-lg border text-center transition-all cursor-pointer ${
              mode === 'light'
                ? 'border-[var(--theme-primary)] bg-[var(--theme-primary-light)] text-[var(--theme-primary)] font-semibold shadow-xs'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <span className="text-xl mb-1">☀️</span>
            <span className="text-xs font-medium">Light Mode</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Clean & crisp</span>
          </button>

          {/* Dark Mode */}
          <button
            type="button"
            onClick={() => dispatch(setThemeMode('dark'))}
            className={`flex flex-col items-center justify-center p-3.5 rounded-lg border text-center transition-all cursor-pointer ${
              mode === 'dark'
                ? 'border-[var(--theme-primary)] bg-[var(--theme-primary-light)] text-[var(--theme-primary)] font-semibold shadow-xs'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <span className="text-xl mb-1">🌙</span>
            <span className="text-xs font-medium">Dark Mode</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Deep & relaxed</span>
          </button>

          {/* System Mode */}
          <button
            type="button"
            onClick={() => dispatch(setThemeMode('system'))}
            className={`flex flex-col items-center justify-center p-3.5 rounded-lg border text-center transition-all cursor-pointer ${
              mode === 'system'
                ? 'border-[var(--theme-primary)] bg-[var(--theme-primary-light)] text-[var(--theme-primary)] font-semibold shadow-xs'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <span className="text-xl mb-1">💻</span>
            <span className="text-xs font-medium">System Auto</span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">Sync with OS</span>
          </button>
        </div>
      </div>

      {/* 2. Theme Accent Color Palette */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Accent Color Palette
          </label>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Selectable theme accents
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {THEME_COLORS.map((c) => {
            const isSelected = color === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => dispatch(setThemeColor(c.id))}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'border-slate-900 dark:border-white ring-2 ring-offset-2 ring-slate-900 dark:ring-white bg-slate-50 dark:bg-slate-800/80 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/40 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div
                  className="h-6 w-6 rounded-md flex-shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-2xs"
                  style={{ backgroundColor: c.primary }}
                >
                  {isSelected ? '✓' : ''}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                    {c.label}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono capitalize">
                    {c.id}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Live UI Component Preview */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Live Preview in Selected Theme
          </label>
          <span className="text-[10px] font-mono text-slate-400">
            Real-time visual components
          </span>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60 p-4 space-y-4">
          {/* Row of preview buttons and badges */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="px-3.5 py-1.5 rounded-lg text-white text-xs font-semibold shadow-xs transition-opacity hover:opacity-90 cursor-default"
              style={{ backgroundColor: 'var(--theme-primary)' }}
            >
              Primary Action
            </button>

            <button
              type="button"
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-default"
              style={{
                backgroundColor: 'var(--theme-primary-light)',
                borderColor: 'var(--theme-primary-border)',
                color: 'var(--theme-primary)',
              }}
            >
              Subtle Accent
            </button>

            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border"
              style={{
                backgroundColor: 'var(--theme-primary-light)',
                borderColor: 'var(--theme-primary-border)',
                color: 'var(--theme-primary)',
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: 'var(--theme-primary)' }}
              />
              Active Status Badge
            </span>
          </div>

          {/* Sample Navigation Tab */}
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
            <div
              className="px-3 py-1.5 rounded-md text-xs font-semibold border-b-2"
              style={{
                borderColor: 'var(--theme-primary)',
                color: 'var(--theme-primary)',
                backgroundColor: 'var(--theme-primary-light)',
              }}
            >
              Active Register Tab
            </div>
            <div className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400">
              Orders History
            </div>
            <div className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400">
              Inventory Reports
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ThemeSettingsCard;
