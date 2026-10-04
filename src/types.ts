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

// ===== 广告兑现台账 =====

/** 广告合同：每条广告登记的时段窗口、时长与应播次数 */
export interface AdContract {
  id: string;
  itemId: string;          // 关联串联单条目
  client: string;          // 广告主
  windowStart: string;     // 合同时段窗口开始 HH:mm
  windowEnd: string;       // 合同时段窗口结束 HH:mm
  duration: number;        // 合同时长(分钟)
  requiredCount: number;   // 应播次数
  createdAt: string;
}

/** 广告播出记录：本地日志或合同方回传确认 */
export interface AdBroadcastRecord {
  id: string;
  contractId: string;
  itemId: string;
  plannedStart: string;    // 计划开始 HH:mm
  actualStart: string;     // 实际开始 HH:mm
  actualEnd: string;       // 实际结束 HH:mm
  source: "local" | "confirmation";  // 本地日志 / 合同方回传
  status: "confirmed" | "discrepancy" | "late" | "pending";
  receivedAt: string;      // 回执到达时间
  note?: string;
}

/** 兑现结论：计划改动后失效重算 */
export interface FulfillmentConclusion {
  contractId: string;
  status: "fulfilled" | "missed" | "deviated" | "pending";
  actualCount: number;
  deviationMinutes: number;  // 与合同窗口的偏差(分钟)
  stale: boolean;            // 计划改动后失效待重算
  calculatedAt: string;
  detail: string;
}

/** 补播队列条目 */
export interface MakeupEntry {
  id: string;
  contractId: string;
  itemId: string;
  reason: "missed" | "deviation";
  status: "queued" | "scheduled";  // 排队等位置 / 已安排补播
  requestedAt: string;
  scheduledSlot?: string;
}

/** 补播时段容量 */
export interface MakeupSlot {
  id: string;
  slot: string;        // HH:mm
  capacity: number;    // 容量
  booked: number;      // 已预约
}

/** 差异：本地记录与合同方回传对不上，两条都留下等主编核对 */
export interface Discrepancy {
  id: string;
  contractId: string;
  itemId: string;
  localRecordId?: string;
  confirmationRecordId?: string;
  field: string;
  localValue: string;
  confirmationValue: string;
  status: "pending" | "resolved";
  createdAt: string;
}

/** 广告兑现台账完整状态 */
export interface AdLedgerState {
  contracts: AdContract[];
  records: AdBroadcastRecord[];
  conclusions: FulfillmentConclusion[];
  makeupQueue: MakeupEntry[];
  makeupSlots: MakeupSlot[];
  discrepancies: Discrepancy[];
}
