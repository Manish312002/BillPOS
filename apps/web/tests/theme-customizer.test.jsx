import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import themeReducer, {
  setThemeMode,
  setThemeColor,
  toggleThemeMode,
  applyThemeToDocument,
  THEME_COLORS,
} from '../src/app/store/themeSlice.js';
import authReducer, { AUTH_STATES } from '../src/app/store/authSlice.js';
import systemReducer from '../src/app/store/systemSlice.js';
import { ThemeSettingsCard } from '../src/components/theme/ThemeSettingsCard.jsx';
import { ThemeQuickToggle } from '../src/components/theme/ThemeQuickToggle.jsx';
import { PlatformSettingsPage } from '../src/portals/platform/pages/PlatformSettingsPage.jsx';
import { OwnerSettingsPage } from '../src/portals/owner/pages/OwnerSettingsPage.jsx';

function createTestStore(preloadedTheme = {}) {
  return configureStore({
    reducer: {
      theme: themeReducer,
      auth: authReducer,
      system: systemReducer,
    },
    preloadedState: {
      theme: {
        mode: 'light',
        color: 'blue',
        ...preloadedTheme,
      },
      auth: {
        authState: AUTH_STATES.AUTHENTICATED_SUPERADMIN,
        user: { id: 'u-1', fullName: 'Test User' },
        platformRole: 'SUPERADMIN',
        session: { id: 'sess-1' },
      },
    },
  });
}

function renderWithTheme(ui, preloadedTheme = {}) {
  const store = createTestStore(preloadedTheme);
  return {
    store,
    ...render(
      <Provider store={store}>
        <MemoryRouter>{ui}</MemoryRouter>
      </Provider>
    ),
  };
}

describe('Theme Customizer & Dark/Light System', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('data-theme-color');
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('1. Redux Theme Slice & DOM Application', () => {
    it('applies dark mode to documentElement and persists to localStorage', () => {
      const store = createTestStore();
      store.dispatch(setThemeMode('dark'));

      expect(store.getState().theme.mode).toBe('dark');
      expect(localStorage.getItem('bb_theme_mode')).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.getAttribute('data-theme-mode')).toBe('dark');
    });

    it('applies light mode to documentElement and persists to localStorage', () => {
      const store = createTestStore({ mode: 'dark' });
      store.dispatch(setThemeMode('light'));

      expect(store.getState().theme.mode).toBe('light');
      expect(localStorage.getItem('bb_theme_mode')).toBe('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme-mode')).toBe('light');
    });

    it('applies selectable colors: purple, orange, blue, green', () => {
      const store = createTestStore();

      // Purple
      store.dispatch(setThemeColor('purple'));
      expect(store.getState().theme.color).toBe('purple');
      expect(localStorage.getItem('bb_theme_color')).toBe('purple');
      expect(document.documentElement.getAttribute('data-theme-color')).toBe('purple');
      expect(document.documentElement.style.getPropertyValue('--theme-primary')).toBe('#9333ea');

      // Orange
      store.dispatch(setThemeColor('orange'));
      expect(store.getState().theme.color).toBe('orange');
      expect(localStorage.getItem('bb_theme_color')).toBe('orange');
      expect(document.documentElement.getAttribute('data-theme-color')).toBe('orange');
      expect(document.documentElement.style.getPropertyValue('--theme-primary')).toBe('#ea580c');

      // Green
      store.dispatch(setThemeColor('green'));
      expect(store.getState().theme.color).toBe('green');
      expect(localStorage.getItem('bb_theme_color')).toBe('green');
      expect(document.documentElement.getAttribute('data-theme-color')).toBe('green');
      expect(document.documentElement.style.getPropertyValue('--theme-primary')).toBe('#16a34a');

      // Blue
      store.dispatch(setThemeColor('blue'));
      expect(store.getState().theme.color).toBe('blue');
      expect(localStorage.getItem('bb_theme_color')).toBe('blue');
      expect(document.documentElement.getAttribute('data-theme-color')).toBe('blue');
      expect(document.documentElement.style.getPropertyValue('--theme-primary')).toBe('#2563eb');
    });

    it('toggleThemeMode toggles between light and dark', () => {
      const store = createTestStore({ mode: 'light' });
      store.dispatch(toggleThemeMode());
      expect(store.getState().theme.mode).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      store.dispatch(toggleThemeMode());
      expect(store.getState().theme.mode).toBe('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  describe('2. ThemeSettingsCard Component in Settings Pages', () => {
    it('renders mode selectors and color palette options', () => {
      renderWithTheme(<ThemeSettingsCard />);

      expect(screen.getByText(/Theme & Visual Appearance/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Light Mode/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Dark Mode/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /System Auto/i })).toBeInTheDocument();

      // Check key requested colors are all present
      expect(screen.getByRole('button', { name: /Royal Purple/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Sunset Orange/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Emerald Green/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Ocean Blue/i })).toBeInTheDocument();
    });

    it('allows Superadmin to switch theme mode and accent color on click', () => {
      const { store } = renderWithTheme(<PlatformSettingsPage />);

      // Switch to Dark Mode
      const darkBtn = screen.getByRole('button', { name: /Dark Mode/i });
      fireEvent.click(darkBtn);
      expect(store.getState().theme.mode).toBe('dark');

      // Switch to Purple
      const purpleBtn = screen.getByRole('button', { name: /Royal Purple/i });
      fireEvent.click(purpleBtn);
      expect(store.getState().theme.color).toBe('purple');

      // Switch to Green
      const greenBtn = screen.getByRole('button', { name: /Emerald Green/i });
      fireEvent.click(greenBtn);
      expect(store.getState().theme.color).toBe('green');
    });

    it('renders cleanly in Store Owner Settings Page', () => {
      renderWithTheme(<OwnerSettingsPage />);

      expect(screen.getByRole('heading', { name: /Store Profile & Hardware Settings/i })).toBeInTheDocument();
      expect(screen.getByText(/Theme & Visual Appearance/i)).toBeInTheDocument();
      expect(screen.getByText(/Live Preview in Selected Theme/i)).toBeInTheDocument();
    });
  });

  describe('3. ThemeQuickToggle Header Controls', () => {
    it('toggles mode when clicking the sun/moon icon', () => {
      const { store } = renderWithTheme(<ThemeQuickToggle />, { mode: 'light' });

      const toggleBtn = screen.getByLabelText(/Toggle Theme Mode/i);
      expect(toggleBtn).toHaveTextContent('☀️');

      fireEvent.click(toggleBtn);
      expect(store.getState().theme.mode).toBe('dark');
    });

    it('opens palette menu and selects colors from the header dropdown', () => {
      const { store } = renderWithTheme(<ThemeQuickToggle />, { color: 'blue' });

      const colorMenuBtn = screen.getByLabelText(/Choose Theme Accent Color/i);
      fireEvent.click(colorMenuBtn);

      expect(screen.getByText(/Select Accent Color/i)).toBeInTheDocument();

      // Click orange
      const orangeBtn = screen.getByRole('button', { name: /orange/i });
      fireEvent.click(orangeBtn);

      expect(store.getState().theme.color).toBe('orange');
    });
  });
});
