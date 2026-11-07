import { configureStore } from '@reduxjs/toolkit';
import systemReducer from './systemSlice.js';

export const store = configureStore({
  reducer: {
    system: systemReducer,
  },
  devTools: import.meta.env.DEV,
});

export default store;
