export type Role = "导播" | "主编" | "字幕" | "演播室";
export type ItemType = "新闻片" | "连线" | "嘉宾" | "口播" | "广告";
export type ItemStatus = "待播" | "已播出" | "已跳过" | "草稿";

export interface RundownItem {
  id: string;
  title: string;
  type: ItemType;
  duration: number;
  hardStart?: string;
  status: ItemStatus;
  presenter: string;
  source: string;
}

export interface BreakingChange {
  id: string;
  headline: string;
  duration: number;
  insertAfter: string;
  reason: string;
  createdAt: string;
}

export interface PendingChange {
  id: string;
  action: string;
  detail: string;
  queuedAt: string;
}

export interface HistoryEntry {
  id: string;
  label: string;
  detail: string;
  time: string;
  snapshot: RundownItem[];
}

export type MakeGoodReason = "漏播" | "偏差过大" | "错时段";
export type MakeGoodStatus = "排队中" | "已排期" | "已补播";
export type ConfirmationStatus = "一致" | "有差异" | "已确认" | "晚到未采信";

export interface AdContract {
  id: string;
  itemId: string;
  advertiser: string;
  windowStart: string;
  windowEnd: string;
  duration: number;
  requiredCount: number;
  note?: string;
}

export interface AiringRecord {
  id: string;
  contractId: string;
  actualStart: string;
  actualEnd: string;
  source: "本地日志" | "补播";
  loggedAt: string;
}

export interface MakeGoodSlot {
  id: string;
  label: string;
  start: string;
  end: string;
  capacity: number;
}

export interface MakeGoodEntry {
  id: string;
  contractId: string;
  reason: MakeGoodReason;
  detail: string;
  status: MakeGoodStatus;
  slotId?: string;
  queuedAt: string;
}

export interface AdConfirmation {
  id: string;
  contractId: string;
  remoteStart: string;
  remoteEnd: string;
  receivedAt: string;
  status: ConfirmationStatus;
  diffNote?: string;
  resolution?: "以本地为准" | "以回执为准";
  resolvedBy?: string;
  resolvedAt?: string;
}
