import { useMemo, useState } from "react";
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Progress, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { format } from "date-fns";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { completeMakeGood, receiveConfirmation, recordAiring, resolveConfirmation, upsertContract } from "../store/adsSlice";
import { updateStatus } from "../store/rundownSlice";
import { computeAll, hhmmOf, hhmmOfMinutes, ledgerDigest, minutesOf, toISO, type Conclusion, type FulfillmentStatus } from "../lib/fulfillment";
import type { AdContract } from "../types";

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const hhmmRule = { required: true, pattern: HHMM, message: "格式 HH:mm" };

const statusColor: Record<FulfillmentStatus, string> = { 待播: "default", 已兑现: "green", 部分兑现: "blue", 漏播: "red", 错时段: "volcano", 偏差过大: "orange" };
const receiptColor: Record<string, string> = { 一致: "green", 有差异: "red", 已确认: "blue", 晚到未采信: "default" };

export function AdsLedgerPage() {
  const dispatch = useAppDispatch();
  const { items, role } = useAppSelector((state) => state.rundown);
  const ads = useAppSelector((state) => state.ads);
  const [airingFor, setAiringFor] = useState<Conclusion | null>(null);
  const [receiptFor, setReceiptFor] = useState<Conclusion | null>(null);
  const [contractFor, setContractFor] = useState<AdContract | null>(null);
  const [airingForm] = Form.useForm<{ start: string; end: string }>();
  const [receiptForm] = Form.useForm<{ start: string; end: string }>();
  const [contractForm] = Form.useForm<{ advertiser: string; windowStart: string; windowEnd: string; duration: number; requiredCount: number }>();

  const conclusions = useMemo(() => computeAll(items, ads.contracts, ads.airings), [items, ads.contracts, ads.airings]);
  const stale = ledgerDigest(items, ads.contracts, ads.airings) !== ads.planDigest;
  const readOnly = role === "字幕";
  const waiting = ads.makeGood.filter((entry) => entry.status === "排队中");
  const doneCount = ads.makeGood.filter((entry) => entry.status === "已补播").length;
  const disputed = ads.confirmations.filter((entry) => entry.status === "有差异");
  const advertiserOf = (contractId: string) => ads.contracts.find((contract) => contract.id === contractId)?.advertiser ?? "未知合同";

  const columns: ColumnsType<Conclusion> = [
    { title: "广告主", render: (_, c) => <><b>{c.contract.advertiser}</b>{c.contract.note && <small className="contract-note">{c.contract.note}</small>}</> },
    { title: "关联条目", render: (_, c) => items.find((item) => item.id === c.contract.itemId)?.title ?? <Tag>已撤下</Tag> },
    { title: "合同窗口", render: (_, c) => `${c.contract.windowStart}–${c.contract.windowEnd}` },
    { title: "时长", render: (_, c) => `${c.contract.duration} 分钟` },
    { title: "已播/应播", render: (_, c) => `${c.aired}/${c.contract.requiredCount}` },
    { title: "计划播出", render: (_, c) => c.plannedStart ?? "—" },
    { title: "实际起止", render: (_, c) => c.lastAiring ? <>{hhmmOf(c.lastAiring.actualStart)}–{hhmmOf(c.lastAiring.actualEnd)} <Tag>{c.lastAiring.source}</Tag></> : "—" },
    { title: "偏差", render: (_, c) => c.deviationMin != null ? `${c.deviationMin} 分钟` : "—" },
    { title: "兑现结论", render: (_, c) => <span title={c.detail}><Tag color={statusColor[c.status]}>{c.status}</Tag></span> },
    {
      title: "操作",
      render: (_, c) => <div className="row-actions">
        <Button size="small" disabled={readOnly} onClick={() => setAiringFor(c)}>登记播出</Button>
        <Button size="small" disabled={readOnly} onClick={() => setReceiptFor(c)}>录入回执</Button>
        <Button size="small" disabled={readOnly} onClick={() => setContractFor(c.contract)}>合同</Button>
      </div>
    }
  ];

  return <div className="ledger-stack">
    <div className="ledger-summary">
      <span><b>{ads.contracts.length}</b> 份合同</span>
      <span><b>{conclusions.filter((c) => c.status === "已兑现").length}</b> 已兑现</span>
      <span><b>{conclusions.filter((c) => c.flagged).length}</b> 漏播/偏差</span>
      <span><b>{waiting.length + ads.makeGood.filter((e) => e.status === "已排期").length}</b> 补播待办</span>
      <span><b>{disputed.length}</b> 回执待核对</span>
    </div>
    {stale
      ? <Alert type="warning" showIcon message="串联单或播出日志已变更，旧兑现结论失效，正在按新计划重算…" />
      : <Alert type="success" showIcon message="台账结论已与当前计划、本地播出日志对账重算。" />}
    <Card title="广告兑现台账">
      <Table<Conclusion> dataSource={conclusions} columns={columns} rowKey={(c) => c.contract.id} pagination={false} size="middle" locale={{ emptyText: "串联单中还没有广告条目" }} />
    </Card>
    <div className="two-panels">
      <Card title="补播队列" extra={<small>时段容量用满即排队等位 · 已完成 {doneCount} 条</small>}>
        <div className="slot-grid">
          {ads.slots.map((slot) => {
            const entries = ads.makeGood.filter((entry) => entry.slotId === slot.id && entry.status === "已排期");
            return <div className="slot-card" key={slot.id}>
              <div><b>{slot.label}</b> <small>{slot.start}–{slot.end}</small></div>
              <Progress percent={(entries.length / slot.capacity) * 100} size="small" format={() => `${entries.length}/${slot.capacity}`} />
              {entries.map((entry) => <div className="queue-entry" key={entry.id}>
                <Tag color="orange">{entry.reason}</Tag>
                <b>{advertiserOf(entry.contractId)}</b>
                <Button size="small" type="primary" disabled={readOnly} onClick={() => { dispatch(completeMakeGood(entry.id)); message.success("已登记补播并回写播出日志"); }}>补播完成</Button>
              </div>)}
              {!entries.length && <small>空闲</small>}
            </div>;
          })}
        </div>
        <h4>排队等位（{waiting.length}）</h4>
        {waiting.length ? waiting.map((entry) => <div className="queue-entry" key={entry.id}>
          <Tag color="red">{entry.reason}</Tag><b>{advertiserOf(entry.contractId)}</b><small>{entry.detail}</small>
        </div>) : <p className="muted">没有等位的补播。</p>}
      </Card>
      <Card title="合同方回执对账" extra={<small>差异两条都留，等主编核对</small>}>
        {ads.confirmations.length ? ads.confirmations.map((entry) => {
          const airing = [...ads.airings].reverse().find((candidate) => candidate.contractId === entry.contractId);
          return <article className="receipt-row" key={entry.id}>
            <div>
              <b>{advertiserOf(entry.contractId)}</b>
              <small>回执 {entry.remoteStart}–{entry.remoteEnd} · 本地 {airing ? `${hhmmOf(airing.actualStart)}–${hhmmOf(airing.actualEnd)}` : "无记录"} · 收到 {format(new Date(entry.receivedAt), "HH:mm:ss")}</small>
              {entry.diffNote && <small className="danger-text">{entry.diffNote}</small>}
              {entry.status === "已确认" && <small>{entry.resolution} · {entry.resolvedBy} · {entry.resolvedAt ? format(new Date(entry.resolvedAt), "HH:mm:ss") : ""}</small>}
            </div>
            <Tag color={receiptColor[entry.status]}>{entry.status}</Tag>
            {entry.status === "有差异" && role === "主编" && <div className="row-actions">
              <Button size="small" onClick={() => dispatch(resolveConfirmation({ id: entry.id, resolution: "以本地为准" }))}>以本地为准</Button>
              <Button size="small" onClick={() => dispatch(resolveConfirmation({ id: entry.id, resolution: "以回执为准" }))}>以回执为准</Button>
            </div>}
            {entry.status === "有差异" && role !== "主编" && <small className="muted">等主编核对</small>}
          </article>;
        }) : <p className="muted">暂无回执。在台账行上点「录入回执」模拟合同方回传。</p>}
      </Card>
    </div>

    <Modal key={airingFor?.contract.id ?? "airing"} open={!!airingFor} title={`登记实际播出 · ${airingFor?.contract.advertiser ?? ""}`} okText="登记并对账" onCancel={() => setAiringFor(null)} onOk={() => airingForm.submit()}>
      <Form form={airingForm} layout="vertical" initialValues={{ start: airingFor?.plannedStart ?? "", end: airingFor?.plannedStart ? hhmmOfMinutes(minutesOf(airingFor.plannedStart) + airingFor.contract.duration) : "" }} onFinish={(values) => {
        if (!airingFor) return;
        dispatch(recordAiring({ contractId: airingFor.contract.id, actualStart: toISO(values.start), actualEnd: toISO(values.end) }));
        const item = items.find((entry) => entry.id === airingFor.contract.itemId);
        if (item && item.status !== "已播出") dispatch(updateStatus({ id: item.id, status: "已播出" }));
        message.success("已登记实际起止，并与本地播出日志对账");
        setAiringFor(null);
      }}>
        <Form.Item name="start" label="实际开始（HH:mm）" rules={[hhmmRule]}><Input placeholder="08:30" /></Form.Item>
        <Form.Item name="end" label="实际结束（HH:mm）" rules={[hhmmRule]}><Input placeholder="08:33" /></Form.Item>
      </Form>
    </Modal>

    <Modal key={receiptFor?.contract.id ?? "receipt"} open={!!receiptFor} title={`录入合同方回执 · ${receiptFor?.contract.advertiser ?? ""}`} okText="登记回执" onCancel={() => setReceiptFor(null)} onOk={() => receiptForm.submit()}>
      <Form form={receiptForm} layout="vertical" initialValues={{ start: receiptFor?.lastAiring ? hhmmOf(receiptFor.lastAiring.actualStart) : "", end: receiptFor?.lastAiring ? hhmmOf(receiptFor.lastAiring.actualEnd) : "" }} onFinish={(values) => {
        if (!receiptFor) return;
        dispatch(receiveConfirmation({ contractId: receiptFor.contract.id, remoteStart: values.start, remoteEnd: values.end }));
        message.success("回执已登记，对账结果见下方列表");
        setReceiptFor(null);
      }}>
        <Form.Item name="start" label="回执开始（HH:mm）" rules={[hhmmRule]}><Input placeholder="08:30" /></Form.Item>
        <Form.Item name="end" label="回执结束（HH:mm）" rules={[hhmmRule]}><Input placeholder="08:33" /></Form.Item>
      </Form>
    </Modal>

    <Modal key={contractFor?.id ?? "contract"} open={!!contractFor} title="合同信息" okText="保存" onCancel={() => setContractFor(null)} onOk={() => contractForm.submit()}>
      <Form form={contractForm} layout="vertical" initialValues={contractFor ?? {}} onFinish={(values) => {
        if (!contractFor) return;
        if (values.windowEnd <= values.windowStart) { message.error("窗口结束需晚于开始"); return; }
        dispatch(upsertContract({ ...contractFor, ...values, note: undefined }));
        message.success("合同已更新，兑现结论随计划重算");
        setContractFor(null);
      }}>
        <Form.Item name="advertiser" label="广告主" rules={[{ required: true, message: "请填写广告主" }]}><Input /></Form.Item>
        <div className="two-cols">
          <Form.Item name="windowStart" label="窗口开始" rules={[hhmmRule]}><Input placeholder="08:30" /></Form.Item>
          <Form.Item name="windowEnd" label="窗口结束" rules={[hhmmRule]}><Input placeholder="09:00" /></Form.Item>
        </div>
        <div className="two-cols">
          <Form.Item name="duration" label="合同时长" rules={[{ required: true }]}><InputNumber min={1} max={60} addonAfter="分钟" /></Form.Item>
          <Form.Item name="requiredCount" label="应播次数" rules={[{ required: true }]}><InputNumber min={1} max={20} addonAfter="次" /></Form.Item>
        </div>
      </Form>
    </Modal>
  </div>;
}
