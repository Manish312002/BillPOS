import { createSlice } from '@reduxjs/toolkit';

export const THEME_COLORS = [
  {
    id: 'blue',
    label: 'Ocean Blue',
    primary: '#2563eb',
    hover: '#1d4ed8',
    light: '#eff6ff',
    border: '#bfdbfe',
    text: '#1d4ed8',
    ring: '#3b82f6',
    previewHex: '#3b82f6',
  },
  {
    id: 'purple',
    label: 'Royal Purple',
    primary: '#9333ea',
    hover: '#7e22ce',
    light: '#faf5ff',
    border: '#e9d5ff',
    text: '#7e22ce',
    ring: '#a855f7',
    previewHex: '#a855f7',
  },
  {
    id: 'orange',
    label: 'Sunset Orange',
    primary: '#ea580c',
    hover: '#c2410c',
    light: '#fff7ed',
    border: '#fed7aa',
    text: '#c2410c',
    ring: '#f97316',
    previewHex: '#f97316',
  },
  {
    id: 'green',
    label: 'Emerald Green',
    primary: '#16a34a',
    hover: '#15803d',
    light: '#f0fdf4',
    border: '#bbf7d0',
    text: '#15803d',
    ring: '#22c55e',
    previewHex: '#22c55e',
  },
  {
    id: 'rose',
    label: 'Blush Rose',
    primary: '#e11d48',
    hover: '#be123c',
    light: '#fff1f2',
    border: '#fecdd3',
    text: '#be123c',
    ring: '#f43f5e',
    previewHex: '#f43f5e',
  },
  {
    id: 'teal',
    label: 'Nordic Teal',
    primary: '#0d9488',
    hover: '#0f766e',
    light: '#f0fdfa',
    border: '#99f6e4',
    text: '#0f766e',
    ring: '#14b8a6',
    previewHex: '#14b8a6',
  },
  {
    id: 'amber',
    label: 'Golden Amber',
    primary: '#d97706',
    hover: '#b45309',
    light: '#fffbeb',
    border: '#fde68a',
    text: '#b45309',
    ring: '#f59e0b',
    previewHex: '#f59e0b',
  },
  {
    id: 'indigo',
    label: 'Deep Indigo',
    primary: '#4f46e5',
    hover: '#4338ca',
    light: '#eef2ff',
    border: '#c7d2fe',
    text: '#4338ca',
    ring: '#6366f1',
    previewHex: '#6366f1',
  },
];

function getInitialMode() {
  if (typeof window === 'undefined') return 'system';
  try {
    const saved = localStorage.getItem('bb_theme_mode');
    if (saved === 'dark' || saved === 'light' || saved === 'system') {
      return saved;
    }
  } catch {
    // ignore
  }
  return 'system';
}

function getInitialColor() {
  if (typeof window === 'undefined') return 'blue';
  try {
    const saved = localStorage.getItem('bb_theme_color');
    if (THEME_COLORS.some((c) => c.id === saved)) {
      return saved;
    }
  } catch {
    // ignore
  }
  return 'blue';
}

export function applyThemeToDocument(mode, colorId) {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;

  // Resolve mode
  let isDark = false;
  if (mode === 'dark') {
    isDark = true;
  } else if (mode === 'light') {
    isDark = false;
  } else {
    // system
    isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  if (isDark) {
    root.classList.add('dark');
    root.classList.remove('light');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
  }

  // Set theme data attribute
  root.setAttribute('data-theme-mode', isDark ? 'dark' : 'light');
  root.setAttribute('data-theme-color', colorId);

  // Set CSS variables for primary accent colors
  const colorDef = THEME_COLORS.find((c) => c.id === colorId) || THEME_COLORS[0];
  root.style.setProperty('--theme-primary', colorDef.primary);
  root.style.setProperty('--theme-primary-hover', colorDef.hover);
  root.style.setProperty('--theme-primary-light', isDark ? `${colorDef.primary}22` : colorDef.light);
  root.style.setProperty('--theme-primary-border', isDark ? `${colorDef.primary}55` : colorDef.border);
  root.style.setProperty('--theme-primary-text', isDark ? '#ffffff' : colorDef.text);
  root.style.setProperty('--theme-ring', colorDef.ring);
}

const initialState = {
  mode: getInitialMode(),
  color: getInitialColor(),
};

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    setThemeMode: (state, action) => {
      const mode = action.payload;
      state.mode = mode;
      try {
        localStorage.setItem('bb_theme_mode', mode);
      } catch {
        // ignore
      }
      applyThemeToDocument(mode, state.color);
    },
    setThemeColor: (state, action) => {
      const color = action.payload;
      state.color = color;
      try {
        localStorage.setItem('bb_theme_color', color);
      } catch {
        // ignore
      }
      applyThemeToDocument(state.mode, color);
    },
    toggleThemeMode: (state) => {
      let isCurrentlyDark = false;
      if (state.mode === 'dark') {
        isCurrentlyDark = true;
      } else if (state.mode === 'light') {
        isCurrentlyDark = false;
      } else {
        isCurrentlyDark =
          typeof window !== 'undefined' &&
          window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      const nextMode = isCurrentlyDark ? 'light' : 'dark';
      state.mode = nextMode;
      try {
        localStorage.setItem('bb_theme_mode', nextMode);
      } catch {
        // ignore
      }
      applyThemeToDocument(nextMode, state.color);
    },
  },
});

export const { setThemeMode, setThemeColor, toggleThemeMode } = themeSlice.actions;
export default themeSlice.reducer;
