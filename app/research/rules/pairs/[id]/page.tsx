'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import { diffText, type DiffPart } from '@/lib/research/diff';
import { classificationLabels, reviewLabels } from '@/lib/research/study-labels';
import type { EquivalenceReview, PairClassification, RulePair, RuleVersion } from '@/lib/research/study-types';

function DiffView({ parts, side }: { parts: DiffPart[]; side: 'a' | 'b' }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-100">
      {parts.map((p, i) => {
        if (p.kind === 'same') return <span key={i}>{p.text}</span>;
        if (side === 'a' && p.kind === 'removed') {
          return (
            <del key={i} className="rounded bg-rose-500/25 px-0.5 text-rose-100 decoration-rose-300">
              {p.text}
            </del>
          );
        }
        if (side === 'b' && p.kind === 'added') {
          return (
            <ins key={i} className="rounded bg-emerald-500/25 px-0.5 text-emerald-100 no-underline">
              {p.text}
            </ins>
          );
        }
        return null;
      })}
    </p>
  );
}

const FIELDS: [keyof RuleVersion, string][] = [
  ['purpose', '規制目的'],
  ['applicability', '適用対象'],
  ['prohibitedActions', '禁止行為'],
  ['permittedActions', '許容行為'],
  ['exceptions', '例外条件'],
];

export default function PairPage() {
  const { id } = useParams<{ id: string }>();
  const basic = useBasicSettings() ?? undefined;
  const [pair, setPair] = useState<RulePair | null>(null);
  const [rules, setRules] = useState<RuleVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<EquivalenceReview>('unreviewed');
  const [classification, setClassification] = useState<PairClassification>('other');
  const [note, setNote] = useState('');

  useEffect(() => {
    Promise.all([api<{ pairs: RulePair[] }>('/rule-pairs'), api<{ rules: RuleVersion[] }>('/rules')])
      .then(([p, r]) => {
        const found = p.pairs.find((x) => x.id === id) ?? null;
        if (!found) setError('ミニマルペアが見つかりません。');
        setPair(found);
        setRules(r.rules);
        if (found) {
          setReview(found.equivalenceReview);
          setClassification(found.classification);
          setNote(found.reviewNote);
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

  const a = rules.find((r) => r.id === pair?.ruleA.id);
  const b = rules.find((r) => r.id === pair?.ruleB.id);
  const textDiff = useMemo(() => (a && b ? diffText(a.text, b.text) : []), [a, b]);
  const logicA = a ? JSON.stringify({ parameters: a.parameters, checks: a.checks, intentCriteria: a.intentCriteria }, null, 2) : '';
  const logicB = b ? JSON.stringify({ parameters: b.parameters, checks: b.checks, intentCriteria: b.intentCriteria }, null, 2) : '';

  if (error && !pair) return <Alert kind="error" title="エラー">{error}</Alert>;
  if (!pair || !a || !b) return <Loading />;

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api<{ pair: RulePair }>(`/rule-pairs/${id}`, { method: 'PATCH', body: { equivalenceReview: review, classification, reviewNote: note } });
      setPair(res.pair);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={pair.name}
        description="条文Aと条文Bの差分を確認します。削除された部分は赤、追加された部分は緑で表示します。"
        actions={
          <Link href={`/research/studies/new?pair=${pair.id}`} className="rc-primary inline-flex rounded-md px-3.5 py-1.5 text-sm font-medium">
            このペアで研究を作成
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
      {pair.equivalenceReview !== 'approved' && (
        <div className="mb-4">
          <Alert kind="warning" title="差分の分類と意味の等価性は研究者が確認してください">
            自動では確定しません。確認するまで、このペアは「未確認」として研究レポートに記録されます。
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {[
            { label: '条文A', rule: a, side: 'a' as const },
            { label: '条文B', rule: b, side: 'b' as const },
          ].map(({ label, rule, side }) => (
            <Card key={side} title={`${label}: ${rule.ruleKey} v${rule.version}`} description={rule.name}>
              <DiffView parts={textDiff} side={side} />
              <dl className="mt-4 space-y-2 border-t border-white/10 pt-3 text-xs">
                {FIELDS.map(([k, l]) => (
                  <div key={k}>
                    <dt className="text-ink-300">{l}</dt>
                    <dd className="text-ink-100">{String(rule[k] || '—')}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-ink-300">判定ロジックのハッシュ</dt>
                  <dd className="font-mono text-ink-100">{rule.logicHash}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>

        <Card title="判定ロジックの比較" description={a.logicHash === b.logicHash ? '判定ロジックは同一です（文言だけが異なります）。' : '判定ロジックが異なります。'}>
          <div className="grid gap-4 md:grid-cols-2">
            {[logicA, logicB].map((l, i) => (
              <pre key={i} className="max-h-96 overflow-auto rounded-lg bg-ink-950/50 p-3 font-mono text-[11px] leading-relaxed text-ink-100">
                {l}
              </pre>
            ))}
          </div>
        </Card>

        <Card title="研究者による確認">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 text-sm text-ink-100">
              <p>
                <span className="text-ink-300">変更した語句: </span>
                {pair.changedTerms || '—'}
              </p>
              <p>
                <span className="text-ink-300">仮説: </span>
                {pair.hypothesis || '—'}
              </p>
              <p className="pt-2">
                <Badge className={reviewLabels[pair.equivalenceReview].className}>{reviewLabels[pair.equivalenceReview].label}</Badge>
                {pair.reviewedBy && (
                  <span className="ml-2 text-xs text-ink-300">
                    {pair.reviewedBy}・{formatDate(pair.reviewedAt, basic)}
                  </span>
                )}
              </p>
            </div>
            <div className="space-y-3">
              <Field label="差分の分類">
                <select className={inputClass} value={classification} onChange={(e) => setClassification(e.target.value as PairClassification)}>
                  {Object.entries(classificationLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="確認結果">
                <select className={inputClass} value={review} onChange={(e) => setReview(e.target.value as EquivalenceReview)}>
                  {Object.entries(reviewLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="確認メモ">
                <textarea className={inputClass} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
              <div className="flex items-center gap-3">
                <Button variant="primary" busy={busy} onClick={save}>
                  確認結果を保存
                </Button>
                {saved && <span className="text-xs text-emerald-300">保存しました</span>}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
