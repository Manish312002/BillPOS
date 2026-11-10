import { configureStore } from '@reduxjs/toolkit';
import systemReducer from './systemSlice.js';
import authReducer from './authSlice.js';
import themeReducer from './themeSlice.js';

export const store = configureStore({
  reducer: {
    system: systemReducer,
    auth: authReducer,
    theme: themeReducer,
  },
  devTools: import.meta.env.DEV,
});

export default store;
