import { configureStore } from '@reduxjs/toolkit';
import systemReducer from './systemSlice.js';
import authReducer from './authSlice.js';

export const store = configureStore({
  reducer: {
    system: systemReducer,
    auth: authReducer,
  },
  devTools: import.meta.env.DEV,
});

export default store;
