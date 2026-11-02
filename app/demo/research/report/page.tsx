'use client';

import { useDemo } from '@/components/demo/DemoStore';
import { Button, Callout, Card, download, num, PageHeader, pct, ProvenanceBadge } from '@/components/demo/ui';
import { analyze, METRICS, type MetricKey } from '@/lib/demo/experiment';
import { experimentCsv } from '@/lib/demo/export';
import { CONDITIONS } from '@/lib/demo/rules';

// Research Report: 実行したデモの実験をレポートにまとめる（JSON / CSV、印刷で PDF）。

const ENGINE_VERSION = 'kisei-demo-engine@1';

export default function ReportPage() {
  const d = useDemo();
  const exp = d.experiment;
  const cfg = exp?.snapshot;
  const analyses = exp ? (Object.keys(METRICS) as MetricKey[]).map((k) => analyze(exp.data, k)) : [];
  const report = {
    kind: 'deterministic_simulation_output',
    disclaimer: '合成市場・合成規則・デモ用の方策による決定論的なシミュレーションの出力。実際の AI の研究成果ではない。条文A・Bは合成規則で、実在の法令ではない。',
    researchQuestion: '利益最大化を目指す AI は、金融規制の文言上の抜け穴を自律的に探索し、規制の本来の目的に反する行動を取るのか？',
    hypothesis: 'H1: 文言A（「新規に」あり）では積み増しが形式上許容され、趣旨逸脱候補が増える。H2: 趣旨説明はそれを減らす。H3: 参照文書はそれを減らす。（仮説であり、このデモの結果は仮説の検証ではない）',
    experiment: exp ? { id: exp.id, version: exp.version, configHash: exp.hash, status: exp.status, done: exp.done, total: exp.total, startedAt: exp.startedAt, finishedAt: exp.finishedAt } : null,
    rules: cfg?.rules ?? d.rules,
    agent: { type: 'Deterministic Demo Agent', parameters: cfg?.agent ?? d.agent, note: 'パラメータはデモ用の設計上の仮定' },
    market: cfg ? { ...cfg.market, steps: cfg.steps, docsAccess: cfg.docsAccess } : null,
    evaluation: 'Build（取引ログの決定論的判定。趣旨逸脱候補の基準は全条件で共通）と Judge（説明のルールベース評価、LLM ではない）を独立に計算',
    results: analyses.map((a) => ({
      metric: a.metric,
      label: METRICS[a.metric].label,
      byCondition: a.byCondition,
      wordingEffect: a.wording,
      purposeEffect: a.purpose,
      interaction: a.interaction,
      warnings: a.warnings,
    })),
    patchVerifications: d.verifications,
    limitations: [
      'エージェントは LLM ではなく、行動の傾向（抜け穴を使う傾向・趣旨説明への反応など）はデモ用の仮定。結果はその仮定から計算される。',
      '市場は単一銘柄の簡易な注文板。手数料・値幅制限・板寄せ・貸株・遅延・他の参加者の戦略的な行動は再現していない。',
      'Judge はルールベースで、説明の文言のパターンを評価する。LLM Judge・人の評価ではない。',
      '独立な単位はエピソード。ステップ内の注文は独立に扱わない。',
    ],
    reproducibility: { engine: ENGINE_VERSION, baseSeed: cfg?.baseSeed ?? null, seedRule: 'episodeSeed = deriveSeed(baseSeed, episodeIndex)（全条件で同じ）', configHash: exp?.hash ?? null, runtime: 'ブラウザ内で決定論的に計算（同じ設定・同じシードなら同じ結果）' },
  };
  return (
    <div className="space-y-6 print:space-y-3">
      <PageHeader
        eyebrow="Research Report"
        title="Research Report"
        description="このブラウザで実行したデモの実験を、研究レポートの形でまとめます。"
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button onClick={() => download('kisei-demo-report.json', JSON.stringify(report, null, 2), 'application/json')}>Export JSON</Button>
            <Button disabled={!exp} onClick={() => exp && download(`kisei-demo-experiment-v${exp.version}.csv`, experimentCsv(exp), 'text/csv')}>
              Export CSV
            </Button>
            <Button onClick={() => window.print()}>PDF（印刷）</Button>
          </div>
        }
      />
      <Callout tone="warn">{report.disclaimer}</Callout>
      <Section n={1} title="Research Question">{report.researchQuestion}</Section>
      <Section n={2} title="Hypothesis">
        <ProvenanceBadge kind="hypothesis" />
        <p className="mt-2">{report.hypothesis}</p>
      </Section>
      <Section n={3} title="Experiment Configuration">
        {exp && cfg ? (
          <p>
            実験 v{exp.version}（{exp.status}、{exp.done}/{exp.total}）・条件 {cfg.conditions.join(', ')}・{cfg.episodes} エピソード／条件・{cfg.steps} ステップ・参照文書 {cfg.docsAccess ? 'あり' : 'なし'}・設定のハッシュ {exp.hash}
          </p>
        ) : (
          <p>実験は未実行です。</p>
        )}
      </Section>
      <Section n={4} title="Rule Versions">
        <p>規則の版 v{report.rules.version}</p>
        <p className="mt-1">条文A: {report.rules.textA}</p>
        <p>条文B: {report.rules.textB}</p>
        <p>規制趣旨: {report.rules.purpose}</p>
      </Section>
      <Section n={5} title="Agent Configuration">
        <ProvenanceBadge kind="assumption" />
        <p className="mt-2">Deterministic Demo Agent: {Object.entries(report.agent.parameters).map(([k, v]) => `${k}=${v}`).join('・')}</p>
      </Section>
      <Section n={6} title="Market Configuration">{report.market ? `初期価格 ${report.market.initialPrice}・トレンド ${report.market.trend}・変動 ${report.market.volatility}・${report.market.steps} ステップ` : '—'}</Section>
      <Section n={7} title="Evaluation Method">{report.evaluation}</Section>
      <Section n={8} title="Experimental Results">
        {exp ? (
          <>
            <ProvenanceBadge kind="simulation" />
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-2">指標</th>
                  {CONDITIONS.map((c) => (
                    <th key={c.id} className="pr-2">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analyses.map((a) => (
                  <tr key={a.metric}>
                    <td className="py-1 pr-2 font-medium">{METRICS[a.metric].label}</td>
                    {CONDITIONS.map((c) => {
                      const s = a.byCondition[c.id];
                      return (
                        <td key={c.id} className="pr-2 tabular-nums">
                          {s ? (METRICS[a.metric].unit === '%' ? pct(s.mean) : num(s.mean)) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          '実験は未実行です（結果は表示しません）。'
        )}
      </Section>
      <Section n={9} title="Causal Comparison">
        {analyses.length ? (
          <ul className="space-y-1">
            {analyses
              .filter((a) => a.metric === 'intentCandidateRate' || a.metric === 'formalViolationRate' || a.metric === 'falseRejectionRate')
              .map((a) => (
                <li key={a.metric}>
                  {METRICS[a.metric].label}: 文言（B−A）{fmtE(a.wording)}・趣旨説明（あり−なし）{fmtE(a.purpose)}・交互作用 {fmtE(a.interaction)}
                </li>
              ))}
          </ul>
        ) : (
          '—'
        )}
      </Section>
      <Section n={10} title="Limitations">
        <ul className="list-disc space-y-1 pl-5">
          {report.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>
      <Section n={11} title="Patch Verification">
        {d.verifications.length ? (
          <ul className="space-y-1">
            {d.verifications.map((v, i) => (
              <li key={i}>
                {v.patchId}: {v.verdict}（{v.conditionBefore} → {v.conditionAfter}、{v.episodes} エピソード）
              </li>
            ))}
          </ul>
        ) : (
          '修正案の検証は未実施です。'
        )}
      </Section>
      <Section n={12} title="Side Effects">
        {d.verifications.length ? (
          <ul className="space-y-1">
            {d.verifications.map((v, i) => (
              <li key={i}>
                {v.patchId}: {v.sideEffects.length ? `悪化: ${v.sideEffects.join('・')}` : '正常取引の成功率・誤拒否率の悪化は確認されず（区間が0を含む場合を含む）'}
              </li>
            ))}
          </ul>
        ) : (
          '—'
        )}
      </Section>
      <Section n={13} title="Reproducibility Information">
        <p>
          エンジン {report.reproducibility.engine}・基準シード {report.reproducibility.baseSeed ?? '—'}・設定のハッシュ {report.reproducibility.configHash ?? '—'}
        </p>
        <p>{report.reproducibility.seedRule}</p>
        <p>{report.reproducibility.runtime}</p>
      </Section>
    </div>
  );
}

function fmtE(e: { estimate: number | null; ci: [number, number] | null } | null) {
  if (!e || e.estimate === null) return '—';
  return `${(e.estimate * 100).toFixed(1)} pt${e.ci ? ` [${(e.ci[0] * 100).toFixed(1)}, ${(e.ci[1] * 100).toFixed(1)}]` : ''}`;
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <Card title={`${n}. ${title}`} className="break-inside-avoid">
      <div className="text-sm leading-relaxed text-slate-700">{children}</div>
    </Card>
  );
}
