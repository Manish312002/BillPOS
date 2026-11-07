import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  isReady: true,
  appName: 'BillingBuddy',
  version: '0.1.0',
  initializedAt: new Date().toISOString(),
};

export const systemSlice = createSlice({
  name: 'system',
  initialState,
  reducers: {
    setReady: (state, action) => {
      state.isReady = action.payload;
    },
  },
});

export const { setReady } = systemSlice.actions;
export default systemSlice.reducer;
