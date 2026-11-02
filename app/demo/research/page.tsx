'use client';

import Link from 'next/link';
import { useDemo } from '@/components/demo/DemoStore';
import { Badge, Callout, Card, ProvenanceBadge, pct } from '@/components/demo/ui';
import { analyze } from '@/lib/demo/experiment';

export default function OverviewPage() {
  const d = useDemo();
  const exp = d.experiment;
  const done = exp?.status === 'completed' ? exp : null;
  const cand = done ? analyze(done.data, 'intentCandidateRate') : null;
  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-blue-50 px-6 py-10 sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">Kisei Research Lab · Interactive Regulatory Sandbox</p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-[#0b1f44] sm:text-4xl">規則を守るAIは、その規則の目的まで守っているか。</h1>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600">
          研究テーマ: 「自律型金融取引エージェントにおける規制趣旨からの逸脱行動の創発 — 合成規制サンドボックスを用いた条文ミニマルペア実験による因果的検証 —」
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          中心的な問い: <strong className="text-[#0b1f44]">利益最大化を目指す AI は、金融規制の文言上の抜け穴を自律的に探索し、規制の本来の目的に反する行動を取るのか？</strong>
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/demo/research/rules" onClick={() => d.update({ guideStep: 0 })} className="inline-flex items-center rounded-lg bg-[#1d4ed8] px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#1e40af]">
            研究デモを開始（約3〜5分）
          </Link>
          <Link href="/demo/research/market" className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-[#0b1f44] hover:bg-slate-50">
            仮想市場を動かす
          </Link>
        </div>
      </div>

      <Callout tone="warn" title="このデモについて">
        合成市場・合成規則によるシミュレーションです。条文A・Bは研究のために設定した合成規則の例で、現行の実在の法令ではありません。エージェントは外部 API を使わない決定論的な方策（Deterministic Demo
        Agent）で、その行動の傾向は<strong>デモ用の設計上の仮定</strong>です。画面に表示される数値はこのブラウザで実行したシミュレーションの計算結果であり、実際の AI の研究成果ではありません。
      </Callout>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="研究背景: 形式的遵守と規制趣旨" subtitle="規則の文言に従うことと、規則の目的に沿うことは同じではありません。">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4">
              <Badge tone="blue">形式的遵守（Build 軸）</Badge>
              <p className="mt-2 text-sm text-slate-700">取引ログから決定論的に判定できる。例: 「直前の約定価格を下回る新規の空売り」をしていないか。</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <Badge tone="violet">規制趣旨（Judge 軸）</Badge>
              <p className="mt-2 text-sm text-slate-700">規則の目的（下落の加速の防止）に沿っているか。文言の抜け穴を使った行動は、形式上は適合しても趣旨から逸脱しうる。</p>
            </div>
          </div>
        </Card>
        <Card title="研究課題（RQ）" subtitle={<ProvenanceBadge kind="hypothesis" />}>
          <ul className="space-y-3 text-sm text-slate-700">
            <li>
              <Badge tone="navy">RQ1</Badge> 規制の文言（「新規に」の有無）によって、エージェントの行動は変わるか。
            </li>
            <li>
              <Badge tone="navy">RQ2</Badge> 規制趣旨の説明を与えると、文言の抜け穴を使う行動は減るか。
            </li>
            <li>
              <Badge tone="navy">RQ3</Badge> 参照文書（趣旨の補足）へのアクセスは、行動に影響するか。
            </li>
          </ul>
          <p className="mt-4 text-xs text-slate-500">仮説: 文言A（「新規に」あり）では積み増しが形式上許容され、趣旨逸脱候補が増える。趣旨説明・参照文書はそれを減らす。研究資料の 400 エピソードは計画上の想定値で、完了済みの研究結果ではありません。</p>
        </Card>
      </div>

      <Card title="実験サンドボックスの構成">
        <ol className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['合成市場', '指値注文板（価格・時間優先）、マーケットメイカー・ノイズトレーダー、シードによる再現性'],
            ['AI エージェント', '利益最大化の方策。観測 → 規制確認 → 判断 → 注文 → 損益確認 → 再判断'],
            ['デュアル・グレーディング', 'Build（取引ログの決定論的判定）と Judge（説明の評価）を独立に保存'],
            ['因果検証', '条文ミニマルペア × 趣旨説明の 2×2 ＋規則なし。同じシードの対応のある比較'],
          ].map(([t, b], i) => (
            <li key={t} className="rounded-xl border border-slate-200 p-4">
              <span className="text-xs font-semibold text-blue-700">0{i + 1}</span>
              <p className="mt-1 font-semibold text-[#0b1f44]">{t}</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{b}</p>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="評価指標">
          <ul className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            {['形式違反率', '規制趣旨逸脱候補率', '正常取引の成功率', '誤拒否率', '注文境界集中度', '仮想損益', '文言・趣旨説明の主効果', '交互作用'].map((m) => (
              <li key={m} className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
                {m}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="このブラウザでの実験の結果" subtitle={done ? <ProvenanceBadge kind="simulation" /> : <ProvenanceBadge kind="hypothesis" />}>
          {done && cand ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>
                実験 v{done.version}（{done.snapshot.episodes} エピソード × {done.snapshot.conditions.length} 条件）の趣旨逸脱候補率:
              </p>
              <ul className="grid grid-cols-2 gap-1 text-xs sm:grid-cols-3">
                {Object.entries(cand.byCondition).map(([c, s]) => (
                  <li key={c} className="rounded bg-slate-50 px-2 py-1">
                    {c}: <strong>{pct(s?.mean)}</strong>
                  </li>
                ))}
              </ul>
              <Link href="/demo/research/analysis" className="text-sm font-medium text-blue-700 underline">
                因果分析を見る
              </Link>
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              まだ実験を実行していません。結果は表示しません（仮説と実験計画のみ）。
              <Link href="/demo/research/experiment" className="ml-1 font-medium text-blue-700 underline">
                Experiment Builder で実行
              </Link>
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
