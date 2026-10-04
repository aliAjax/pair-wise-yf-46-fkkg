import { addMinutes, format } from "date-fns";
import type { AdContract, AiringRecord, MakeGoodReason, RundownItem } from "../types";

export const BROADCAST_DATE = "2026-10-08";
export const DEVIATION_THRESHOLD_MIN = 5;

export function toISO(hhmm: string): string {
  return `${BROADCAST_DATE}T${hhmm}:00`;
}

export function hhmmOf(iso: string): string {
  return format(new Date(iso), "HH:mm");
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmmOfMinutes(total: number): string {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function plannedStarts(items: RundownItem[]): Map<string, string> {
  let cursor = new Date(`${BROADCAST_DATE}T08:00:00`);
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.id, format(cursor, "HH:mm"));
    cursor = addMinutes(cursor, item.duration);
  }
  return map;
}

export type FulfillmentStatus = "待播" | "已兑现" | "部分兑现" | "漏播" | "错时段" | "偏差过大";

export interface Conclusion {
  contract: AdContract;
  plannedStart?: string;
  aired: number;
  lastAiring?: AiringRecord;
  deviationMin?: number;
  status: FulfillmentStatus;
  flagged?: MakeGoodReason;
  detail: string;
}

export function computeConclusion(contract: AdContract, item: RundownItem | undefined, airings: AiringRecord[], plannedStart?: string): Conclusion {
  const mine = airings.filter((a) => a.contractId === contract.id).sort((a, b) => a.actualStart.localeCompare(b.actualStart));
  const aired = mine.length;
  const last = mine.at(-1);
  const base = { contract, plannedStart, aired, lastAiring: last };
  if ((!item || item.status === "已跳过") && aired < contract.requiredCount) {
    return { ...base, status: "漏播", flagged: "漏播", detail: !item ? "条目已撤下，合同次数未播够" : "条目已跳过，合同次数未播够" };
  }
  if (aired === 0 || !last) {
    return { ...base, status: "待播", detail: "等待播出登记" };
  }
  if (last.source !== "补播") {
    const start = hhmmOf(last.actualStart);
    if (start < contract.windowStart || start > contract.windowEnd) {
      return { ...base, status: "错时段", flagged: "错时段", detail: `实际 ${start} 不在合同窗口 ${contract.windowStart}-${contract.windowEnd}` };
    }
    if (plannedStart) {
      const deviationMin = Math.abs(minutesOf(start) - minutesOf(plannedStart));
      if (deviationMin > DEVIATION_THRESHOLD_MIN) {
        return { ...base, status: "偏差过大", flagged: "偏差过大", deviationMin, detail: `计划 ${plannedStart}，实际 ${start}，偏差 ${deviationMin} 分钟` };
      }
      return { ...base, deviationMin, status: aired >= contract.requiredCount ? "已兑现" : "部分兑现", detail: aired >= contract.requiredCount ? "次数播齐，偏差在阈值内" : `已播 ${aired}/${contract.requiredCount} 次` };
    }
  }
  return { ...base, status: aired >= contract.requiredCount ? "已兑现" : "部分兑现", detail: aired >= contract.requiredCount ? "次数播齐（含补播）" : `已播 ${aired}/${contract.requiredCount} 次` };
}

export function computeAll(items: RundownItem[], contracts: AdContract[], airings: AiringRecord[]): Conclusion[] {
  const planned = plannedStarts(items);
  return contracts.map((contract) => computeConclusion(contract, items.find((i) => i.id === contract.itemId), airings, planned.get(contract.itemId)));
}

export function ledgerDigest(items: RundownItem[], contracts: AdContract[], airings: AiringRecord[]): string {
  return JSON.stringify({
    items: items.map((i) => [i.id, i.type, i.duration, i.status, i.hardStart ?? ""]),
    contracts: contracts.map((c) => [c.id, c.itemId, c.windowStart, c.windowEnd, c.duration, c.requiredCount]),
    airings: airings.map((a) => [a.contractId, a.actualStart, a.actualEnd, a.source])
  });
}
