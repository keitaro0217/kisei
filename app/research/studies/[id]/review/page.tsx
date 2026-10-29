'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import type { Annotation, EvidenceItem, FinalAssessment, IntentLabel, JudgeVerdict } from '@/lib/research/eval-types';
import { finalLabels, intentLabels } from '@/lib/research/study-labels';
import type { DecisionRecord } from '@/lib/research/study-types';

// 人による評価。判断の証拠・規則・AI Judge の評価を見ながら、規制趣旨への適合を評価する。
// 共有ログインのため、評価者は名前で区別する（名前はこのブラウザに保存する）。

type Item = {
  key: string;
  decision: DecisionRecord;
  evidence: EvidenceItem[];
  judgements: { runId: string; runName: string; kind: 'mock' | 'model'; verdict: JudgeVerdict }[];
  annotations: Annotation[];
  criteria: IntentLabel;
  final: FinalAssessment;
};

const ANNOTATOR_KEY = 'kisei.annotator';

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  // 前回入力した評価者名（このブラウザに保存）。サーバー側の描画では空欄
  const storedAnnotator = useSyncExternalStore(
    () => () => undefined,
    () => {
      try {
        return window.localStorage.getItem(ANNOTATOR_KEY) ?? '';
      } catch {
        return '';
      }
    },
    () => '',
  );
  const [editedAnnotator, setAnnotator] = useState<string | null>(null);
  const annotator = editedAnnotator ?? storedAnnotator;
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<{ total: number; items: Item[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [intent, setIntent] = useState<IntentLabel | null>(null);
  const [formalCorrect, setFormalCorrect] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [corrects, setCorrects] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    const q = new URLSearchParams({ offset: String(offset), limit: '1' });
    if (annotator.trim()) q.set('annotator', annotator.trim());
    if (onlyUnreviewed) q.set('unreviewed', '1');
    return api<{ total: number; items: Item[] }>(`/studies/${id}/review?${q}`)
      .then((r) => {
        setData(r);
        const mine = r.items[0]?.annotations.find((a) => a.annotator === annotator.trim());
        setIntent(mine?.intent ?? null);
        setFormalCorrect(mine?.formalCorrect ?? null);
        setReason(mine?.reason ?? '');
        setCorrects(mine?.correctsRunId ?? '');
      })
      .catch((e) => setError(e.message));
  }, [id, offset, annotator, onlyUnreviewed]);
  useEffect(() => {
    load();
  }, [load]);

  const item = data?.items[0];
  const save = async () => {
    if (!item || !intent) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      try {
        window.localStorage.setItem(ANNOTATOR_KEY, annotator.trim());
      } catch {
        // 保存できない環境では毎回入力する
      }
      await api(`/studies/${id}/annotations`, { method: 'POST', body: { key: item.key, annotator, intent, formalCorrect, reason, correctsRunId: corrects || null } });
      setSaved(true);
      // 未評価だけを表示している場合、保存した判断は一覧から外れるため同じ位置のまま次を読み込む
      if (onlyUnreviewed) await load();
      else setOffset(offset + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="人による評価"
        description="評価が割れている判断、指摘のある判断の順に表示します。評価はゴールドデータとして保存され、Judge や事前基準の精度（一致率・κ・F1）の算出に使われます。"
        actions={
          <Link href={`/research/studies/${id}/evaluation`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
            多層評価へ
          </Link>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="評価者の名前" hint="評価者ごとに区別して一致率を求めます">
            <input className={`${inputClass} w-48`} value={annotator} onChange={(e) => setAnnotator(e.target.value)} placeholder="例: 研究者A" />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm text-ink-100">
            <input
              type="checkbox"
              checked={onlyUnreviewed}
              onChange={(e) => {
                setOnlyUnreviewed(e.target.checked);
                setOffset(0);
              }}
            />
            自分が未評価の判断だけ
          </label>
          <span className="pb-2 text-sm text-ink-200">{data ? `${Math.min(offset + 1, data.total)} / ${data.total} 件` : ''}</span>
        </div>
      </Card>

      {!data ? (
        <Loading />
      ) : !item ? (
        <div className="mt-6">
          <Alert kind="info" title="評価する判断はありません" />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card
              title={`判断 ${item.decision.conditionId} / 反復 ${item.decision.replicate} / ステップ ${item.decision.step + 1}`}
              actions={<Badge className={finalLabels[item.final].className}>{finalLabels[item.final].label}</Badge>}
            >
              {item.decision.isMock && <p className="mb-3 text-xs text-violet-200">モックデータ（AIの判断ではありません）</p>}
              <dl className="space-y-3 text-sm">
                {item.evidence.map((e) => (
                  <div key={e.id}>
                    <dt className="text-xs text-ink-300">
                      <span className="font-mono text-ink-100">{e.id}</span> {e.label}
                    </dt>
                    <dd className="whitespace-pre-wrap text-ink-100">{e.content}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap gap-3 text-xs">
                <Link href={`/research/traces?study=${id}&condition=${encodeURIComponent(item.decision.conditionId)}&replicate=${item.decision.replicate}`} className="underline underline-offset-2">
                  実行トレース
                </Link>
                <Link href={`/research/studies/${id}?condition=${encodeURIComponent(item.decision.conditionId)}&replicate=${item.decision.replicate}&step=${item.decision.step}`} className="underline underline-offset-2">
                  意思決定ログ
                </Link>
              </div>
            </Card>
            <Card title="評価器の結果">
              <div className="space-y-3 text-sm">
                <p>
                  事前基準（コード）: <span className="text-white">{intentLabels[item.criteria]}</span>
                </p>
                {item.judgements.length === 0 && <p className="text-ink-300">Judge による評価はまだありません。</p>}
                {item.judgements.map((j) => (
                  <div key={j.runId} className="rounded-lg border border-white/10 p-3">
                    <p className="font-semibold text-white">
                      {j.runName} {j.kind === 'mock' && <span className="text-xs text-violet-200">（モック）</span>}
                    </p>
                    <p>判定: {j.verdict.intent ? intentLabels[j.verdict.intent] : '判定できず'}（不確実性の自己申告: {j.verdict.uncertainty ?? '—'}）</p>
                    <p className="text-ink-200">{j.verdict.rationale || '—'}</p>
                    <p className="text-xs text-ink-300">引用: {j.verdict.evidenceIds.join(', ') || 'なし'}</p>
                    {j.verdict.invalidEvidenceIds.length > 0 && <p className="text-xs text-amber-200">存在しない証拠の引用: {j.verdict.invalidEvidenceIds.join(', ')}</p>}
                    {j.verdict.schemaErrors.length > 0 && <p className="text-xs text-rose-200">出力の不備: {j.verdict.schemaErrors.join(' / ')}</p>}
                  </div>
                ))}
                {item.annotations.length > 0 && (
                  <div>
                    <p className="text-xs text-ink-300">人の評価</p>
                    {item.annotations.map((a) => (
                      <p key={a.annotator}>
                        {a.annotator}: {intentLabels[a.intent]}
                        {a.reason && <span className="text-ink-300">（{a.reason}）</span>}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
          <Card title="あなたの評価">
            <div className="space-y-4 text-sm">
              <fieldset>
                <legend className="text-xs font-medium text-ink-100">規制趣旨への適合</legend>
                <div className="mt-2 space-y-1.5">
                  {(Object.keys(intentLabels) as IntentLabel[]).map((k) => (
                    <label key={k} className="flex items-center gap-2">
                      <input type="radio" name="intent" checked={intent === k} onChange={() => setIntent(k)} />
                      {intentLabels[k]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="text-xs font-medium text-ink-100">規則エンジンの形式判定（{item.decision.enforcement.verdict}）は正しいか</legend>
                <div className="mt-2 flex gap-4">
                  {(
                    [
                      [true, '正しい'],
                      [false, '誤り'],
                      [null, '評価しない'],
                    ] as const
                  ).map(([v, l]) => (
                    <label key={String(v)} className="flex items-center gap-2">
                      <input type="radio" name="formal" checked={formalCorrect === v} onChange={() => setFormalCorrect(v)} />
                      {l}
                    </label>
                  ))}
                </div>
              </fieldset>
              {item.judgements.length > 0 && (
                <Field label="Judge の評価を修正する場合">
                  <select className={inputClass} value={corrects} onChange={(e) => setCorrects(e.target.value)}>
                    <option value="">修正しない</option>
                    {item.judgements.map((j) => (
                      <option key={j.runId} value={j.runId}>
                        {j.runName} の評価を修正
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="理由" hint={corrects ? '修正する場合は必須です' : undefined}>
                <textarea className={inputClass} rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              {saved && <p className="text-xs text-emerald-300">保存しました</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" busy={busy} disabled={!intent || !annotator.trim()} onClick={save}>
                  保存して次へ
                </Button>
                <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 1))}>
                  前へ
                </Button>
                <Button disabled={offset + 1 >= data.total} onClick={() => setOffset(offset + 1)}>
                  スキップ
                </Button>
              </div>
              {!annotator.trim() && <p className="text-xs text-amber-200">評価者の名前を入力してください。</p>}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
