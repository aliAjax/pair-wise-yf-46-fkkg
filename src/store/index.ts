import { configureStore } from "@reduxjs/toolkit";
import rundownReducer from "./rundownSlice";
import adsReducer from "./adsSlice";
import { rundownApi } from "./api";

const ADS_KEY = "pair-wise-yf-46/ads";

function loadAdsState() {
  try {
    const raw = localStorage.getItem(ADS_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    return parsed && Array.isArray(parsed.contracts) && Array.isArray(parsed.airings) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

const preloadedAds = loadAdsState();

export const store = configureStore({
  reducer: { rundown: rundownReducer, ads: adsReducer, [rundownApi.reducerPath]: rundownApi.reducer },
  middleware: (getDefault) => getDefault().concat(rundownApi.middleware),
  preloadedState: preloadedAds ? { ads: preloadedAds } : undefined
});

store.subscribe(() => {
  localStorage.setItem(ADS_KEY, JSON.stringify(store.getState().ads));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
