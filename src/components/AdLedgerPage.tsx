import { useMemo, useState } from "react";
import { Button, Card, Form, Input, InputNumber, Modal, Select, Table, Tag, Timeline, message } from "antd";
import { format } from "date-fns";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { recalculateAll, reviewDiscrepancy, scheduleMakeup, submitConfirmation, updateContract } from "../store/adLedgerSlice";
import type { AdContract, FulfillmentConclusion } from "../types";

const conclusionColor: Record<FulfillmentConclusion["status"], string> = { fulfilled: "green", missed: "red", deviated: "orange", pending: "default" };
const conclusionLabel: Record<FulfillmentConclusion["status"], string> = { fulfilled: "已兑现", missed: "漏播", deviated: "偏差过大", pending: "待播" };

function useItemTitle() {
  const items = useAppSelector((state) => state.rundown.items);
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) map.set(item.id, item.title);
    return (itemId: string) => map.get(itemId) ?? itemId;
  }, [items]);
}

function ContractsCard() {
  const dispatch = useAppDispatch();
  const ledger = useAppSelector((state) => state.adLedger);
  const titleOf = useItemTitle();
  const [editing, setEditing] = useState<AdContract | null>(null);
  const [form] = Form.useForm();

  const openEdit = (contract: AdContract) => {
    setEditing(contract);
    form.setFieldsValue({ client: contract.client, windowStart: contract.windowStart, windowEnd: contract.windowEnd, duration: contract.duration, requiredCount: contract.requiredCount });
  };

  const submitEdit = () => {
    if (!editing) return;
    const values = form.getFieldsValue();
    dispatch(updateContract({ itemId: editing.itemId, changes: values }));
    message.success("合同已更新，兑现结论已重算");
    setEditing(null);
  };

  return <Card title="广告合同与兑现结论" extra={<Button onClick={() => dispatch(recalculateAll())}>全部重算</Button>}>
    <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={ledger.contracts}
      columns={[
        { title: "广告条目", dataIndex: "itemId", render: (id: string) => <b>{titleOf(id)}</b> },
        { title: "广告主", dataIndex: "client" },
        { title: "合同窗口", render: (_: unknown, c: AdContract) => <span>{c.windowStart}–{c.windowEnd}</span> },
        { title: "时长(分)", dataIndex: "duration" },
        { title: "应播", dataIndex: "requiredCount" },
        { title: "实播", render: (_: unknown, c: AdContract) => {
          const recs = ledger.records.filter((r) => r.contractId === c.id && r.source === "local");
          return recs.length;
        } },
        { title: "兑现状态", render: (_: unknown, c: AdContract) => {
          const conclusion = ledger.conclusions.find((x) => x.contractId === c.id);
          if (!conclusion) return <Tag>待计算</Tag>;
          return <span><Tag color={conclusionColor[conclusion.status]}>{conclusionLabel[conclusion.status]}</Tag>{conclusion.stale && <Tag color="default">待重算</Tag>}</span>;
        } },
        { title: "偏差(分)", render: (_: unknown, c: AdContract) => {
          const conclusion = ledger.conclusions.find((x) => x.contractId === c.id);
          return conclusion?.deviationMinutes ?? 0;
        } },
        { title: "操作", render: (_: unknown, c: AdContract) => <Button size="small" onClick={() => openEdit(c)}>编辑合同</Button> }
      ]}
      expandable={{ expandedRowRender: (c: AdContract) => <RecordList contractId={c.id} /> }}
    />
    <Modal title="编辑广告合同" open={!!editing} onOk={submitEdit} onCancel={() => setEditing(null)} okText="保存并重算" cancelText="取消">
      <Form form={form} layout="vertical">
        <Form.Item label="广告主" name="client"><Input /></Form.Item>
        <div className="two-cols">
          <Form.Item label="窗口开始" name="windowStart"><Input placeholder="HH:mm" /></Form.Item>
          <Form.Item label="窗口结束" name="windowEnd"><Input placeholder="HH:mm" /></Form.Item>
        </div>
        <div className="two-cols">
          <Form.Item label="合同时长(分钟)" name="duration"><InputNumber min={1} max={120} style={{ width: "100%" }} /></Form.Item>
          <Form.Item label="应播次数" name="requiredCount"><InputNumber min={1} max={20} style={{ width: "100%" }} /></Form.Item>
        </div>
      </Form>
    </Modal>
  </Card>;
}

function RecordList({ contractId }: { contractId: string }) {
  const records = useAppSelector((state) => state.adLedger.records.filter((r) => r.contractId === contractId));
  if (!records.length) return <small>暂无播出记录。</small>;
  return <Timeline items={records.map((r) => ({
    color: r.source === "local" ? "blue" : "purple",
    children: <div>
      <Tag color={r.source === "local" ? "blue" : "purple"}>{r.source === "local" ? "本地日志" : "合同方回传"}</Tag>
      <Tag color={r.status === "confirmed" ? "green" : r.status === "discrepancy" ? "red" : r.status === "late" ? "default" : "orange"}>
        {r.status === "confirmed" ? "已确认" : r.status === "discrepancy" ? "差异" : r.status === "late" ? "晚到" : "待确认"}
      </Tag>
      <b>{r.actualStart}–{r.actualEnd}</b>
      {r.note && <small style={{ color: "#9b3b20", marginLeft: 8 }}>{r.note}</small>}
      <small style={{ color: "#6b7485", marginLeft: 8 }}>{format(new Date(r.receivedAt), "MM-dd HH:mm")}</small>
    </div>
  }))} />;
}

function MakeupCard() {
  const dispatch = useAppDispatch();
  const ledger = useAppSelector((state) => state.adLedger);
  const titleOf = useItemTitle();
  return <Card title="补播队列" extra={<span>时段容量 {ledger.makeupSlots.reduce((s, x) => s + x.capacity, 0)} · 已用 {ledger.makeupSlots.reduce((s, x) => s + x.booked, 0)}</span>}>
    <div className="slot-row">
      {ledger.makeupSlots.map((slot) => <Tag key={slot.id} color={slot.booked >= slot.capacity ? "red" : "green"}>{slot.slot} · {slot.booked}/{slot.capacity}</Tag>)}
    </div>
    {!ledger.makeupQueue.length ? <p>当前没有待补播的广告。</p> : <Table
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={ledger.makeupQueue}
      columns={[
        { title: "广告条目", render: (_: unknown, e) => <b>{titleOf(e.itemId)}</b> },
        { title: "原因", render: (_: unknown, e) => <Tag color={e.reason === "missed" ? "red" : "orange"}>{e.reason === "missed" ? "漏播" : "偏差过大"}</Tag> },
        { title: "状态", render: (_: unknown, e) => e.status === "queued" ? <Tag>排队等位置</Tag> : <Tag color="blue">已安排 {e.scheduledSlot}</Tag> },
        { title: "操作", render: (_: unknown, e) => e.status === "queued"
          ? <Button size="small" onClick={() => { dispatch(scheduleMakeup(e.id)); message.success("已尝试安排补播时段"); }}>安排补播</Button>
          : <Tag color="green">待播出</Tag> }
      ]}
    />}
  </Card>;
}

function DiscrepancyCard() {
  const dispatch = useAppDispatch();
  const ledger = useAppSelector((state) => state.adLedger);
  const titleOf = useItemTitle();
  const pending = ledger.discrepancies.filter((d) => d.status === "pending");
  return <Card title="差异核对（合同方回传 vs 本地记录）" extra={pending.length ? <Tag color="red">{pending.length} 条待核对</Tag> : undefined}>
    {!pending.length ? <p>当前没有待核对的差异。</p> : pending.map((d) => <article key={d.id} className="disc-row">
      <div className="disc-head"><b>{titleOf(d.itemId)}</b><Tag color="red">待主编核对</Tag></div>
      <div className="disc-cols">
        <div><small>本地记录</small><p>{d.localValue}</p></div>
        <div><small>合同方回传</small><p>{d.confirmationValue}</p></div>
      </div>
      <div className="disc-actions">
        <Button size="small" type="primary" onClick={() => { dispatch(reviewDiscrepancy({ discrepancyId: d.id, resolution: "accept_local" })); message.success("已采纳本地记录"); }}>采纳本地</Button>
        <Button size="small" onClick={() => { dispatch(reviewDiscrepancy({ discrepancyId: d.id, resolution: "accept_confirmation" })); message.success("已采纳合同方回传"); }}>采纳合同方</Button>
      </div>
    </article>)}
  </Card>;
}

function ReceiptCard() {
  const dispatch = useAppDispatch();
  const adItems = useAppSelector((state) => state.rundown.items.filter((i) => i.type === "广告"));
  const [itemId, setItemId] = useState(adItems[0]?.id ?? "");
  const [actualStart, setActualStart] = useState("08:00");
  const [actualEnd, setActualEnd] = useState("08:03");
  return <Card title="合同方回传播出确认">
    <Form layout="vertical" onFinish={() => {
      if (!itemId) { message.warning("请选择广告条目"); return; }
      dispatch(submitConfirmation({ itemId, actualStart, actualEnd }));
      message.success("回执已录入，已与本地记录对账");
    }}>
      <Form.Item label="广告条目"><Select value={itemId} onChange={setItemId} options={adItems.map((i) => ({ value: i.id, label: i.title }))} /></Form.Item>
      <div className="two-cols">
        <Form.Item label="实际开始"><Input value={actualStart} onChange={(e) => setActualStart(e.target.value)} placeholder="HH:mm" /></Form.Item>
        <Form.Item label="实际结束"><Input value={actualEnd} onChange={(e) => setActualEnd(e.target.value)} placeholder="HH:mm" /></Form.Item>
      </div>
      <Button htmlType="submit" type="primary" block>录入回执并对账</Button>
    </Form>
  </Card>;
}

export default function AdLedgerPage() {
  return <div className="page-grid ledger-grid">
    <div className="side-stack">
      <ContractsCard />
      <MakeupCard />
    </div>
    <div className="side-stack">
      <DiscrepancyCard />
      <ReceiptCard />
    </div>
  </div>;
}
