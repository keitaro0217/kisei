'use client';

import { useState } from 'react';
import { useDemo } from '@/components/demo/DemoStore';
import { Badge, Button, Callout, Card, download, PageHeader, ProvenanceBadge } from '@/components/demo/ui';
import { AGENT_ID } from '@/lib/demo/episode';
import { CLASS_LABEL } from '@/lib/demo/grading';

// Agent Trace: エージェントの動作サイクル（市場観測 → 規制確認 → 取引判断 → 注文実行 → 損益確認 → 再判断）。
// 記録するのは観測・参照した文書・行動・結果・判定・説明で、LLM の非公開の思考過程は扱わない。

const STAGES = ['市場観測', '規制確認', '取引判断', '注文実行', '損益確認', '再判断'];

export default function TracePage() {
  const d = useDemo();
  const [selected, setSelected] = useState<number | null>(null);
  const steps = d.trace;
  const shown = [...steps].reverse().slice(0, 40);
  const cur = selected !== null ? steps.find((s) => s.t === selected) : steps[steps.length - 1];
  const episodeId = `${d.runId}/${d.condition}/seed-${d.seed}`;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Agent Trace"
        title="Agent Trace"
        description="各ステップで、エージェントが何を観測し、どの規則・文書を参照し、何を判断・実行し、どんな結果になったかを時系列で記録します。"
        actions={
          <>
            <ProvenanceBadge kind="simulation" short />
            <Button size="sm" disabled={!steps.length} onClick={() => download(`trace-${episodeId.replace(/\//g, '_')}.json`, JSON.stringify({ runId: d.runId, episodeId, agentId: AGENT_ID, steps }, null, 2), 'application/json')}>
              トレースを JSON で保存
            </Button>
          </>
        }
      />
      <Card title="エージェントの実行モード">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border-2 border-blue-600 bg-blue-50/40 p-4">
            <div className="flex items-center gap-2">
              <Badge tone="blue">使用中</Badge>
              <p className="font-semibold text-[#1e2a4a]">A. Deterministic Demo Agent</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">外部 API を使わず、設定済みの方策とシードに従って行動します。説明文はアプリがテンプレートから生成したもので、LLM の出力ではありません。</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 opacity-70" aria-disabled>
            <div className="flex items-center gap-2">
              <Badge>無効</Badge>
              <p className="font-semibold text-slate-600">B. Real LLM Agent</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              このデモでは実 LLM には接続しません（API キー・実行予算・利用者の許可が必要）。実 LLM での実験は Kisei の研究コンソール（/research）で、承認された予算の範囲で実行します。架空のモデル実行履歴は表示しません。
            </p>
          </div>
        </div>
      </Card>
      {steps.length === 0 ? (
        <Callout tone="info" title="まだトレースがありません">
          Market Simulator で Start または Step Forward を押すと、エージェントの行動がここに記録されます。
        </Callout>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <Card title="タイムライン" subtitle={`${steps.length} ステップ（新しい順・直近40件）`}>
            <ol className="max-h-[560px] space-y-1 overflow-y-auto" data-testid="trace-timeline">
              {shown.map((s) => (
                <li key={s.t}>
                  <button
                    type="button"
                    onClick={() => setSelected(s.t)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs ${cur?.t === s.t ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50'}`}
                  >
                    <span className="tabular-nums">t={s.t}</span>
                    <span className="truncate px-2 text-slate-600">{s.action.kind === 'none' ? '様子見' : s.toolCall}</span>
                    {s.classification && <span className={`h-2 w-2 shrink-0 rounded-full ${s.classification === 'formal_ok_intent_ok' ? 'bg-emerald-500' : s.classification === 'formal_violation' ? 'bg-rose-500' : 'bg-violet-500'}`} />}
                  </button>
                </li>
              ))}
            </ol>
          </Card>
          {cur && (
            <Card title={`t = ${cur.t} の動作サイクル`} subtitle={`Run ID ${d.runId}・Episode ID ${episodeId}・Agent ID ${AGENT_ID}`}>
              <ol className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {STAGES.map((st, i) => (
                  <li key={st} className="rounded-lg bg-slate-50 px-2 py-2 text-center text-[11px] text-slate-600">
                    <span className="block text-[10px] font-semibold text-blue-700">{i + 1}</span>
                    {st}
                  </li>
                ))}
              </ol>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Item k="Simulation Time" v={`t = ${cur.t}`} />
                <Item k="Rule Version" v={cur.ruleVersion} />
                <Item k="1. Observation（市場観測）" v={`直前の約定価格 ${cur.observation.lastTrade}・最良気配 ${cur.observation.bestBid ?? '—'} / ${cur.observation.bestAsk ?? '—'}・傾き ${cur.observation.trend}・保有 ${cur.observation.position}`} />
                <Item k="2. Retrieved Documents（規制確認）" v={cur.retrievedDocuments.length ? cur.retrievedDocuments.join('、') : 'なし'} />
                <Item k="3. Action（取引判断）" v={cur.action.kind === 'none' ? '様子見' : `${cur.action.kind}${cur.action.side ? ` ${cur.action.side}` : ''}`} />
                <Item k="Action Parameters" v={cur.action.kind === 'none' ? '—' : JSON.stringify({ price: cur.action.price ?? 'market', qty: cur.action.qty, orderId: cur.action.orderId })} />
                <Item k="4. Tool Call（注文実行）" v={<code className="text-xs">{cur.toolCall}</code>} />
                <Item k="Execution Result" v={cur.result.message || '—'} />
                <Item k="5. 損益確認" v={`${cur.pnl.toLocaleString()} 円`} />
                <Item k="Formal Compliance（Build）" v={cur.build ? (cur.build.formal === 'REJECT' ? `違反（${cur.build.formalCode}）` : cur.build.formal === 'UNSUPPORTED' ? '評価不能' : '適合') : '—'} />
                <Item k="Intent Alignment（Judge）" v={cur.judge ? `${cur.judge.assessment}（${cur.judge.rationale}）` : '—'} />
                <Item k="分類" v={cur.classification ? <Badge tone="violet">{CLASS_LABEL[cur.classification]}</Badge> : '—'} />
                <Item k="Token Usage / Model ID" v="—（実 LLM を使っていないため記録なし）" />
              </dl>
              <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-slate-600">Agent Explanation</p>
                  <ProvenanceBadge kind="app_text" />
                </div>
                <p className="mt-2 text-sm text-[#1e2a4a]">{cur.explanation}</p>
                <p className="mt-2 text-[11px] text-slate-500">LLM の非公開の思考過程は表示しません（このデモのエージェントは LLM ではありません）。</p>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Item({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-slate-500">{k}</dt>
      <dd className="mt-0.5 break-words text-slate-800">{v}</dd>
    </div>
  );
}
