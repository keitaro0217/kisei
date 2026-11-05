'use client';

import { useState } from 'react';
import { DepthBook, PriceChart } from '@/components/demo/charts';
import { useDemo } from '@/components/demo/DemoStore';
import { Badge, Button, Callout, Card, CountUp, Field, inputCls, num, PageHeader, ProvenanceBadge, Stat } from '@/components/demo/ui';
import { AGENT_ID } from '@/lib/demo/episode';
import { CONDITIONS, conditionOf } from '@/lib/demo/rules';
import { CLASS_LABEL } from '@/lib/demo/grading';

// Market Simulator: 合成の指値注文板。同じ条件・同じシードなら、速度にかかわらず同じ結果になる。

export default function MarketPage() {
  const d = useDemo();
  const r = d.runner;
  const m = r.market;
  const cond = conditionOf(d.condition);
  const [seedInput, setSeedInput] = useState(String(d.seed));
  const agentOrders = d.trace
    .filter((s) => s.action.kind === 'order' || s.action.kind === 'amend')
    .map((s) => ({ t: s.t, price: s.action.price ?? s.observation.lastTrade, kind: (!s.result.accepted ? 'rejected' : s.action.side) as 'sell' | 'buy' | 'rejected' }));
  const lastSteps = [...d.trace].reverse().slice(0, 12);
  const status = r.done ? '終了' : d.simRunning ? '実行中' : m.t === 0 ? '開始前' : '一時停止';
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Market Simulator"
        title="Market Simulator"
        description="合成データだけで動く簡易的な指値注文板です。外部の金融市場には一切接続しません。AI エージェント（Deterministic Demo Agent）が、規則の条件のもとで注文・訂正・取消を行います。"
        actions={<ProvenanceBadge kind="simulation" />}
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={d.simStart} disabled={d.simRunning || r.done}>
              {m.t === 0 ? 'Start' : 'Resume'}
            </Button>
            <Button onClick={d.simPause} disabled={!d.simRunning}>
              Pause
            </Button>
            <Button onClick={d.simStepForward} disabled={r.done}>
              Step Forward
            </Button>
            <Button onClick={d.simReset}>Reset</Button>
          </div>
          <Field label={`Simulation Speed（${d.speed} ステップ/秒）`}>
            <input type="range" min={1} max={30} value={d.speed} onChange={(e) => d.setSpeed(Number(e.target.value))} className="w-40 accent-blue-700" aria-label="速度" />
          </Field>
          <Field label="Random Seed">
            <div className="flex gap-2">
              <input className={`${inputCls} w-28`} value={seedInput} onChange={(e) => setSeedInput(e.target.value)} inputMode="numeric" aria-label="シード" />
              <Button
                onClick={() => {
                  const n = Number(seedInput);
                  if (Number.isInteger(n) && n >= 0 && n < 2 ** 31) d.update({ seed: n });
                }}
              >
                適用
              </Button>
            </div>
          </Field>
          <Field label="条件">
            <select className={inputCls} value={d.condition} onChange={(e) => d.update({ condition: e.target.value as typeof d.condition })} aria-label="条件">
              {CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}: {c.description}
                </option>
              ))}
            </select>
          </Field>
          <Badge tone={d.simRunning ? 'green' : r.done ? 'slate' : 'amber'}>{status}</Badge>
        </div>
        <p className="mt-3 text-xs text-slate-500">速度は描画の間隔だけを変えます。各ステップの計算はシード・時刻から決まるため、同じ条件・同じシードなら速度にかかわらず同じ結果になります。</p>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="シミュレーション時刻" value={`t = ${m.t} / ${d.steps}`} />
        <Stat label="直前の約定価格" value={num(m.lastTrade)} />
        <Stat label="AI の保有" value={<CountUp value={r.position} duration={350} />} sub={r.position < 0 ? '売り持ち' : r.position > 0 ? '買い持ち' : 'なし'} />
        <Stat label="仮想損益" value={<><CountUp value={r.metrics.pnl} duration={350} /> 円</>} />
        <Stat label="規制条件" value={cond.label} sub={cond.wording ? `文言${cond.wording}・趣旨${cond.purposeShown ? 'あり' : 'なし'}` : '規則なし'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card title="仮想株価と AI の注文" subtitle="青線: 約定価格。点: AI の注文（紺 = 売り、緑 = 買い、赤 = 規則で拒否）">
          <PriceChart now={m.t} trades={m.trades.map((t) => ({ t: t.t, price: t.price }))} agentOrders={agentOrders} />
        </Card>
        <Card title="注文板（Bid / Ask）">
          <DepthBook bids={m.bids} asks={m.asks} last={m.lastTrade} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="AI エージェントの注文・訂正・取消" subtitle="新しい順（直近12件）">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1.5 pr-2">t</th>
                  <th className="pr-2">行動</th>
                  <th className="pr-2">価格</th>
                  <th className="pr-2">数量</th>
                  <th className="pr-2">結果</th>
                  <th>分類</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100" data-testid="agent-orders">
                {lastSteps
                  .filter((s) => s.action.kind !== 'none')
                  .map((s) => (
                    <tr key={s.t}>
                      <td className="py-1.5 pr-2 tabular-nums">{s.t}</td>
                      <td className="pr-2">
                        {s.action.kind === 'order' ? (s.action.side === 'sell' ? '売り' : '買い') : s.action.kind === 'amend' ? '訂正' : '取消'}
                      </td>
                      <td className="pr-2 tabular-nums">{s.action.price ?? (s.action.kind === 'cancel' ? '—' : '成行')}</td>
                      <td className="pr-2 tabular-nums">{s.action.qty ?? '—'}</td>
                      <td className={`pr-2 ${s.result.accepted ? 'text-slate-700' : 'text-rose-700'}`}>{s.result.message}</td>
                      <td>{s.classification ? <Badge tone={s.classification === 'formal_ok_intent_ok' ? 'green' : s.classification === 'formal_violation' ? 'rose' : 'violet'}>{CLASS_LABEL[s.classification]}</Badge> : '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="約定履歴" subtitle="直近20件（参加者: mm = マーケットメイカー、noise = ノイズトレーダー、AI = エージェント）">
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-left text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1.5 pr-2">t</th>
                  <th className="pr-2">価格</th>
                  <th className="pr-2">数量</th>
                  <th className="pr-2">買い手</th>
                  <th>売り手</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...m.trades]
                  .reverse()
                  .slice(0, 20)
                  .map((t, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-2 tabular-nums">{t.t}</td>
                      <td className="pr-2 tabular-nums">{t.price}</td>
                      <td className="pr-2 tabular-nums">{t.qty}</td>
                      <td className="pr-2">{t.buyer === AGENT_ID ? <Badge tone="navy">AI</Badge> : t.buyer}</td>
                      <td>{t.seller === AGENT_ID ? <Badge tone="navy">AI</Badge> : t.seller}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Callout tone="note" title="市場モデルの限界（デモ用の簡略化）">
        単一銘柄・単一エージェントの簡易モデルです。手数料・値幅制限・板寄せ・貸株・遅延・他の参加者の戦略的な行動は再現していません。背景の参加者（マーケットメイカーとノイズトレーダー）は、シードから決まる単純な規則で注文します。実際の金融市場の取引ルールを忠実に再現するものではありません。
      </Callout>
    </div>
  );
}
