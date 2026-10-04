import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { addItem, adjustDuration, initialize, insertBreaking, reorder, skipItem } from "./rundownSlice";
import type { AdBroadcastRecord, AdContract, AdLedgerState, Discrepancy, FulfillmentConclusion, MakeupEntry, MakeupSlot, RundownItem } from "../types";

const DEVIATION_THRESHOLD = 5; // 偏差超过 5 分钟视为"偏差过大"

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = ((minutes % 60) + 60) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 计算实际播出时间与合同窗口的偏差(分钟)：在窗口内为 0，否则为偏离窗口的分钟数 */
function timeDeviation(actualStart: string, windowStart: string, windowEnd: string): number {
  const actual = toMinutes(actualStart);
  const start = toMinutes(windowStart);
  const end = toMinutes(windowEnd);
  if (actual < start) return start - actual;
  if (actual > end) return actual - end;
  return 0;
}

function defaultContract(item: Pick<RundownItem, "id" | "hardStart" | "duration">): AdContract {
  const windowStart = item.hardStart ?? "08:00";
  const startMin = toMinutes(windowStart);
  return {
    id: crypto.randomUUID(),
    itemId: item.id,
    client: "默认广告主",
    windowStart,
    windowEnd: toHHMM(startMin + 30), // 默认 30 分钟合同窗口
    duration: item.duration,
    requiredCount: 1,
    createdAt: new Date().toISOString()
  };
}

function defaultSlots(): MakeupSlot[] {
  return [
    { id: "slot-0900", slot: "09:00", capacity: 2, booked: 0 },
    { id: "slot-0920", slot: "09:20", capacity: 2, booked: 0 },
    { id: "slot-0940", slot: "09:40", capacity: 2, booked: 0 },
    { id: "slot-1000", slot: "10:00", capacity: 2, booked: 0 }
  ];
}

const initialState: AdLedgerState = {
  contracts: [],
  records: [],
  conclusions: [],
  makeupQueue: [],
  makeupSlots: defaultSlots(),
  discrepancies: []
};

/** 重算所有合同的兑现结论，并据此更新补播队列 */
function recalculateConclusions(state: AdLedgerState) {
  const validContractIds = new Set(state.contracts.map((c) => c.id));
  // 清理孤立结论
  state.conclusions = state.conclusions.filter((c) => validContractIds.has(c.contractId));
  // 清理孤立记录
  state.records = state.records.filter((r) => validContractIds.has(r.contractId));
  // 清理孤立差异
  state.discrepancies = state.discrepancies.filter((d) => validContractIds.has(d.contractId));

  for (const contract of state.contracts) {
    const localRecords = state.records.filter((r) => r.contractId === contract.id && r.source === "local");
    const actualCount = localRecords.length;
    let status: FulfillmentConclusion["status"];
    let deviationMinutes = 0;
    let detail: string;

    if (actualCount === 0) {
      status = "missed";
      detail = `应播 ${contract.requiredCount} 次，实播 0 次，漏播`;
    } else if (actualCount < contract.requiredCount) {
      status = "missed";
      detail = `应播 ${contract.requiredCount} 次，实播 ${actualCount} 次，漏播 ${contract.requiredCount - actualCount} 次`;
    } else {
      let maxDev = 0;
      for (const record of localRecords) {
        const tDev = timeDeviation(record.actualStart, contract.windowStart, contract.windowEnd);
        const actualDur = toMinutes(record.actualEnd) - toMinutes(record.actualStart);
        const dDev = Math.abs(actualDur - contract.duration);
        maxDev = Math.max(maxDev, tDev, dDev);
      }
      deviationMinutes = maxDev;
      if (maxDev > DEVIATION_THRESHOLD) {
        status = "deviated";
        detail = `实播 ${actualCount} 次，最大偏差 ${maxDev} 分钟(阈值 ${DEVIATION_THRESHOLD})，偏差过大`;
      } else {
        status = "fulfilled";
        detail = `实播 ${actualCount} 次，均在合同窗口内，已兑现`;
      }
    }

    const existing = state.conclusions.find((c) => c.contractId === contract.id);
    if (existing) {
      existing.status = status;
      existing.actualCount = actualCount;
      existing.deviationMinutes = deviationMinutes;
      existing.stale = false;
      existing.calculatedAt = new Date().toISOString();
      existing.detail = detail;
    } else {
      state.conclusions.push({ contractId: contract.id, status, actualCount, deviationMinutes, stale: false, calculatedAt: new Date().toISOString(), detail });
    }
  }

  updateMakeupQueue(state);
}

/** 根据兑现结论更新补播队列：漏播/偏差过大进入队列，已兑现移出并释放时段 */
function updateMakeupQueue(state: AdLedgerState) {
  for (const conclusion of state.conclusions) {
    const needsMakeup = conclusion.status === "missed" || conclusion.status === "deviated";
    const existing = state.makeupQueue.find((m) => m.contractId === conclusion.contractId);
    if (needsMakeup && !existing) {
      const contract = state.contracts.find((c) => c.id === conclusion.contractId);
      state.makeupQueue.push({
        id: crypto.randomUUID(),
        contractId: conclusion.contractId,
        itemId: contract?.itemId ?? "",
        reason: conclusion.status === "missed" ? "missed" : "deviation",
        status: "queued",
        requestedAt: new Date().toISOString()
      });
    } else if (!needsMakeup && existing) {
      // 已兑现：释放已预约时段并移出队列
      if (existing.status === "scheduled" && existing.scheduledSlot) {
        const slot = state.makeupSlots.find((s) => s.slot === existing.scheduledSlot);
        if (slot) slot.booked = Math.max(0, slot.booked - 1);
      }
      state.makeupQueue = state.makeupQueue.filter((m) => m.id !== existing.id);
    }
  }
  // 为排队中的条目安排有空位的补播时段；容量用满则继续排队
  for (const entry of state.makeupQueue) {
    if (entry.status !== "queued") continue;
    const slot = state.makeupSlots.find((s) => s.booked < s.capacity);
    if (slot) {
      entry.status = "scheduled";
      entry.scheduledSlot = slot.slot;
      slot.booked += 1;
    }
  }
}

/** 标记所有结论为失效(计划改动后调用)，随后重算 */
function invalidateAndRecalculate(state: AdLedgerState) {
  for (const c of state.conclusions) c.stale = true;
  recalculateConclusions(state);
}

const slice = createSlice({
  name: "adLedger",
  initialState,
  reducers: {
    loadLedger(state, action: PayloadAction<AdLedgerState>) {
      return { ...action.payload, makeupSlots: action.payload.makeupSlots?.length ? action.payload.makeupSlots : defaultSlots() };
    },
    /** 根据当前串联单条目同步合同：为广告条目补默认合同，清理孤立合同 */
    syncContracts(state, action: PayloadAction<RundownItem[]>) {
      const adItems = action.payload.filter((item) => item.type === "广告");
      const adItemIds = new Set(adItems.map((item) => item.id));
      state.contracts = state.contracts.filter((c) => adItemIds.has(c.itemId));
      for (const item of adItems) {
        if (!state.contracts.some((c) => c.itemId === item.id)) {
          state.contracts.push(defaultContract(item));
        }
      }
      recalculateConclusions(state);
    },
    /** 播出后登记本地播出记录 */
    recordLocalBroadcast(state, action: PayloadAction<{ itemId: string; plannedStart: string; actualStart: string; actualEnd: string }>) {
      const contract = state.contracts.find((c) => c.itemId === action.payload.itemId);
      if (!contract) return;
      state.records.push({
        id: crypto.randomUUID(),
        contractId: contract.id,
        itemId: action.payload.itemId,
        plannedStart: action.payload.plannedStart,
        actualStart: action.payload.actualStart,
        actualEnd: action.payload.actualEnd,
        source: "local",
        status: "pending",
        receivedAt: new Date().toISOString()
      });
      recalculateConclusions(state);
    },
    /** 合同方回传播出确认：与本地记录对账，对不上则两条都留下标差异，晚到回执不顶销已确认结果 */
    submitConfirmation(state, action: PayloadAction<{ itemId: string; actualStart: string; actualEnd: string }>) {
      const contract = state.contracts.find((c) => c.itemId === action.payload.itemId);
      if (!contract) return;

      // 已有确认的本地记录：回执晚到，不顶销
      const confirmedLocal = state.records.find((r) => r.contractId === contract.id && r.source === "local" && r.status === "confirmed");
      if (confirmedLocal) {
        state.records.push({
          id: crypto.randomUUID(),
          contractId: contract.id,
          itemId: action.payload.itemId,
          plannedStart: confirmedLocal.plannedStart,
          actualStart: action.payload.actualStart,
          actualEnd: action.payload.actualEnd,
          source: "confirmation",
          status: "late",
          receivedAt: new Date().toISOString(),
          note: "回执晚到，本地已确认，不顶销"
        });
        return;
      }

      const localRecord = state.records.find((r) => r.contractId === contract.id && r.source === "local");
      const confirmationRecord: AdBroadcastRecord = {
        id: crypto.randomUUID(),
        contractId: contract.id,
        itemId: action.payload.itemId,
        plannedStart: localRecord?.plannedStart ?? action.payload.actualStart,
        actualStart: action.payload.actualStart,
        actualEnd: action.payload.actualEnd,
        source: "confirmation",
        status: "pending",
        receivedAt: new Date().toISOString()
      };
      state.records.push(confirmationRecord);

      if (!localRecord) {
        // 无本地记录：标记差异待主编核对
        confirmationRecord.status = "discrepancy";
        state.discrepancies.push({
          id: crypto.randomUUID(),
          contractId: contract.id,
          itemId: action.payload.itemId,
          confirmationRecordId: confirmationRecord.id,
          field: "播出记录",
          localValue: "无本地播出记录",
          confirmationValue: `${action.payload.actualStart}–${action.payload.actualEnd}`,
          status: "pending",
          createdAt: new Date().toISOString()
        });
        return;
      }

      const matches = localRecord.actualStart === action.payload.actualStart && localRecord.actualEnd === action.payload.actualEnd;
      if (matches) {
        localRecord.status = "confirmed";
        confirmationRecord.status = "confirmed";
      } else {
        // 两条都留下，标出差异等主编核对
        localRecord.status = "discrepancy";
        confirmationRecord.status = "discrepancy";
        state.discrepancies.push({
          id: crypto.randomUUID(),
          contractId: contract.id,
          itemId: action.payload.itemId,
          localRecordId: localRecord.id,
          confirmationRecordId: confirmationRecord.id,
          field: "实际播出时间",
          localValue: `${localRecord.actualStart}–${localRecord.actualEnd}`,
          confirmationValue: `${action.payload.actualStart}–${action.payload.actualEnd}`,
          status: "pending",
          createdAt: new Date().toISOString()
        });
      }
    },
    /** 主编核对差异：采纳本地或合同方，另一条标记为晚到/差异 */
    reviewDiscrepancy(state, action: PayloadAction<{ discrepancyId: string; resolution: "accept_local" | "accept_confirmation" }>) {
      const disc = state.discrepancies.find((d) => d.id === action.payload.discrepancyId);
      if (!disc) return;
      disc.status = "resolved";
      if (action.payload.resolution === "accept_local") {
        const local = state.records.find((r) => r.id === disc.localRecordId);
        if (local) local.status = "confirmed";
        const conf = state.records.find((r) => r.id === disc.confirmationRecordId);
        if (conf) conf.status = "late";
      } else {
        const conf = state.records.find((r) => r.id === disc.confirmationRecordId);
        if (conf) conf.status = "confirmed";
        const local = state.records.find((r) => r.id === disc.localRecordId);
        if (local) local.status = "discrepancy";
      }
      recalculateConclusions(state);
    },
    /** 编辑合同信息 */
    updateContract(state, action: PayloadAction<{ itemId: string; changes: Partial<Pick<AdContract, "client" | "windowStart" | "windowEnd" | "duration" | "requiredCount">> }>) {
      const contract = state.contracts.find((c) => c.itemId === action.payload.itemId);
      if (!contract) return;
      Object.assign(contract, action.payload.changes);
      recalculateConclusions(state);
    },
    /** 手动安排补播条目到有空位的时段 */
    scheduleMakeup(state, action: PayloadAction<string>) {
      const entry = state.makeupQueue.find((m) => m.id === action.payload);
      if (!entry || entry.status !== "queued") return;
      const slot = state.makeupSlots.find((s) => s.booked < s.capacity);
      if (slot) {
        entry.status = "scheduled";
        entry.scheduledSlot = slot.slot;
        slot.booked += 1;
      }
    },
    /** 计划改动后手动触发重算 */
    recalculateAll(state) {
      invalidateAndRecalculate(state);
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(initialize, (state) => {
        // 升级时按广告条目补默认合同内容
        recalculateConclusions(state);
      })
      .addCase(addItem, (state, action) => {
        if (action.payload.type === "广告" && !state.contracts.some((c) => c.itemId === action.payload.id)) {
          state.contracts.push(defaultContract(action.payload));
        }
        invalidateAndRecalculate(state);
      })
      .addCase(reorder, (state) => { invalidateAndRecalculate(state); })
      .addCase(adjustDuration, (state) => { invalidateAndRecalculate(state); })
      .addCase(insertBreaking, (state) => { invalidateAndRecalculate(state); })
      .addCase(skipItem, (state) => { invalidateAndRecalculate(state); });
  }
});

export const { loadLedger, syncContracts, recordLocalBroadcast, submitConfirmation, reviewDiscrepancy, updateContract, scheduleMakeup, recalculateAll } = slice.actions;
export default slice.reducer;
