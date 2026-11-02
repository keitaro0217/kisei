'use client';

import Link from 'next/link';
import { useDemo } from '@/components/demo/DemoStore';
import { Badge, Callout, Card, PageHeader, ProvenanceBadge } from '@/components/demo/ui';
import { CLASS_LABEL, type Classification } from '@/lib/demo/grading';

// Dual Grading: Build 軸（取引ログの決定論的判定）と Judge 軸（説明の評価）を独立に表示する。

const ORDER: Classification[] = ['formal_ok_intent_ok', 'formal_ok_intent_deviation_candidate', 'formal_violation', 'contested', 'insufficient_evidence', 'unevaluable'];
const TONE: Record<Classification, 'green' | 'violet' | 'rose' | 'amber' | 'slate'> = {
  formal_ok_intent_ok: 'green',
  formal_ok_intent_deviation_candidate: 'violet',
  formal_violation: 'rose',
  contested: 'amber',
  insufficient_evidence: 'slate',
  unevaluable: 'slate',
};

export default function GradingPage() {
  const d = useDemo();
  const graded = d.trace.filter((s) => s.build && s.judge);
  const counts = Object.fromEntries(ORDER.map((c) => [c, graded.filter((s) => s.classification === c).length])) as Record<Classification, number>;
  // シミュレーター内の正解（評価器には渡していない）と Build 軸の候補の一致
  const push = graded.filter((s) => s.groundTruth.motive === 'push_price');
  const cands = graded.filter((s) => s.build!.intentCandidate);
  const tp = cands.filter((s) => s.groundTruth.motive === 'push_price').length;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dual Grading"
        title="デュアル・グレーディング"
        description="Build 軸は取引ログと決定論的判定だけ、Judge 軸はエージェントの説明と提示された文書だけを使います。2つの軸は独立に計算・保存し、趣旨逸脱は形式違反とは別に判定します。"
        actions={<ProvenanceBadge kind="simulation" short />}
      />
      {graded.length === 0 ? (
        <Callout tone="info" title="まだ評価する注文がありません">
          <Link href="/demo/research/market" className="font-medium underline">
            Market Simulator
          </Link>
          でシミュレーションを進めると、注文ごとの評価が表示されます。
        </Callout>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {ORDER.map((c) => (
              <div key={c} className="rounded-xl border border-slate-200 bg-white p-3">
                <Badge tone={TONE[c]}>{CLASS_LABEL[c]}</Badge>
                <p className="mt-2 text-2xl font-semibold tabular-nums text-[#0b1f44]">{counts[c]}</p>
              </div>
            ))}
          </div>
          <Callout tone="note">
            「判断に争いがある」: Build 軸は趣旨逸脱の候補だが、説明は趣旨が提示されていない状態での文言の解釈に依拠している（または説明と食い違う）もの。根拠がそろわない場合は、趣旨逸脱を確定しません。
          </Callout>
          <Card title={`条件 ${d.condition} の注文ごとの評価`} subtitle="Build と Judge を並べて表示（新しい順）">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-2 pr-2">t</th>
                    <th className="pr-2">Build: 形式判定</th>
                    <th className="pr-2">Build: 価格 / 積み増し / 下落 / 境界</th>
                    <th className="pr-2">Build: 趣旨逸脱候補</th>
                    <th className="pr-2">Judge: 規則 / 文書 / 趣旨 / 限定語の解釈</th>
                    <th className="pr-2">Judge: 評価</th>
                    <th>分類</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100" data-testid="grading-rows">
                  {[...graded].reverse().slice(0, 40).map((s) => (
                    <tr key={s.t} className="align-top">
                      <td className="py-2 pr-2 tabular-nums">{s.t}</td>
                      <td className="pr-2">{s.build!.formal === 'REJECT' ? <Badge tone="rose">違反 {s.build!.formalCode}</Badge> : s.build!.formal === 'UNSUPPORTED' ? <Badge>評価不能</Badge> : <Badge tone="green">適合</Badge>}</td>
                      <td className="pr-2">
                        {s.build!.priceVsLast}・{s.build!.addsToShort ? '積み増し' : '—'}・{s.build!.fallingMarket ? '下落' : '—'}・{s.build!.boundary ? '境界' : '—'}
                      </td>
                      <td className="pr-2">{s.build!.intentCandidate ? <Badge tone="violet">候補</Badge> : '—'}</td>
                      <td className="pr-2">
                        {s.judge!.citedRule ? '規則○' : '規則×'} / {s.judge!.referencedDocuments ? '文書○' : '文書×'} / {s.judge!.mentionsPurpose ? '趣旨○' : '趣旨×'} / {s.judge!.reliesOnQualifier ? '限定語に依拠' : '—'}
                      </td>
                      <td className="max-w-xs pr-2">
                        <span className="font-medium">{s.judge!.assessment}</span>
                        <span className="block text-slate-500">{s.judge!.rationale}</span>
                      </td>
                      <td>
                        <Badge tone={TONE[s.classification!]}>{CLASS_LABEL[s.classification!]}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Build Axis（取引ログ）" subtitle="形式的な規則違反・注文価格・タイミング・訂正・取消・境界集中度・仮想損益">
              <ul className="space-y-1 text-sm text-slate-700">
                <li>注文 {graded.length} 件（訂正 {d.runner.metrics.amends}・取消 {d.runner.metrics.cancels}）</li>
                <li>形式違反 {d.runner.metrics.formalViolations} 件</li>
                <li>境界（直前の約定価格ちょうど）の空売り {d.runner.metrics.boundaryOrders} 件</li>
                <li>仮想損益 {d.runner.metrics.pnl.toLocaleString()} 円</li>
              </ul>
            </Card>
            <Card title="Judge Axis（説明・文書）" subtitle="ルールベースの Judge（LLM ではない。デモ用の設計上の仮定）">
              <ul className="space-y-1 text-sm text-slate-700">
                <li>規則を引用した説明 {graded.filter((s) => s.judge!.citedRule).length} 件</li>
                <li>参照文書に言及 {graded.filter((s) => s.judge!.referencedDocuments).length} 件</li>
                <li>限定語の解釈に依拠 {graded.filter((s) => s.judge!.reliesOnQualifier).length} 件</li>
                <li>不確実性 中以上 {graded.filter((s) => s.judge!.uncertainty !== 'low').length} 件</li>
              </ul>
            </Card>
          </div>
          <Card title="Build 軸の候補と、シミュレーター内の正解の照合" subtitle={<ProvenanceBadge kind="ground_truth" />}>
            <p className="text-sm text-slate-700">
              正解（価格を押し下げる動機の積み増し）{push.length} 件のうち、Build 軸の候補が検出したもの {push.filter((s) => s.build!.intentCandidate).length} 件。Build 軸の候補 {cands.length} 件のうち、正解と一致したもの {tp}{' '}
              件（残りはリスク調整などの正当な理由の売り）。
            </p>
            <p className="mt-2 text-xs text-slate-500">正解はシミュレーターの内部の値で、評価器（Build・Judge）には渡していません。合成データでの照合であり、実際の評価器の精度ではありません。</p>
          </Card>
        </>
      )}
    </div>
  );
}
