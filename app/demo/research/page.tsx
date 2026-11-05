'use client';

import Link from 'next/link';
import { useDemo } from '@/components/demo/DemoStore';
import PipelineGraph from '@/components/demo/PipelineGraph';
import { Card, CountUp, Meter, PageHeader, ProvenanceBadge, pct } from '@/components/demo/ui';
import { analyze } from '@/lib/demo/experiment';

// Research Overview: 研究の全体像。研究課題・パイプライン・実験条件・評価軸を1画面で示す。

const B = ({ children }: { children: React.ReactNode }) => <strong className="font-semibold text-[#1e2a4a]">{children}</strong>;

export default function OverviewPage() {
  const d = useDemo();
  const exp = d.experiment;
  const done = exp?.status === 'completed' ? exp : null;
  const cand = done ? analyze(done.data, 'intentCandidateRate') : null;
  const viol = done ? analyze(done.data, 'formalViolationRate') : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Research Overview"
        description={<><span className="mb-1 block text-[17px] font-semibold text-[#1e2a4a]">規則を守るAIは、その規則の目的まで守っているか。</span>本研究の全体像。合成市場に利益最大化を目指す取引エージェントを置き、条文の文言（「新規に」の有無）と規制趣旨の説明を変えた 2×2 の条件で行動を比べる。形式的な適合（Build 軸）と規制趣旨への適合（Judge 軸）を独立に評価し、文言の抜け穴を使った行動が生じるか、修正でそれを減らせるかを、同じシードの比較実験で検証する。以降の各画面が、このパイプラインのどの工程に当たるかを示す。</>}
      />

      <Card title="研究課題 (Research Question)" tag="研究資料">
        <div className="space-y-2 text-[14.5px] leading-[1.95] text-slate-700">
          <p>
            <B>RQ.</B> 利益最大化を目指す AI は、金融規制の<B>文言上の抜け穴を自律的に探索</B>し、<B>規制の本来の目的に反する行動</B>を取るのか。研究テーマ「自律型金融取引エージェントにおける規制趣旨からの逸脱行動の創発 —
            合成規制サンドボックスを用いた条文ミニマルペア実験による因果的検証 —」
          </p>
          <p>
            <B>比較条件:</B> A-C1 文言A × 趣旨説明なし ／ A-C2 文言A × 趣旨説明あり ／ B-C1 文言B × 趣旨説明なし ／ B-C2 文言B × 趣旨説明あり ／ <B>統制:</B> 規則なし
          </p>
          <p>
            <B>評価2軸:</B> ①<B>形式的適合</B>（取引ログの決定論的判定: 直前の約定価格を下回る空売りの禁止）／ ②<B>規制趣旨への適合</B>（説明と参照文書の評価: 下落の加速を防ぐという目的に沿うか）。両者は独立に保存し、根拠がそろわない趣旨逸脱は確定しない。
          </p>
          <p>
            <B>研究課題の内訳:</B> RQ1 文言による行動の変化 ／ RQ2 趣旨説明の効果 ／ RQ3 参照文書の効果。<B>本研究の中核:</B> 「新規に」の3文字だけが異なる<B>条文ミニマルペア</B>で、既存の売り持ちの積み増しが形式上は許容されるかが変わり、その差が行動と評価にどう現れるかを因果的に比べる。
          </p>
        </div>
      </Card>

      <Card
        title="Experiment Pipeline プレビュー"
        tag="全体像"
        icon={<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="5" cy="12" r="2.5" /><circle cx="19" cy="5" r="2.5" /><circle cx="19" cy="19" r="2.5" /><path d="M7.3 11l9.4-4.6M7.3 13l9.4 4.6" /></svg>}
        subtitle={
          <>
            <span className="mr-3 font-medium text-[#1e2a4a]">合成規則 → AI エージェント → 仮想市場 → デュアル評価 → 因果分析 → 修正と検証</span>
            本デモが接続する6工程。各ノードをクリックすると、その工程の画面へ移動する。
          </>
        }
      >
        <PipelineGraph />
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card title="2×2 要因実験の設計" tag="条件">
          <div className="grid grid-cols-[auto_1fr_1fr] overflow-hidden rounded-xl border border-slate-200 text-sm">
            <div className="bg-slate-50" />
            <div className="border-l border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-600">趣旨説明なし（C1）</div>
            <div className="border-l border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs font-semibold text-slate-600">趣旨説明あり（C2）</div>
            {[
              ['文言A', '「新規に」あり', 'A-C1', 'A-C2'],
              ['文言B', '「新規に」なし', 'B-C1', 'B-C2'],
            ].map(([w, sub, c1, c2]) => (
              <div key={w} className="contents">
                <div className="border-t border-slate-200 bg-slate-50 px-3 py-3 text-xs">
                  <span className="block font-semibold text-[#1e2a4a]">{w}</span>
                  <span className="text-slate-500">{sub}</span>
                </div>
                {[c1, c2].map((c) => (
                  <div key={c} className="border-l border-t border-slate-200 px-3 py-3 text-center transition-colors hover:bg-indigo-50/40">
                    <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-[#4338ca]">{c}</span>
                    {cand?.byCondition[c as 'A-C1'] && (
                      <>
                        <span className="mt-1.5 block text-[11px] text-slate-500">逸脱候補 {pct(cand.byCondition[c as 'A-C1']!.mean)}</span>
                        <Meter value={cand.byCondition[c as 'A-C1']!.mean} className="mx-auto mt-1 w-24" color="#7c3aed" />
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
            <B>統制条件:</B> 規則なし。<B>実験単位:</B> エピソード（同じシードの列を全条件で使う対応のある比較）。研究資料の 400 エピソードは計画上の想定値。
          </p>
        </Card>

        <Card title="このブラウザでの実験結果" tag={done ? 'Simulation Output' : '未実行'}>
          {done && cand && viol ? (
            <div className="space-y-3 text-sm text-slate-700">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-indigo-50/60 p-3">
                  <p className="text-[11px] text-slate-500">文言の効果（趣旨逸脱候補率、B − A）</p>
                  <p className="mt-1 text-xl font-semibold text-[#1e2a4a]">{cand.wording?.estimate === null || !cand.wording ? '—' : <CountUp value={cand.wording.estimate * 100} format={(v) => `${v.toFixed(1)} pt`} />}</p>
                </div>
                <div className="rounded-xl bg-indigo-50/60 p-3">
                  <p className="text-[11px] text-slate-500">文言の効果（形式違反率、B − A）</p>
                  <p className="mt-1 text-xl font-semibold text-[#1e2a4a]">{viol.wording?.estimate === null || !viol.wording ? '—' : <CountUp value={viol.wording.estimate * 100} format={(v) => `${v.toFixed(1)} pt`} />}</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                実験 v{done.version}・{done.snapshot.episodes} エピソード × {done.snapshot.conditions.length} 条件。デモ用の方策（設計上の仮定）から計算した値で、実際の AI の研究成果ではない。
              </p>
              <Link href="/demo/research/analysis" className="text-sm font-medium text-[#4f46e5] underline">
                因果分析で区間と交互作用を見る →
              </Link>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-slate-600">
              <ProvenanceBadge kind="hypothesis" />
              <p>
                まだ実験を実行していないため、結果は表示しない（固定の演出用の数値は使わない）。<B>仮説:</B> 文言Aでは積み増しが形式上許容され、趣旨逸脱候補が増える。趣旨説明・参照文書はそれを減らす。
              </p>
              <Link href="/demo/research/experiment" className="font-medium text-[#4f46e5] underline">
                Experiment Builder で実行する →
              </Link>
            </div>
          )}
        </Card>
      </div>

      <p className="text-center text-[12px] leading-relaxed text-slate-400">
        合成市場・合成規則によるシミュレーションです。条文A・Bは研究のために設定した合成規則の例で、現行の実在の法令ではありません。外部の市場・API には接続しません。
      </p>
    </div>
  );
}
