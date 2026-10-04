import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { AdLedgerState, RundownItem } from "../types";

const KEY = "pair-wise-yf-46/rundown";
const LEDGER_KEY = "pair-wise-yf-46/ad-ledger";

export const rundownApi = createApi({
  reducerPath: "rundownApi",
  baseQuery: fakeBaseQuery(),
  tagTypes: ["Rundown", "AdLedger"],
  endpoints: (builder) => ({
    getRundown: builder.query<RundownItem[], void>({
      queryFn: async () => {
        const raw = localStorage.getItem(KEY);
        return { data: raw ? JSON.parse(raw) as RundownItem[] : [] };
      },
      providesTags: ["Rundown"]
    }),
    saveRundown: builder.mutation<{ ok: true }, RundownItem[]>({
      queryFn: async (items) => {
        localStorage.setItem(KEY, JSON.stringify(items));
        return { data: { ok: true } };
      },
      invalidatesTags: ["Rundown"]
    }),
    getAdLedger: builder.query<AdLedgerState | null, void>({
      queryFn: async () => {
        const raw = localStorage.getItem(LEDGER_KEY);
        return { data: raw ? JSON.parse(raw) as AdLedgerState : null };
      },
      providesTags: ["AdLedger"]
    }),
    saveAdLedger: builder.mutation<{ ok: true }, AdLedgerState>({
      queryFn: async (ledger) => {
        localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
        return { data: { ok: true } };
      },
      invalidatesTags: ["AdLedger"]
    })
  })
});

export const { useGetRundownQuery, useSaveRundownMutation, useGetAdLedgerQuery, useSaveAdLedgerMutation } = rundownApi;
