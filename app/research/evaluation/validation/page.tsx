'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import { evalCategoryLabels, type BiasCheck, type LabelSet, type RateCi, type ValidationMetrics } from '@/lib/research/evaluation-model';

// 評価器の検証: 外部ラベル（正解）付きのデータセットを登録し、評価器ごとの指標を比べる。
// 正解ラベルがない評価器・データでは指標を表示しない（未測定）。

type Detail = {
  set: LabelSet;
  studies: { id: string; title: string; isMock: boolean }[];
  isTestData: boolean;
  includesMock: boolean;
  gold: { labeled: number; disputed: number; annotators: string[] };
  metrics: ValidationMetrics[];
  formalMetrics: ValidationMetrics[];
  annotatorAgreement: { a: string; b: string; n: number; agreement: number | null; kappa: number | null }[];
  bias: BiasCheck[];
};

const r3 = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x.toFixed(3));
const rate = (r: RateCi) => (r.p === null ? '—' : `${r.p.toFixed(3)}${r.ci ? ` [${r.ci[0].toFixed(2)}, ${r.ci[1].toFixed(2)}]` : ''}（${r.k}/${r.n}）`);
const kindLabel: Record<string, string> = { deterministic: '規則エンジン', criteria: '事前基準', llm_judge: 'LLM Judge', human: '人', composite: '複合評価' };

export default function ValidationPage() {
  const [sets, setSets] = useState<LabelSet[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', purpose: 'external_gold', source: '', guidelineVersion: 'v1' });
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadSets = useCallback(() => api<{ sets: LabelSet[] }>('/label-sets').then((r) => setSets(r.sets)).catch((e) => setError(e.message)), []);
  const loadDetail = useCallback((id: string) => api<Detail>(`/label-sets/${id}`).then(setDetail).catch((e) => setError(e.message)), []);
  useEffect(() => {
    loadSets();
  }, [loadSets]);
  useEffect(() => {
    if (selected) loadDetail(selected);
  }, [selected, loadDetail]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setMsg(null);
    try {
      const m = await fn();
      if (m) setMsg(m);
      await loadSets();
      if (selected) await loadDetail(selected);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!sets) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="評価器の検証"
        description="外部の正解ラベル（専門家などが付けたもの）に対して、規則エンジン・事前基準・LLM Judge・複合評価の正確さを比べます。正解ラベルがない場合、適合率・再現率などは表示しません（未測定）。"
      />
      {error && (
        <Alert kind="error" title="エラー" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {msg && <Alert kind="success" title={msg} onClose={() => setMsg(null)} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="データセット" description="名前ごとに版を持ちます。固定した版のラベルは変更できません（変更は新しい版で行います）。">
          <Table head={['名前', '版', '用途', 'ラベル', '']} empty="データセットはまだありません。">
            {sets.map((s) => (
              <tr key={s.id} className={s.id === selected ? 'bg-white/5' : ''}>
                <td className={td}>{s.name}</td>
                <td className={td}>
                  v{s.version}
                  {s.frozen && <Badge className="ml-1 bg-white/10 text-ink-100 ring-white/15">固定</Badge>}
                </td>
                <td className={`${td} text-xs`}>{s.purpose === 'evaluation_test' ? 'テスト用（研究結果ではない）' : '外部の正解'}</td>
                <td className={td}>{s.labelCount}</td>
                <td className={td}>
                  <Button onClick={() => setSelected(s.id)}>開く</Button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="新しいデータセット">
          <div className="space-y-3">
            <Field label="名前" required>
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="用途">
              <select className={inputClass} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
                <option value="external_gold">外部の正解ラベル（研究の評価に使う）</option>
                <option value="evaluation_test">評価器のテスト用（合成など。研究結果ではない）</option>
              </select>
            </Field>
            <Field label="出典（誰が、どの基準で付けたか）" required>
              <input className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
            </Field>
            <Field label="ラベル付けの基準の版">
              <input className={inputClass} value={form.guidelineVersion} onChange={(e) => setForm({ ...form, guidelineVersion: e.target.value })} />
            </Field>
            <Button
              variant="primary"
              busy={busy === 'create'}
              onClick={() =>
                run('create', async () => {
                  const r = await api<{ set: LabelSet }>('/label-sets', { method: 'POST', body: form });
                  setSelected(r.set.id);
                  return `データセット「${r.set.name}」v${r.set.version} を作成しました。`;
                })
              }
            >
              作成
            </Button>
          </div>
        </Card>
      </div>

      {detail && selected && (
        <>
          <Card
            title={`${detail.set.name} v${detail.set.version}`}
            description={`出典: ${detail.set.source}・基準 ${detail.set.guidelineVersion}・正解 ${detail.gold.labeled} 件（評価者の間で割れて除外 ${detail.gold.disputed} 件）・評価者 ${detail.gold.annotators.join(', ') || 'なし'}`}
            actions={
              <>
                {!detail.set.frozen && (
                  <Button busy={busy === 'freeze'} onClick={() => run('freeze', async () => void (await api(`/label-sets/${selected}/actions`, { method: 'POST', body: { action: 'freeze' } })))}>
                    固定する
                  </Button>
                )}
                <Button
                  busy={busy === 'ver'}
                  onClick={() =>
                    run('ver', async () => {
                      const r = await api<{ set: LabelSet }>(`/label-sets/${selected}/actions`, { method: 'POST', body: { action: 'new_version' } });
                      setSelected(r.set.id);
                      return `新しい版 v${r.set.version} を作成しました。`;
                    })
                  }
                >
                  新しい版
                </Button>
              </>
            }
          >
            {detail.isTestData && <Alert kind="warning" title="評価器のテスト用データです。研究結果としては扱いません。" />}
            {detail.includesMock && <Alert kind="warning" title="モックの研究の判断を含みます（AI の行動の研究結果ではありません）。" />}
            {!detail.set.frozen && (
              <div className="mt-3 space-y-2">
                <Field label="ラベルの CSV（列: study_id, condition_id, replicate, step, annotator, category, formal, note）" hint={`category: ${Object.keys(evalCategoryLabels).join(' / ')}・formal: compliant / violation / 空欄`}>
                  <textarea className={`${inputClass} h-28 font-mono text-xs`} value={csv} onChange={(e) => setCsv(e.target.value)} />
                </Field>
                <Button
                  busy={busy === 'csv'}
                  onClick={() =>
                    run('csv', async () => {
                      const r = await api<{ added: number }>(`/label-sets/${selected}/labels`, { method: 'POST', body: { csv } });
                      setCsv('');
                      return `${r.added} 件のラベルを登録しました。`;
                    })
                  }
                >
                  ラベルを登録
                </Button>
              </div>
            )}
          </Card>

          <Card title="評価器ごとの指標" description="「問題あり」は明示的違反・趣旨逸脱を陽性とした2値の指標です。区間は 95%（比率は Wilson、κ はブートストラップ）。">
            <Table head={['評価器', '状態', '件数', '正解率', 'κ', 'マクロ F1', '適合率', '再現率', 'FPR', 'FNR']}>
              {[...detail.metrics, ...detail.formalMetrics].map((m) => (
                <tr key={`${m.evaluator.id}-${m.evaluator.name}`}>
                  <td className={`${td} text-xs`}>
                    {kindLabel[m.evaluator.kind] ?? m.evaluator.kind}: {m.evaluator.name}
                    {m.evaluator.model && <span className="text-ink-300">（{m.evaluator.model}）</span>}
                    {m.evaluator.independentOfGenerator === false && <Badge className="ml-1 bg-amber-500/15 text-amber-200 ring-amber-400/30">自己評価</Badge>}
                  </td>
                  <td className={td}>{m.status === 'measured' ? '測定' : <span className="text-amber-200">未測定</span>}</td>
                  <td className={td}>{m.n}</td>
                  <td className={`${td} text-xs`}>{m.status === 'measured' ? rate(m.accuracy) : '—'}</td>
                  <td className={`${td} text-xs`}>
                    {r3(m.kappa)}
                    {m.kappaCi && ` [${m.kappaCi[0].toFixed(2)}, ${m.kappaCi[1].toFixed(2)}]`}
                  </td>
                  <td className={td}>{r3(m.macroF1)}</td>
                  <td className={`${td} text-xs`}>{m.status === 'measured' ? rate(m.binary.precision) : '—'}</td>
                  <td className={`${td} text-xs`}>{m.status === 'measured' ? rate(m.binary.recall) : '—'}</td>
                  <td className={`${td} text-xs`}>{m.status === 'measured' ? rate(m.binary.fpr) : '—'}</td>
                  <td className={`${td} text-xs`}>{m.status === 'measured' ? rate(m.binary.fnr) : '—'}</td>
                </tr>
              ))}
            </Table>
          </Card>

          {detail.metrics
            .filter((m) => m.status === 'measured')
            .map((m) => (
              <Card key={m.evaluator.id} title={`${kindLabel[m.evaluator.kind]}: ${m.evaluator.name} — 混同行列とクラス別の指標`} description={`評価の版 ${m.evaluator.version}`}>
                {m.warnings.length > 0 && (
                  <ul className="mb-3 list-disc space-y-1 pl-5 text-xs text-amber-200">
                    {m.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Table head={['正解 \\ 予測', ...m.categories.map((c) => evalCategoryLabels[c])]}>
                    {m.categories.map((g) => (
                      <tr key={g}>
                        <td className={`${td} text-xs`}>{evalCategoryLabels[g]}</td>
                        {m.categories.map((p) => (
                          <td key={p} className={`${td} text-center ${g === p ? 'font-semibold text-white' : 'text-ink-200'}`}>
                            {m.confusion[g]?.[p] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Table>
                  <Table head={['クラス', '正解の件数', '適合率', '再現率', 'F1']}>
                    {m.perClass.map((c) => (
                      <tr key={c.category}>
                        <td className={`${td} text-xs`}>{evalCategoryLabels[c.category]}</td>
                        <td className={td}>{c.support}</td>
                        <td className={`${td} text-xs`}>{rate(c.precision)}</td>
                        <td className={`${td} text-xs`}>{rate(c.recall)}</td>
                        <td className={td}>{r3(c.f1)}</td>
                      </tr>
                    ))}
                  </Table>
                </div>
                {m.byUncertainty.length > 0 && (
                  <p className="mt-3 text-xs text-ink-200">
                    自己申告の不確実性ごとの正解率（自信と正解率は別のものです）: {m.byUncertainty.map((b) => `${b.uncertainty === 'none' ? '申告なし' : b.uncertainty} ${rate(b.accuracy)}`).join(' / ')}
                  </p>
                )}
              </Card>
            ))}

          <Card title="評価のバイアスと一致" description="同じ判断を評価した2者の一致です。一致が低いほど、その要因（モデル・プロンプト・順序など）に評価が影響されている可能性があります。どちらが正しいかは正解ラベルとの比較で判断します。">
            <Table head={['検証', 'A', 'B', '件数', '一致率', 'κ', 'A の正解率', 'B の正解率']} empty="比較できる組み合わせがありません（同じ判断を評価した Judge が2つ以上必要です）。">
              {detail.bias.map((b, i) => (
                <tr key={i}>
                  <td className={`${td} whitespace-normal text-xs`}>{b.title}</td>
                  <td className={`${td} text-xs`}>{b.a}</td>
                  <td className={`${td} text-xs`}>{b.b}</td>
                  <td className={td}>{b.n}</td>
                  <td className={td}>{r3(b.agreement)}</td>
                  <td className={td}>{r3(b.kappa)}</td>
                  <td className={`${td} text-xs`}>{b.accuracyA ? rate(b.accuracyA) : '未測定'}</td>
                  <td className={`${td} text-xs`}>{b.accuracyB ? rate(b.accuracyB) : '未測定'}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
