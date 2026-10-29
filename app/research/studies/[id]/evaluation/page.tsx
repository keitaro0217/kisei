'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { AgreementStats, EvalRun, FinalAssessment, LayerSummary, ReliabilitySummary } from '@/lib/research/eval-types';
import { finalLabels } from '@/lib/research/study-labels';
import type { Study } from '@/lib/research/study-types';

// 多層評価: 形式適合・規制趣旨・経済/業務影響・証拠の質・評価器の信頼性を別々に表示する。

type Data = { study: Study; runs: (Omit<EvalRun, 'sample'> & { sampleSize: number })[]; layers: LayerSummary[]; reliability: ReliabilitySummary };


const pct = (p: number | null) => (p === null ? '—' : `${(p * 100).toFixed(1)}%`);
const num = (x: number | null, d = 2) => (x === null || !Number.isFinite(x) ? '—' : x.toFixed(d));
const statusLabel: Record<string, string> = { running: '実行中', completed: '完了', paused: '一時停止', failed: '失敗' };

function AgreementCells({ s }: { s: AgreementStats }) {
  return (
    <>
      <td className={td}>{s.n}</td>
      <td className={td}>{pct(s.agreement)}</td>
      <td className={td}>{num(s.kappa, 3)}</td>
      <td className={td}>{pct(s.precision)}</td>
      <td className={td}>{pct(s.recall)}</td>
      <td className={td}>{num(s.f1, 3)}</td>
    </>
  );
}

export default function EvaluationPage() {
  const { id } = useParams<{ id: string }>();
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<'mock' | 'model'>('mock');
  const [size, setSize] = useState('100');
  const [seed, setSeed] = useState('1');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<Data>(`/studies/${id}/evaluation`)
        .then(setData)
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;

  const start = async () => {
    if (kind === 'model' && !window.confirm(`設定 → モデル割り当ての「LLM Judge」で ${size} 件の判断を評価します（費用が発生します）。開始しますか？`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/studies/${id}/evaluation/runs`, { method: 'POST', body: { kind, sampleSize: Number(size), sampleSeed: Number(seed) } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const act = async (runId: string, action: 'pause' | 'resume') => {
    try {
      await api(`/eval-runs/${runId}/actions`, { method: 'POST', body: { action } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const r = data.reliability;

  return (
    <>
      <PageHeader
        title={`多層評価: ${data.study.design.title}`}
        description="形式的な規則適合（規則エンジン）と規制趣旨への適合（事前基準・LLM Judge・人の評価）を分けて評価し、経済・業務への影響、証拠の質、評価器の信頼性と並べて表示します。単一のリスクスコアにはまとめません。"
        actions={
          <>
            <Link href={`/research/studies/${id}/review`} className="rc-primary inline-flex rounded-md px-3.5 py-1.5 text-sm font-medium">
              人による評価
            </Link>
            <Link href={`/research/studies/${id}`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
              研究の結果へ
            </Link>
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      {data.study.isMock && (
        <div className="mb-4">
          <Alert kind="warning" title="モックデータ">
            この研究の行動はモックエージェントが生成したものです。評価の流れの確認用であり、AIの行動に関する結果として解釈しないでください。
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="最終表示（判断ごと）" description="形式違反は趣旨とは別に優先して表示します。人の評価があればそれを優先し、なければ事前基準と Judge が一致した場合だけ確定します。">
          <Table head={['条件', '判断数', ...Object.values(finalLabels).map((f) => f.label)]}>
            {data.layers.map((l) => (
              <tr key={l.conditionId}>
                <td className={td}>{l.label}</td>
                <td className={td}>{l.decisions}</td>
                {(Object.keys(finalLabels) as FinalAssessment[]).map((k) => (
                  <td key={k} className={td}>
                    {l.final[k]}
                  </td>
                ))}
              </tr>
            ))}
          </Table>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Layer 1: 形式適合（規則エンジン）" description="決定論的な判定。AIの説明は判定に使いません。">
            <Table head={['条件', '試行', '規則違反', '取引所の基本チェックで拒否']}>
              {data.layers.map((l) => (
                <tr key={l.conditionId}>
                  <td className={td}>{l.label}</td>
                  <td className={td}>{l.formal.attempts}</td>
                  <td className={td}>{l.formal.ruleViolations}</td>
                  <td className={td}>{l.formal.systemRejections}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Layer 2: 規制趣旨" description="事前基準（コード）・Judge・人の評価をそれぞれ数えます。">
            <Table head={['条件', '事前基準に該当', 'Judge 評価数', 'Judge: 逸脱の疑い', 'Judge: 判断不能', '人の評価数', '人: 逸脱']}>
              {data.layers.map((l) => (
                <tr key={l.conditionId}>
                  <td className={td}>{l.label}</td>
                  <td className={td}>{l.intent.criteriaDeviations}</td>
                  <td className={td}>{l.intent.judgeEvaluated}</td>
                  <td className={td}>{l.intent.judgeDeviations}</td>
                  <td className={td}>{l.intent.judgeUncertain}</td>
                  <td className={td}>{l.intent.humanEvaluated}</td>
                  <td className={td}>{l.intent.humanDeviations}</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Layer 3: 経済・業務への影響" description="超過損益は主要比較の対照群との、同じ反復どうしの差の平均です。流動性・スプレッドは外生価格モードでは測定できません。">
            <Table head={['条件', '損益の平均', '対照群との差', '閾値付近の集中度', '誤拒否率（人の評価）', '流動性']}>
              {data.layers.map((l) => (
                <tr key={l.conditionId}>
                  <td className={td}>{l.label}</td>
                  <td className={td}>{num(l.economic.meanPnl, 0)}</td>
                  <td className={td}>{num(l.economic.excessPnlVsControl, 0)}</td>
                  <td className={td}>{pct(l.economic.boundaryConcentration)}</td>
                  <td className={td}>
                    {pct(l.economic.falseRejectionRate)} <span className="text-xs text-ink-300">（{l.economic.falseRejectionLabeled}件）</span>
                  </td>
                  <td className={`${td} text-xs text-ink-300`}>測定対象外</td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Layer 4: 証拠の質">
            <Table head={['条件', '引用規則の実在', '説明あり', '説明と判定の不一致', 'Judge の不正な引用']}>
              {data.layers.map((l) => (
                <tr key={l.conditionId}>
                  <td className={td}>{l.label}</td>
                  <td className={td}>{pct(l.evidence.citationValidRate)}</td>
                  <td className={td}>{pct(l.evidence.rationaleRate)}</td>
                  <td className={td}>{pct(l.evidence.reasoningActionMismatchRate)}</td>
                  <td className={td}>{pct(l.evidence.judgeInvalidEvidenceRate)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <Card
          title="Layer 5: 評価器の信頼性"
          description={`人の評価（多数決）を正解とした一致率です。正解ラベル ${r.goldLabels} 件。「趣旨逸脱の疑い」を陽性として Precision / Recall / F1 を求めます。Judge の自己申告の確信度は校正済みの確率ではないため使っていません。`}
        >
          {r.goldLabels === 0 && (
            <div className="mb-3">
              <Alert kind="info" title="人の評価がまだありません">
                「人による評価」で判断を評価すると、Judge と事前基準の精度を算出できます。
              </Alert>
            </div>
          )}
          <Table head={['評価器', '件数', '一致率', 'κ', 'Precision', 'Recall', 'F1', '評価不能率']}>
            <tr>
              <td className={td}>事前基準（コード）</td>
              <AgreementCells s={r.criteriaVsHuman} />
              <td className={td}>—</td>
            </tr>
            {r.judgeVsHuman.map((j) => (
              <tr key={j.runId}>
                <td className={td}>{j.name}</td>
                <AgreementCells s={j.stats} />
                <td className={td}>{pct(j.unevaluableRate)}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-ink-200">
            規則エンジンの形式判定が正しいと評価された割合: {pct(r.formalCorrectRate)}（{r.formalReviewed}件）
          </p>
          {(r.judgeVsJudge.length > 0 || r.humanVsHuman.length > 0) && (
            <div className="mt-4">
              <Table head={['比較', '件数', '一致率', 'κ', 'Precision', 'Recall', 'F1']}>
                {r.judgeVsJudge.map((x) => (
                  <tr key={`j-${x.a}-${x.b}`}>
                    <td className={td}>
                      Judge: {x.a} × {x.b}
                    </td>
                    <AgreementCells s={x.stats} />
                  </tr>
                ))}
                {r.humanVsHuman.map((x) => (
                  <tr key={`h-${x.a}-${x.b}`}>
                    <td className={td}>
                      評価者: {x.a} × {x.b}
                    </td>
                    <AgreementCells s={x.stats} />
                  </tr>
                ))}
              </Table>
            </div>
          )}
          <a href={`/api/research/studies/${id}/annotations`} className="mt-3 inline-block text-xs text-ink-100 underline underline-offset-2">
            人の評価（ゴールドデータ）を JSON で出力
          </a>
        </Card>

        <Card title="Judge による評価" description="指摘のある判断（違反・趣旨逸脱・閾値付近・説明との不一致）を優先して標本を選び、残りを無作為に加えます。同じシードなら同じ標本になります。">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Judge">
              <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value as 'mock' | 'model')}>
                <option value="mock">モック（規則ベース・APIキー不要）</option>
                <option value="model">LLM Judge（モデル割り当て）</option>
              </select>
            </Field>
            <Field label="評価する判断の数" hint="1〜500">
              <input className={inputClass} value={size} onChange={(e) => setSize(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="標本のシード">
              <input className={inputClass} value={seed} onChange={(e) => setSeed(e.target.value)} inputMode="numeric" />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" busy={busy} onClick={start} disabled={!data.study.frozen}>
                評価を開始
              </Button>
            </div>
          </div>
          <div className="mt-4">
            <Table head={['名称', '種類', 'プロンプト', '状態', '進捗', '失敗', '開始', '']} empty="評価はまだありません">
              {data.runs.map((run) => (
                <tr key={run.id}>
                  <td className={td}>{run.name}</td>
                  <td className={td}>{run.kind === 'mock' ? <Badge className="bg-violet-500/10 text-violet-200 ring-violet-400/30">モック</Badge> : run.judgeRole?.model}</td>
                  <td className={`${td} font-mono text-xs`}>
                    {run.promptVersion} ({run.promptHash.slice(0, 8)})
                  </td>
                  <td className={td}>
                    {statusLabel[run.status] ?? run.status}
                    {run.statusReason && <span className="block text-xs text-amber-200">{run.statusReason}</span>}
                  </td>
                  <td className={td}>
                    {run.completed + run.failed} / {run.sampleSize}
                  </td>
                  <td className={td}>{run.failed}</td>
                  <td className={td}>{formatDate(run.createdAt, basic)}</td>
                  <td className={td}>
                    {run.status === 'running' && <Button onClick={() => act(run.id, 'pause')}>一時停止</Button>}
                    {run.status === 'paused' && <Button onClick={() => act(run.id, 'resume')}>再開</Button>}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      </div>
    </>
  );
}
