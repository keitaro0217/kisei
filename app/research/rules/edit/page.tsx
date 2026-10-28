'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass, Loading, PageHeader } from '@/components/research/ui';
import { api, ApiError } from '@/lib/research/client';
import type { RuleVersion } from '@/lib/research/study-types';

// 規則の作成・新しい版の作成。判定ロジックは JSON（規則 DSL）で記述し、サーバーで構文と変数を検証する。

const TEXT_FIELDS: { key: keyof Form; label: string; rows?: number; required?: boolean; hint?: string }[] = [
  { key: 'name', label: '規則名', required: true },
  { key: 'industry', label: '業界' },
  { key: 'market', label: '市場' },
  { key: 'text', label: '条文（エージェントに提示する文）', rows: 4, required: true },
  { key: 'purpose', label: '規制目的・趣旨', rows: 2, hint: '条件で「趣旨の提示」を有効にしたときに提示されます。' },
  { key: 'applicability', label: '適用対象', rows: 2 },
  { key: 'prohibitedActions', label: '禁止行為', rows: 2 },
  { key: 'permittedActions', label: '許容行為', rows: 2 },
  { key: 'exceptions', label: '例外条件', rows: 2 },
  { key: 'references', label: '参照条文・出典', rows: 2 },
];

type Form = {
  ruleKey: string;
  name: string;
  industry: string;
  market: string;
  purpose: string;
  text: string;
  applicability: string;
  prohibitedActions: string;
  permittedActions: string;
  exceptions: string;
  references: string;
  parameters: string;
  checks: string;
  intentCriteria: string;
};

const EXAMPLE_CHECKS = JSON.stringify(
  [
    {
      code: 'MAX_ORDER_QTY',
      message: '1回の注文数量の上限を超えています',
      violation: {
        all: [
          { in: { var: 'order.action' }, values: ['buy', 'sell'] },
          { cmp: '>', left: { var: 'order.quantity' }, right: { param: 'maxQty' } },
        ],
      },
    },
  ],
  null,
  2,
);

const emptyForm: Form = {
  ruleKey: '',
  name: '',
  industry: '証券',
  market: '合成市場（研究用）',
  purpose: '',
  text: '',
  applicability: '',
  prohibitedActions: '',
  permittedActions: '',
  exceptions: '',
  references: '',
  parameters: JSON.stringify({ maxQty: 1000 }, null, 2),
  checks: EXAMPLE_CHECKS,
  intentCriteria: '[]',
};

function toForm(r: RuleVersion): Form {
  return {
    ruleKey: r.ruleKey,
    name: r.name,
    industry: r.industry,
    market: r.market,
    purpose: r.purpose,
    text: r.text,
    applicability: r.applicability,
    prohibitedActions: r.prohibitedActions,
    permittedActions: r.permittedActions,
    exceptions: r.exceptions,
    references: r.references,
    parameters: JSON.stringify(r.parameters, null, 2),
    checks: JSON.stringify(r.checks, null, 2),
    intentCriteria: JSON.stringify(r.intentCriteria, null, 2),
  };
}

function Editor() {
  const router = useRouter();
  const fromId = useSearchParams().get('from');
  const [form, setForm] = useState<Form | null>(fromId ? null : emptyForm);
  const [source, setSource] = useState<RuleVersion | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ rules: RuleVersion[]; variables: Record<string, string> }>('/rules')
      .then((res) => {
        setVariables(res.variables);
        if (fromId) {
          const r = res.rules.find((x) => x.id === fromId);
          if (!r) {
            setError({ message: '元の規則の版が見つかりません。' });
            setForm(emptyForm);
          } else {
            setSource(r);
            setForm(toForm(r));
          }
        }
      })
      .catch((e) => setError({ message: e.message }));
  }, [fromId]);

  if (!form) return <Loading />;
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    const parsed: Record<string, unknown> = {};
    for (const k of ['parameters', 'checks', 'intentCriteria'] as const) {
      try {
        parsed[k] = JSON.parse(form[k] || (k === 'parameters' ? '{}' : '[]'));
      } catch {
        setError({ message: `「${k}」の JSON の形式が正しくありません。`, field: k });
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await api('/rules', { method: 'POST', body: { ...form, ...parsed } });
      router.push('/research/rules');
    } catch (e) {
      setError({ message: (e as Error).message, field: e instanceof ApiError ? e.field : undefined });
      setBusy(false);
    }
  };

  const logicChanged =
    source !== null &&
    (form.parameters !== JSON.stringify(source.parameters, null, 2) ||
      form.checks !== JSON.stringify(source.checks, null, 2) ||
      form.intentCriteria !== JSON.stringify(source.intentCriteria, null, 2));

  return (
    <>
      <PageHeader
        title={source ? `${source.ruleKey} の新しい版` : '新しい規則'}
        description={source ? `v${source.version} を元に新しい版を作成します。保存しても v${source.version} は変更されません。` : '規則IDは版をまたいで同じ規則を指します。既存の規則IDで保存すると、その規則の新しい版になります。'}
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="保存できませんでした" onClose={() => setError(null)}>
            {error.message}
            {error.field && <span className="ml-1 font-mono text-xs">（{error.field}）</span>}
          </Alert>
        </div>
      )}
      {logicChanged && (
        <div className="mb-4">
          <Alert kind="info" title="判定ロジックが変更されています">
            保存すると新しい版として記録され、判定ロジックのハッシュが変わります。実行済みの研究は凍結時点の版で判定されたままです。
          </Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card title="条文と説明">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="規則ID" required hint="英字で始まる英数字・-・_（例: SPOOF-AND）">
                <input className={inputClass} value={form.ruleKey} onChange={set('ruleKey')} disabled={source !== null} />
              </Field>
              {TEXT_FIELDS.map((f) => (
                <div key={f.key} className={f.rows ? 'md:col-span-2' : ''}>
                  <Field label={f.label} required={f.required} hint={f.hint}>
                    {f.rows ? (
                      <textarea className={inputClass} rows={f.rows} value={form[f.key]} onChange={set(f.key)} />
                    ) : (
                      <input className={inputClass} value={form[f.key]} onChange={set(f.key)} />
                    )}
                  </Field>
                </div>
              ))}
            </div>
          </Card>
          <Card title="判定ロジック（規則 DSL）" description="checks は違反すれば注文を拒否（REJECT）する条件、intentCriteria は受理した注文のうち規制趣旨からの逸脱として記録する事前定義の基準です。">
            <div className="space-y-4">
              <Field label="閾値（parameters）" hint='例: {"maxQty": 1000}。判定式から {"param": "maxQty"} で参照します。'>
                <textarea className={`${inputClass} font-mono text-xs`} rows={4} value={form.parameters} onChange={set('parameters')} spellCheck={false} />
              </Field>
              <Field label="実行可否の判定（checks）">
                <textarea className={`${inputClass} font-mono text-xs`} rows={14} value={form.checks} onChange={set('checks')} spellCheck={false} />
              </Field>
              <Field label="趣旨逸脱の基準（intentCriteria）">
                <textarea className={`${inputClass} font-mono text-xs`} rows={8} value={form.intentCriteria} onChange={set('intentCriteria')} spellCheck={false} />
              </Field>
            </div>
          </Card>
          <div className="flex gap-2">
            <Button variant="primary" busy={busy} onClick={save}>
              {source ? '新しい版として保存' : '保存'}
            </Button>
            <Button onClick={() => router.push('/research/rules')}>キャンセル</Button>
          </div>
        </div>
        <Card title="DSL の書き方">
          <div className="space-y-3 text-xs leading-relaxed text-ink-200">
            <p>
              条件: <code className="text-white">all</code> / <code className="text-white">any</code> / <code className="text-white">not</code> /{' '}
              <code className="text-white">cmp</code>（&lt; &lt;= &gt; &gt;= == !=）/ <code className="text-white">in</code> /{' '}
              <code className="text-white">always</code>
            </p>
            <p>
              式: <code className="text-white">var</code>（下の変数）/ <code className="text-white">const</code> / <code className="text-white">param</code> /{' '}
              <code className="text-white">op</code>（add, sub, mul, abs）
            </p>
            <p className="font-semibold text-ink-100">使用できる変数</p>
            <ul className="space-y-1.5">
              {Object.entries(variables).map(([k, v]) => (
                <li key={k}>
                  <code className="text-white">{k}</code>
                  <br />
                  {v}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </>
  );
}

export default function RuleEditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Editor />
    </Suspense>
  );
}
