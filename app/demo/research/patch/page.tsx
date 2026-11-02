'use client';

import { useMemo, useState } from 'react';
import { useDemo, type Verification } from '@/components/demo/DemoStore';
import { Badge, Button, Callout, Card, download, num, PageHeader, pct, ProvenanceBadge } from '@/components/demo/ui';
import { configHash, METRICS } from '@/lib/demo/experiment';
import { patchCandidates, verifyPatch, type PatchCandidate, type PatchStatus } from '@/lib/demo/patches';
import type { ConditionId } from '@/lib/demo/rules';

// Auto-Patch & Verify: 修正案をデモ用の合成規則・サンドボックスにだけ適用し、同じシードで再実験して前後を比べる。

/** 修正案ごとの比較（前の条件 → 後の条件） */
function comparisonOf(p: PatchCandidate): { before: ConditionId; after: ConditionId } {
  if (p.id === 'purpose') return { before: 'A-C1', after: 'A-C2' };
  if (p.id === 'exception-hedge') return { before: 'B-C1', after: 'B-C1' };
  return { before: 'A-C1', after: 'A-C1' };
}

const STATUS_LABEL: Record<PatchStatus, string> = { candidate: '候補', reviewed: 'レビュー済み', applied_to_sandbox: 'サンドボックスに適用', verified: '検証済み（比較を実施）', rejected: '却下' };
const DIR: Record<string, { label: string; tone: 'green' | 'rose' | 'slate' | 'amber' }> = {
  improved: { label: '改善（区間が0を含まない）', tone: 'green' },
  worsened: { label: '悪化（区間が0を含まない）', tone: 'rose' },
  uncertain: { label: '不確実／方向の評価なし', tone: 'amber' },
  no_change: { label: '変化なし', tone: 'slate' },
};

export default function PatchPage() {
  const d = useDemo();
  const [generated, setGenerated] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const cands = useMemo(() => patchCandidates(d.rules), [d.rules]);
  const base = { ...d.experimentConfig, rules: d.rules, agent: d.agent };
  const episodes = Math.min(d.experimentConfig.episodes, 60);
  const status = (id: string) => d.patchStatus[id] ?? 'candidate';
  const setStatus = (id: string, s: PatchStatus) => d.update({ patchStatus: { ...d.patchStatus, [id]: s } });
  const verification = (id: string) => [...d.verifications].reverse().find((v) => v.patchId === id);

  const rerun = (p: PatchCandidate) => {
    setBusy(p.id);
    // 描画を待ってから計算（ボタンの状態を先に表示する）
    setTimeout(() => {
      const { before, after } = comparisonOf(p);
      const patched = p.apply(base);
      const r = verifyPatch(base, patched, before, after, episodes);
      const v: Verification = { ...r, patchId: p.id, at: new Date().toISOString(), conditionBefore: before, conditionAfter: after, baseHash: configHash(base), patchedHash: configHash(patched) };
      d.update({ verifications: [...d.verifications, v], patchStatus: { ...d.patchStatus, [p.id]: 'verified' } });
      setBusy(null);
    }, 20);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Auto-Patch & Verify"
        title="修正案の生成と検証"
        description="修正案は、このデモの合成規則とサンドボックスにだけ適用します。修正しただけでは解決とは扱わず、同じ条件・同じシードで再実験し、逸脱候補の変化と、正常な取引への副作用を両方測ります。"
        actions={
          <Button variant="primary" onClick={() => setGenerated(true)}>
            Generate Patch Candidate
          </Button>
        }
      />
      {!generated && !Object.keys(d.patchStatus).length ? (
        <Callout tone="info">「Generate Patch Candidate」を押すと、文言A（「新規に」）の抜け穴に対する修正案を作成します（規則の雛形からの決定論的な生成。LLM による生成ではありません）。</Callout>
      ) : (
        cands.map((p) => {
          const st = status(p.id);
          const v = verification(p.id);
          const cmp = comparisonOf(p);
          return (
            <Card
              key={p.id}
              title={p.title}
              subtitle={`対象: ${p.target}・比較: ${cmp.before} → ${cmp.after}${cmp.before === cmp.after ? '（修正後の規則・設定）' : ''}`}
              actions={
                <>
                  <Badge tone={st === 'verified' ? 'green' : st === 'rejected' ? 'rose' : 'slate'}>{STATUS_LABEL[st]}</Badge>
                  <Button size="sm" disabled={st !== 'candidate'} onClick={() => setStatus(p.id, 'reviewed')}>
                    Review Candidate
                  </Button>
                  <Button size="sm" disabled={st !== 'reviewed'} onClick={() => setStatus(p.id, 'applied_to_sandbox')}>
                    Apply to Sandbox
                  </Button>
                  <Button size="sm" variant="primary" disabled={(st !== 'applied_to_sandbox' && st !== 'verified') || busy === p.id} onClick={() => rerun(p)}>
                    {busy === p.id ? '再実験中…' : 'Rerun & Compare'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={st === 'rejected'} onClick={() => setStatus(p.id, 'rejected')}>
                    却下
                  </Button>
                </>
              }
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-rose-50/60 p-3 text-sm">
                  <p className="text-[11px] font-semibold text-rose-700">Before</p>
                  <p className="mt-1 text-slate-800">{p.before}</p>
                </div>
                <div className="rounded-xl bg-emerald-50/60 p-3 text-sm">
                  <p className="text-[11px] font-semibold text-emerald-700">After</p>
                  <p className="mt-1 text-slate-800">{p.after}</p>
                </div>
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
                <div>
                  <dt className="font-semibold text-slate-500">根拠</dt>
                  <dd>{p.reason}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">想定される影響</dt>
                  <dd>{p.expected}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">副作用のリスク</dt>
                  <dd>{p.sideEffectRisk}</dd>
                </div>
              </dl>
              {v && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <ProvenanceBadge kind="simulation" short />
                    <Badge tone={v.verdict === 'improved' ? 'green' : v.verdict === 'improved_with_side_effects' ? 'amber' : 'slate'}>
                      {v.verdict === 'improved' ? '逸脱候補率は低下（このシミュレーションの範囲で）' : v.verdict === 'improved_with_side_effects' ? '逸脱候補率は低下・副作用あり' : '改善は確認できない'}
                    </Badge>
                    {v.sideEffects.length > 0 && <Badge tone="rose">副作用: {v.sideEffects.join('・')}</Badge>}
                    <span className="text-xs text-slate-500">
                      {v.episodes} エピソード・同じシード・設定 {v.baseHash} → {v.patchedHash}
                    </span>
                    <Button size="sm" onClick={() => download(`verification-${p.id}.json`, JSON.stringify({ patch: { id: p.id, title: p.title, before: p.before, after: p.after }, ...v, kind: 'deterministic_simulation_output' }, null, 2), 'application/json')}>
                      Export Verification Report
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
                      <thead className="text-slate-500">
                        <tr>
                          <th className="py-1.5 pr-2">指標</th>
                          <th className="pr-2">修正前</th>
                          <th className="pr-2">修正後</th>
                          <th className="pr-2">変化（後 − 前）と 95% 区間</th>
                          <th>判定</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100" data-testid={`verify-${p.id}`}>
                        {v.rows.map((r) => {
                          const isRate = METRICS[r.metric].unit === '%';
                          const f = (x: number | null) => (x === null ? '—' : isRate ? pct(x) : `${num(x)}円`);
                          const fd = (x: number) => (isRate ? `${(x * 100).toFixed(1)} pt` : `${num(x)}円`);
                          return (
                            <tr key={r.metric}>
                              <td className="py-1.5 pr-2 font-medium text-[#0b1f44]">{r.label}</td>
                              <td className="pr-2 tabular-nums">{f(r.before.mean)}</td>
                              <td className="pr-2 tabular-nums">{f(r.after.mean)}</td>
                              <td className="pr-2 tabular-nums">
                                {r.change.estimate === null ? '—' : fd(r.change.estimate)}
                                {r.change.ci && ` [${fd(r.change.ci[0])}, ${fd(r.change.ci[1])}]`}
                              </td>
                              <td>
                                <Badge tone={DIR[r.direction].tone}>{DIR[r.direction].label}</Badge>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">「改善」は、このデモの方策・合成市場での、区間が 0 を含まない変化を示すだけです。実際の規則・AI での効果を示すものではありません。</p>
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
