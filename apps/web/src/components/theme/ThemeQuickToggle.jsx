import React, { useState, useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toggleThemeMode, setThemeColor, THEME_COLORS } from '../../app/store/themeSlice.js';

export function ThemeQuickToggle() {
  const dispatch = useDispatch();
  const themeState = useSelector((state) => state?.theme);
  const mode = themeState?.mode || 'system';
  const color = themeState?.color || 'blue';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  const currentColorDef = THEME_COLORS.find((c) => c.id === color) || THEME_COLORS[0];

  // Resolve whether current mode renders dark or light
  const isDark =
    mode === 'dark' ||
    (mode === 'system' &&
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <div className="relative inline-flex items-center gap-1.5" ref={menuRef}>
      {/* 1. Quick Dark/Light Toggle Button */}
      <button
        type="button"
        onClick={() => dispatch(toggleThemeMode())}
        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shadow-2xs"
        title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        aria-label="Toggle Theme Mode"
      >
        <span className="text-sm select-none">{isDark ? '🌙' : '☀️'}</span>
      </button>

      {/* 2. Color Palette Swatch Dropdown Toggle */}
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-800/80 text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer shadow-2xs"
        title="Change Accent Color"
        aria-label="Choose Theme Accent Color"
      >
        <span
          className="h-3.5 w-3.5 rounded-full flex-shrink-0 shadow-2xs"
          style={{ backgroundColor: currentColorDef.primary }}
        />
        <span className="hidden sm:inline font-medium text-[11px] capitalize">
          {currentColorDef.id}
        </span>
        <svg
          className={`h-3 w-3 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 3. Popover Dropdown Menu */}
      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 shadow-xl shadow-slate-950/20 z-50 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 px-1.5 pt-0.5">
            Select Accent Color
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {THEME_COLORS.map((c) => {
              const isSelected = color === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    dispatch(setThemeColor(c.id));
                    setMenuOpen(false);
                  }}
                  className={`flex items-center gap-2 p-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: c.primary }}
                  />
                  <span className="truncate capitalize">{c.id}</span>
                  {isSelected && <span className="ml-auto text-[10px]">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ThemeQuickToggle;
