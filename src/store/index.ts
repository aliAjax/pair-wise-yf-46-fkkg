import { configureStore } from "@reduxjs/toolkit";
import rundownReducer from "./rundownSlice";
import adLedgerReducer from "./adLedgerSlice";
import { rundownApi } from "./api";

export const store = configureStore({ reducer: { rundown: rundownReducer, adLedger: adLedgerReducer, [rundownApi.reducerPath]: rundownApi.reducer }, middleware: (getDefault) => getDefault().concat(rundownApi.middleware) });
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
