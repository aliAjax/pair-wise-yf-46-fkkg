import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AdConfirmation, AdContract, AiringRecord, MakeGoodEntry, MakeGoodReason, MakeGoodSlot, RundownItem } from "../types";
import { computeAll, hhmmOf, hhmmOfMinutes, ledgerDigest, minutesOf, plannedStarts, toISO } from "../lib/fulfillment";

interface AdsState {
  contracts: AdContract[];
  airings: AiringRecord[];
  slots: MakeGoodSlot[];
  makeGood: MakeGoodEntry[];
  confirmations: AdConfirmation[];
  planDigest: string;
}

const seedSlots: MakeGoodSlot[] = [
  { id: "slot-am", label: "上午补播窗", start: "10:30", end: "10:36", capacity: 2 },
  { id: "slot-noon", label: "午间补播窗", start: "12:30", end: "12:36", capacity: 2 },
  { id: "slot-pm", label: "傍晚补播窗", start: "17:30", end: "17:33", capacity: 1 }
];

const initialState: AdsState = { contracts: [], airings: [], slots: seedSlots, makeGood: [], confirmations: [], planDigest: "" };

function relayout(state: AdsState) {
  const open = state.makeGood.filter((entry) => entry.status !== "已补播").sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  const usage = new Map<string, number>();
  for (const entry of open) {
    const slot = state.slots.find((candidate) => (usage.get(candidate.id) ?? 0) < candidate.capacity);
    if (slot) {
      entry.status = "已排期";
      entry.slotId = slot.id;
      usage.set(slot.id, (usage.get(slot.id) ?? 0) + 1);
    } else {
      entry.status = "排队中";
      entry.slotId = undefined;
    }
  }
}

const slice = createSlice({
  name: "ads",
  initialState,
  reducers: {
    ensureContracts(state, action: PayloadAction<RundownItem[]>) {
      const planned = plannedStarts(action.payload);
      for (const item of action.payload) {
        if (item.type !== "广告") continue;
        if (state.contracts.some((contract) => contract.itemId === item.id)) continue;
        const start = item.hardStart ?? planned.get(item.id) ?? "08:00";
        state.contracts.push({
          id: crypto.randomUUID(),
          itemId: item.id,
          advertiser: "待登记广告主",
          windowStart: start,
          windowEnd: hhmmOfMinutes(minutesOf(start) + 30),
          duration: item.duration,
          requiredCount: 1,
          note: "旧串联单升级默认补录，请核对合同"
        });
      }
    },
    upsertContract(state, action: PayloadAction<AdContract>) {
      const index = state.contracts.findIndex((contract) => contract.id === action.payload.id);
      if (index >= 0) state.contracts[index] = action.payload;
    },
    recordAiring(state, action: PayloadAction<{ contractId: string; actualStart: string; actualEnd: string; source?: AiringRecord["source"] }>) {
      state.airings.push({ id: crypto.randomUUID(), source: "本地日志", ...action.payload, loggedAt: new Date().toISOString() });
    },
    recomputeLedger(state, action: PayloadAction<RundownItem[]>) {
      const digest = ledgerDigest(action.payload, state.contracts, state.airings);
      if (state.planDigest === digest) return;
      state.planDigest = digest;
      const flagged = computeAll(action.payload, state.contracts, state.airings)
        .filter((conclusion) => conclusion.flagged)
        .map((conclusion) => ({ contractId: conclusion.contract.id, reason: conclusion.flagged as MakeGoodReason, detail: conclusion.detail }));
      const flaggedIds = new Set(flagged.map((entry) => entry.contractId));
      state.makeGood = state.makeGood.filter((entry) => entry.status === "已补播" || flaggedIds.has(entry.contractId));
      for (const entry of flagged) {
        if (state.makeGood.some((existing) => existing.contractId === entry.contractId && existing.status !== "已补播")) continue;
        state.makeGood.push({ ...entry, id: crypto.randomUUID(), status: "排队中", queuedAt: new Date().toISOString() });
      }
      relayout(state);
    },
    completeMakeGood(state, action: PayloadAction<string>) {
      const entry = state.makeGood.find((candidate) => candidate.id === action.payload);
      if (!entry || entry.status !== "已排期" || !entry.slotId) return;
      const slot = state.slots.find((candidate) => candidate.id === entry.slotId);
      const contract = state.contracts.find((candidate) => candidate.id === entry.contractId);
      entry.status = "已补播";
      if (slot && contract) {
        state.airings.push({ id: crypto.randomUUID(), contractId: contract.id, actualStart: toISO(slot.start), actualEnd: toISO(hhmmOfMinutes(minutesOf(slot.start) + contract.duration)), source: "补播", loggedAt: new Date().toISOString() });
      }
      relayout(state);
    },
    receiveConfirmation(state, action: PayloadAction<{ contractId: string; remoteStart: string; remoteEnd: string }>) {
      const { contractId, remoteStart, remoteEnd } = action.payload;
      const base = { id: crypto.randomUUID(), contractId, remoteStart, remoteEnd, receivedAt: new Date().toISOString() };
      if (state.confirmations.some((entry) => entry.contractId === contractId && entry.status === "已确认")) {
        state.confirmations.unshift({ ...base, status: "晚到未采信", diffNote: "已有主编确认结果，晚到回执不顶掉" });
        return;
      }
      const airing = [...state.airings].reverse().find((entry) => entry.contractId === contractId);
      if (!airing) {
        state.confirmations.unshift({ ...base, status: "有差异", diffNote: "本地无播出记录，两条都保留待主编核对" });
        return;
      }
      const localStart = hhmmOf(airing.actualStart);
      const localEnd = hhmmOf(airing.actualEnd);
      if (localStart === remoteStart && localEnd === remoteEnd) {
        state.confirmations.unshift({ ...base, status: "一致" });
      } else {
        state.confirmations.unshift({ ...base, status: "有差异", diffNote: `本地 ${localStart}-${localEnd} 与回执 ${remoteStart}-${remoteEnd} 不一致` });
      }
    },
    resolveConfirmation(state, action: PayloadAction<{ id: string; resolution: "以本地为准" | "以回执为准" }>) {
      const entry = state.confirmations.find((candidate) => candidate.id === action.payload.id);
      if (!entry || entry.status !== "有差异") return;
      entry.status = "已确认";
      entry.resolution = action.payload.resolution;
      entry.resolvedBy = "主编";
      entry.resolvedAt = new Date().toISOString();
    }
  }
});

export const { ensureContracts, upsertContract, recordAiring, recomputeLedger, completeMakeGood, receiveConfirmation, resolveConfirmation } = slice.actions;
export default slice.reducer;
