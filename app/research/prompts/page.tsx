'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { PromptSet } from '@/lib/research/study-types';

// 取引エージェントへのプロンプトの版管理。{{名前}} の差し込み位置だけが値に置き換わり、テンプレートがコードとして実行されることはない。

const FIELDS: { key: 'system' | 'trading' | 'rulePresentation' | 'purposePresentation' | 'outputSchema'; label: string; rows: number; hint: string }[] = [
  { key: 'system', label: 'システムプロンプト', rows: 6, hint: '{{PERSONA}} {{OBJECTIVE}} {{OUTPUT_SCHEMA}}（必須）' },
  { key: 'trading', label: '取引プロンプト（各ステップ）', rows: 10, hint: '{{RULES}}（必須）{{PURPOSE}} {{STEP}} {{TOTAL_STEPS}} {{PRICE}}（必須）{{LAST_TRADE_PRICE}} {{PRICE_HISTORY}} {{CASH}} {{POSITION}} {{OPEN_ORDERS}}' },
  { key: 'rulePresentation', label: '条文の提示形式', rows: 2, hint: '{{RULE_TEXTS}}（必須）' },
  { key: 'purposePresentation', label: '規制趣旨の提示形式', rows: 2, hint: '{{PURPOSE_TEXTS}}（必須）' },
  { key: 'outputSchema', label: '出力形式（JSON の説明）', rows: 10, hint: '取引エージェントに求める出力の形式。解析は action・order_type・quantity・limit_price・cancel_order_id・rationale・cited_rules・self_assessed_compliance を読みます。' },
];

export default function PromptsPage() {
  const basic = useBasicSettings() ?? undefined;
  const [prompts, setPrompts] = useState<PromptSet[] | null>(null);
  const [form, setForm] = useState<Omit<PromptSet, 'id' | 'version' | 'createdAt'> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<{ prompts: PromptSet[] }>('/prompts')
      .then((r) => setPrompts(r.prompts))
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const edit = (p: PromptSet) => {
    setSaved(null);
    setForm({ name: p.name, system: p.system, trading: p.trading, rulePresentation: p.rulePresentation, purposePresentation: p.purposePresentation, outputSchema: p.outputSchema });
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ prompt: PromptSet }>('/prompts', { method: 'POST', body: form });
      setSaved(`${res.prompt.name} v${res.prompt.version} を保存しました。`);
      setForm(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="プロンプト" description="取引エージェントに渡すプロンプトを版ごとに管理します。保存するたびに新しい版になり、研究の開始時に使用した版が凍結されます。" />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      {saved && (
        <div className="mb-4">
          <Alert kind="success" title={saved} onClose={() => setSaved(null)} />
        </div>
      )}
      <div className="space-y-6">
        <Card title="版の一覧">
          {prompts === null ? (
            <Loading />
          ) : (
            <Table head={['名称', '版', '作成日時', '']}>
              {prompts.map((p) => (
                <tr key={p.id}>
                  <td className={td}>{p.name}</td>
                  <td className={td}>v{p.version}</td>
                  <td className={td}>{formatDate(p.createdAt, basic)}</td>
                  <td className={td}>
                    <Button variant="ghost" onClick={() => edit(p)}>
                      この版を元に新しい版を作成
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        {form && (
          <Card title="新しい版" description="同じ名称で保存すると、その名称の次の版になります。別の名称にすると新しいプロンプトとして版1から始まります。">
            <div className="space-y-4">
              <Field label="名称" required>
                <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              {FIELDS.map((f) => (
                <Field key={f.key} label={f.label} hint={f.hint} required>
                  <textarea className={`${inputClass} font-mono text-xs`} rows={f.rows} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} spellCheck={false} />
                </Field>
              ))}
              <div className="flex gap-2">
                <Button variant="primary" busy={busy} onClick={save}>
                  新しい版として保存
                </Button>
                <Button onClick={() => setForm(null)}>キャンセル</Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
