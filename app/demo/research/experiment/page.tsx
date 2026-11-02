'use client';

import Link from 'next/link';
import { useDemo } from '@/components/demo/DemoStore';
import { Badge, Button, Callout, Card, download, Field, inputCls, PageHeader, ProvenanceBadge, Toggle } from '@/components/demo/ui';
import { configHash } from '@/lib/demo/experiment';
import { experimentCsv } from '@/lib/demo/export';
import { CONDITIONS, type ConditionId } from '@/lib/demo/rules';

// Experiment Builder: 2×2 要因実験（文言 A/B × 趣旨説明 なし/あり）＋規則なし。
// 条件は開始時にスナップショットとして固定し、設定が変われば新しい版になる。

export default function ExperimentPage() {
  const d = useDemo();
  const cfg = d.experimentConfig;
  const exp = d.experiment;
  const pending = { ...cfg, rules: d.rules, agent: d.agent };
  const pendingHash = configHash(pending);
  const changed = exp && exp.hash !== pendingHash;
  const running = exp?.status === 'running';
  const toggleCond = (c: ConditionId) => d.setExperimentConfig({ conditions: cfg.conditions.includes(c) ? cfg.conditions.filter((x) => x !== c) : CONDITIONS.map((x) => x.id).filter((x) => x === c || cfg.conditions.includes(x)) });
  const numIn = (v: string, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Experiment Builder" title="2×2 要因実験" description="文言（A / B）と規制趣旨の説明（なし C1 / あり C2）を組み合わせた4条件と、規則なしの統制条件を、同じシードの列で比べます。" />
      <Callout tone="note">研究資料に記載の 400 エピソードは計画上の想定値で、完了済みの研究結果ではありません。このデモでは、ブラウザで実行できる規模（既定 30 エピソード × 5 条件）で、決定論的なシミュレーションを実行します。</Callout>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="実験条件">
          <div className="grid grid-cols-2 gap-2">
            {CONDITIONS.map((c) => (
              <label key={c.id} className={`flex cursor-pointer items-start gap-2 rounded-xl border p-3 text-sm ${cfg.conditions.includes(c.id) ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200'}`}>
                <input type="checkbox" checked={cfg.conditions.includes(c.id)} onChange={() => toggleCond(c.id)} className="mt-0.5 accent-blue-700" disabled={running} />
                <span>
                  <span className="font-semibold text-[#0b1f44]">{c.label}</span>
                  <span className="block text-xs text-slate-500">{c.description}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-4">
            <Toggle checked={cfg.docsAccess} onChange={(v) => d.setExperimentConfig({ docsAccess: v })} label="参照文書へのアクセス（全条件に共通。RQ3 は on / off の実験を比べる）" />
          </div>
        </Card>
        <Card title="設定">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="エージェント">
              <select className={inputCls} disabled>
                <option>Deterministic Demo Agent</option>
              </select>
            </Field>
            <Field label="評価器">
              <select className={inputCls} disabled>
                <option>Build（決定論的）＋ Judge（ルールベース）</option>
              </select>
            </Field>
            <Field label="エピソード数（条件ごと）" hint="1〜200">
              <input className={inputCls} type="number" value={cfg.episodes} onChange={(e) => d.setExperimentConfig({ episodes: numIn(e.target.value, 1, 200, 30) })} aria-label="エピソード数" />
            </Field>
            <Field label="基準シード">
              <input className={inputCls} type="number" value={cfg.baseSeed} onChange={(e) => d.setExperimentConfig({ baseSeed: numIn(e.target.value, 0, 2 ** 31 - 1, 1) })} />
            </Field>
            <Field label="シミュレーション期間（ステップ）" hint="10〜300">
              <input className={inputCls} type="number" value={cfg.steps} onChange={(e) => d.setExperimentConfig({ steps: numIn(e.target.value, 10, 300, 60) })} />
            </Field>
            <Field label="初期価格">
              <input className={inputCls} type="number" value={cfg.market.initialPrice} onChange={(e) => d.setExperimentConfig({ market: { ...cfg.market, initialPrice: numIn(e.target.value, 100, 100000, 1000) } })} />
            </Field>
            <Field label="価格のトレンド（1ステップあたり）" hint="負 = 下落局面">
              <input className={inputCls} type="number" step="0.1" value={cfg.market.trend} onChange={(e) => d.setExperimentConfig({ market: { ...cfg.market, trend: Math.max(-3, Math.min(3, Number(e.target.value) || 0)) } })} />
            </Field>
            <Field label="予算上限（USD）" hint="デモのエージェントは API を使わないため費用は 0">
              <input className={inputCls} value="0（API を使わない）" disabled />
            </Field>
          </div>
        </Card>
      </div>

      {d.advanced && (
        <Card title="Advanced: Deterministic Demo Agent の方策（デモ用の設計上の仮定）" subtitle={<ProvenanceBadge kind="assumption" />}>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                ['loopholePropensity', '抜け穴を使う傾向'],
                ['purposeEffect', '趣旨説明による低下'],
                ['referenceEffect', '参照文書による低下'],
                ['misreadRate', '読み違いの確率'],
                ['hedgeRate', 'リスク調整の売りの確率'],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} label={label} hint="0〜1">
                <input className={inputCls} type="number" step="0.05" min={0} max={1} value={d.agent[k]} onChange={(e) => d.update({ agent: { ...d.agent, [k]: Math.max(0, Math.min(1, Number(e.target.value) || 0)) } })} />
              </Field>
            ))}
          </div>
          <p className="mt-3 text-xs text-amber-700">これらは研究の結果ではなく、デモの方策のパラメータです。趣旨説明の効果などは、この値から計算されます。</p>
        </Card>
      )}

      <Card
        title="実行"
        actions={
          <>
            <Button variant="primary" onClick={d.runExperiment} disabled={running || cfg.conditions.length === 0}>
              Run Experiment
            </Button>
            <Button onClick={d.pauseExperiment} disabled={!running}>
              Pause
            </Button>
            <Button onClick={d.resumeExperiment} disabled={exp?.status !== 'paused'}>
              Resume
            </Button>
            <Button variant="danger" onClick={d.cancelExperiment} disabled={!(running || exp?.status === 'paused')}>
              Cancel
            </Button>
          </>
        }
      >
        {!exp ? (
          <p className="text-sm text-slate-600">まだ実行していません。</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={exp.status === 'completed' ? 'green' : exp.status === 'running' ? 'blue' : exp.status === 'cancelled' ? 'rose' : 'amber'}>{exp.status}</Badge>
              <span className="text-slate-600">
                実験 v{exp.version}・設定のハッシュ <code className="rounded bg-slate-100 px-1">{exp.hash}</code>・{exp.done} / {exp.total} エピソード
              </span>
              <ProvenanceBadge kind="simulation" short />
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={exp.done} aria-valuemax={exp.total}>
              <div className="h-full bg-[#1d4ed8] transition-all" style={{ width: `${(exp.done / exp.total) * 100}%` }} />
            </div>
            <p className="text-xs text-slate-500">
              開始時の条件（スナップショット）: 条件 {exp.snapshot.conditions.join(', ')}・{exp.snapshot.episodes} エピソード・{exp.snapshot.steps} ステップ・規則 v{exp.snapshot.rules.version}・参照文書{' '}
              {exp.snapshot.docsAccess ? 'あり' : 'なし'}・基準シード {exp.snapshot.baseSeed}
            </p>
            {changed && <Callout tone="warn">開始後に設定が変わっています。次に実行すると、新しい実験の版（v{d.experimentVersion + 1}）になります。実行中の実験の条件は変わりません。</Callout>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={exp.done === 0} onClick={() => download(`kisei-demo-experiment-v${exp.version}.csv`, experimentCsv(exp), 'text/csv')}>
                Export CSV
              </Button>
              <Button size="sm" disabled={exp.done === 0} onClick={() => download(`kisei-demo-experiment-v${exp.version}.json`, JSON.stringify(exp, null, 2), 'application/json')}>
                Export JSON
              </Button>
              <Link href="/demo/research/analysis" className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-[#0b1f44] hover:bg-slate-50">
                Compare Conditions →
              </Link>
            </div>
            <p className="text-[11px] text-slate-400">結果はこのブラウザに保存されます（Save Results）。サーバーや DB には送信しません。</p>
          </div>
        )}
      </Card>
    </div>
  );
}
