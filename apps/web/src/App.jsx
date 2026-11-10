import React, { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { store } from './app/store/index.js';
import { restoreSession } from './app/store/authSlice.js';
import { applyThemeToDocument } from './app/store/themeSlice.js';
import { AppRouter } from './app/router/index.jsx';

function AppInitializer() {
  const dispatch = useDispatch();
  const { mode, color } = useSelector((state) => state.theme);

  useEffect(() => {
    dispatch(restoreSession());
  }, [dispatch]);

  // Synchronize theme with DOM
  useEffect(() => {
    applyThemeToDocument(mode, color);

    if (mode === 'system' && typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => {
        applyThemeToDocument('system', color);
      };
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [mode, color]);

  return <AppRouter />;
}

export function App() {
  return (
    <Provider store={store}>
      <BrowserRouter>
        <AppInitializer />
      </BrowserRouter>
    </Provider>
  );
}

export default App;
