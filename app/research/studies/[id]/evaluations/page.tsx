'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Stat, Table, td } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import { EVAL_CATEGORIES, evalCategoryLabels, type CompositeEvaluation, type EvalCategory, type EvaluationRecord, type EvaluatorRef } from '@/lib/research/evaluation-model';

// 評価の統合: 評価器ごとの判定（6分類・形式と趣旨の2軸）、複合評価（集約の版つき）、不一致、人のレビュー（承認・修正・却下）。

type Data = {
  study: { id: string; title: string; isMock: boolean; generatorModel: string | null };
  aggregationVersion: string;
  totals: { decisions: number; disagreements: number; needsHumanReview: number };
  composite: Record<EvalCategory, number>;
  evaluators: { evaluator: EvaluatorRef; evaluated: number; counts: Record<EvalCategory, number> }[];
  items: { composite: CompositeEvaluation; evaluations: EvaluationRecord[] }[];
};

const kindLabel: Record<string, string> = { deterministic: '規則エンジン', criteria: '事前基準', llm_judge: 'LLM Judge', human: '人', composite: '複合評価' };
const reviewLabel: Record<string, string> = { unreviewed: '未レビュー', approved: '承認', corrected: '修正', rejected: '却下' };

export default function StudyEvaluationsPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState('');
  const [open, setOpen] = useState<{ itemKey: string; evaluatorId: string } | null>(null);
  const [form, setForm] = useState<{ action: 'approve' | 'correct' | 'reject'; category: EvalCategory; note: string }>({ action: 'approve', category: 'compliant', note: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<Data>(`/studies/${id}/evaluations?limit=200${onlyIssues ? '&disagreements=1' : ''}`)
        .then(setData)
        .catch((e) => setError(e.message)),
    [id, onlyIssues],
  );
  useEffect(() => {
    load();
  }, [load]);

  if (!data) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;

  const submit = async () => {
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/studies/${id}/evaluations/review`, {
        method: 'POST',
        body: { itemKey: open.itemKey, evaluatorId: open.evaluatorId, action: form.action, correctedCategory: form.action === 'correct' ? form.category : null, note: form.note, reviewer },
      });
      setOpen(null);
      setForm({ action: 'approve', category: 'compliant', note: '' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`評価の統合: ${data.study.title}`}
        description={`評価器ごとの判定を独立に保持し、複合評価（${data.aggregationVersion}）で比べます。単純な多数決ではなく、評価器の間で割れた判断は「解釈に争いあり」として人の確認に回します。判定は研究用の合成市場についての評価で、法的な結論ではありません。`}
        actions={
          <Link href={`/research/studies/${id}`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            研究へ戻る
          </Link>
        }
      />
      {data.study.isMock && <Alert kind="warning" title="モックの研究です。AI の行動の研究結果として解釈しないでください。" />}
      {error && (
        <Alert kind="error" title="エラー" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="評価した判断" value={data.totals.decisions.toLocaleString()} />
        <Stat label="評価器の不一致" value={data.totals.disagreements.toLocaleString()} />
        <Stat label="人の確認が必要" value={data.totals.needsHumanReview.toLocaleString()} />
      </div>

      <Card title="カテゴリの内訳" description="複合評価と、評価器ごとの判定の件数です。規則エンジンは形式だけを評価し、趣旨は評価しません。">
        <Table head={['評価器', '評価件数', ...EVAL_CATEGORIES.map((c) => evalCategoryLabels[c])]}>
          <tr>
            <td className={`${td} font-semibold text-white`}>複合評価</td>
            <td className={td}>{data.totals.decisions}</td>
            {EVAL_CATEGORIES.map((c) => (
              <td key={c} className={td}>
                {data.composite[c]}
              </td>
            ))}
          </tr>
          {data.evaluators.map((e) => (
            <tr key={e.evaluator.id}>
              <td className={`${td} text-xs`}>
                {kindLabel[e.evaluator.kind]}: {e.evaluator.name}
                {e.evaluator.independentOfGenerator === false && <Badge className="ml-1 bg-amber-500/15 text-amber-200 ring-amber-400/30">自己評価</Badge>}
                <div className="text-ink-400">{e.evaluator.version}</div>
              </td>
              <td className={td}>{e.evaluated}</td>
              {EVAL_CATEGORIES.map((c) => (
                <td key={c} className={td}>
                  {e.counts[c]}
                </td>
              ))}
            </tr>
          ))}
        </Table>
      </Card>

      <Card
        title="判断ごとの評価"
        description="不一致・人の確認が必要な判断を先に表示します。評価器の判定を承認・修正・却下でき、履歴は変更できない形で残ります。"
        actions={
          <label className="flex items-center gap-2 text-sm text-ink-100">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
            不一致・要確認のみ
          </label>
        }
      >
        <div className="mb-4 max-w-xs">
          <Field label="レビューする人の名前">
            <input className={inputClass} value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="例: 専門家A" />
          </Field>
        </div>
        <div className="space-y-4">
          {data.items.length === 0 && <p className="text-sm text-ink-300">該当する判断はありません。</p>}
          {data.items.map(({ composite: c, evaluations }) => (
            <div key={c.target.itemKey} className="rounded-lg p-3 ring-1 ring-inset ring-white/10">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/research/studies/${id}?condition=${encodeURIComponent(c.target.conditionId)}&replicate=${c.target.replicate}&step=${c.target.step}`} className="underline">
                  {c.target.conditionId} / 反復 {c.target.replicate} / ステップ {c.target.step + 1}
                </Link>
                <Badge className="bg-white/10 text-white ring-white/20">{evalCategoryLabels[c.category]}</Badge>
                <span className="text-xs text-ink-300">
                  形式 {c.formal}・趣旨 {c.intent}・根拠 {c.basis}
                </span>
                {c.disagreement && <Badge className="bg-amber-500/15 text-amber-200 ring-amber-400/30">不一致</Badge>}
                {c.needsHumanReview && <Badge className="bg-amber-500/15 text-amber-200 ring-amber-400/30">要確認</Badge>}
              </div>
              <Table head={['評価器', 'カテゴリ', '形式 / 趣旨', '根拠', '不確実性（自己申告）', 'レビュー', '']}>
                {evaluations.map((e) => (
                  <tr key={e.id}>
                    <td className={`${td} text-xs`}>
                      {kindLabel[e.evaluator.kind]}: {e.evaluator.name}
                    </td>
                    <td className={`${td} text-xs`}>{evalCategoryLabels[e.category]}</td>
                    <td className={`${td} text-xs`}>
                      {e.formal} / {e.intent}
                    </td>
                    <td className={`${td} max-w-md whitespace-normal text-xs text-ink-200`}>
                      {e.rationale || '—'}
                      {e.evidence.length > 0 && <span className="text-ink-400">（証拠: {e.evidence.join(', ')}）</span>}
                    </td>
                    <td className={`${td} text-xs`}>{e.uncertainty ?? '—'}</td>
                    <td className={`${td} text-xs`}>
                      {reviewLabel[e.review.state]}
                      {e.review.correctedCategory && ` → ${evalCategoryLabels[e.review.correctedCategory]}`}
                      {e.review.by && <div className="text-ink-400">{e.review.by}</div>}
                    </td>
                    <td className={td}>
                      <Button onClick={() => setOpen({ itemKey: c.target.itemKey, evaluatorId: e.evaluator.id })}>レビュー</Button>
                    </td>
                  </tr>
                ))}
              </Table>
              {open?.itemKey === c.target.itemKey && (
                <div className="mt-3 flex flex-wrap items-end gap-3 rounded-md bg-white/5 p-3">
                  <Field label="操作">
                    <select className={inputClass} value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as typeof form.action })}>
                      <option value="approve">承認</option>
                      <option value="correct">修正</option>
                      <option value="reject">却下</option>
                    </select>
                  </Field>
                  {form.action === 'correct' && (
                    <Field label="修正後のカテゴリ">
                      <select className={inputClass} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as EvalCategory })}>
                        {EVAL_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {evalCategoryLabels[cat]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <Field label="理由（修正・却下では必須）">
                    <input className={`${inputClass} w-72`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
                  </Field>
                  <Button variant="primary" busy={busy} onClick={submit}>
                    保存
                  </Button>
                  <Button onClick={() => setOpen(null)}>閉じる</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
