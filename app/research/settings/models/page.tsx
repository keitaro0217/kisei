'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, NoticeBar, PageHeader, type Notice } from '@/components/research/ui';
import { api, ApiError, formatUsd } from '@/lib/research/client';
import { connectionStatusLabels, reasoningSupport, researchRoles, roleLabels } from '@/lib/research/labels';
import type { ProviderDTO, ReasoningEffort, ResearchRole, RoleAssignment } from '@/lib/research/types';

const EFFORT_LABELS: Record<ReasoningEffort, string> = { low: '低', medium: '中', high: '高', xhigh: '最高', max: '最大' };

type Draft = { providerId: string; model: string; effort: string; thinkingBudget: string; maxOutputTokens: string };

function toDraft(r: RoleAssignment): Draft {
  return {
    providerId: r.providerId ?? '',
    model: r.model ?? '',
    effort: r.reasoning.effort ?? '',
    thinkingBudget: r.reasoning.thinkingBudget === null || r.reasoning.thinkingBudget === undefined ? '' : String(r.reasoning.thinkingBudget),
    maxOutputTokens: String(r.maxOutputTokens),
  };
}

function RoleCard({ role, assignment, providers, onSaved }: { role: ResearchRole; assignment: RoleAssignment; providers: ProviderDTO[]; onSaved: (r: RoleAssignment, n: Notice) => void }) {
  const [draft, setDraft] = useState<Draft>(toDraft(assignment));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [testOutput, setTestOutput] = useState<{ ok: boolean; text: string } | null>(null);
  const provider = providers.find((p) => p.id === draft.providerId);
  const modelInfo = provider?.models.find((m) => m.id === draft.model);
  const support = provider ? reasoningSupport[provider.type] : 'none';
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(assignment));

  const validate = () => {
    const errs: Record<string, string> = {};
    if (draft.providerId && !draft.model) errs.model = 'モデルを選択してください';
    const max = Number(draft.maxOutputTokens);
    if (!Number.isInteger(max) || max < 16 || max > 128000) errs.maxOutputTokens = '16〜128000の整数で入力してください';
    else if (modelInfo?.maxOutputTokens && max > modelInfo.maxOutputTokens) errs.maxOutputTokens = `このモデルの上限は ${modelInfo.maxOutputTokens} です`;
    if (support === 'thinkingBudget' && draft.thinkingBudget !== '' && !/^-?\d+$/.test(draft.thinkingBudget)) errs.thinkingBudget = '整数で入力してください（-1 は自動）';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setBusy('save');
    try {
      const res = await api<{ role: RoleAssignment }>(`/roles/${role}`, {
        method: 'PUT',
        body: {
          providerId: draft.providerId || null,
          model: draft.model || null,
          maxOutputTokens: Number(draft.maxOutputTokens),
          reasoning: { effort: draft.effort || null, thinkingBudget: draft.thinkingBudget === '' ? null : Number(draft.thinkingBudget) },
        },
      });
      onSaved(res.role, { kind: 'success', title: `「${roleLabels[role].label}」の割り当てを保存しました`, message: '実行中の実験には影響しません（開始時点の設定で固定されています）。' });
    } catch (e) {
      if (e instanceof ApiError && e.field) setErrors({ [e.field]: e.message });
      onSaved(assignment, { kind: 'error', title: '保存できませんでした', message: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    setTestOutput(null);
    try {
      const res = await api<{ result: { text: string; latencyMs: number; costUsd: number | null; usage: { inputTokens: number; outputTokens: number } } }>(`/roles/${role}/test`, { method: 'POST' });
      const r = res.result;
      setTestOutput({ ok: true, text: `${r.text || '（空の応答）'}\n\n— ${r.latencyMs} ms / 入力 ${r.usage.inputTokens}・出力 ${r.usage.outputTokens} トークン / 費用 ${r.costUsd === null ? '単価未設定' : formatUsd(r.costUsd, 6)}` });
    } catch (e) {
      setTestOutput({ ok: false, text: `${e instanceof ApiError && e.label ? `${e.label}: ` : ''}${e instanceof Error ? e.message : '失敗しました'}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title={roleLabels[role].label}
      description={roleLabels[role].description}
      actions={provider && <Badge className={connectionStatusLabels[provider.connection.status].className}>{connectionStatusLabels[provider.connection.status].label}</Badge>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="プロバイダー">
          <select className={inputClass} value={draft.providerId} onChange={(e) => setDraft({ ...draft, providerId: e.target.value, model: '', effort: '', thinkingBudget: '' })}>
            <option value="">（未設定）</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="モデル" error={errors.model} hint={provider && provider.models.length === 0 ? 'API連携画面で「使用可能モデルを取得」を実行してください' : undefined}>
          <select className={inputClass} value={draft.model} disabled={!provider} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
            <option value="">（選択してください）</option>
            {draft.model && provider && !provider.models.some((m) => m.id === draft.model) && <option value={draft.model}>{draft.model}</option>}
            {provider?.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName ? `${m.displayName}（${m.id}）` : m.id}
              </option>
            ))}
          </select>
        </Field>
        {support === 'effort' && (
          <Field label="推論の深さ" hint={modelInfo?.supportsReasoning === false ? 'このモデルは推論設定に対応していない可能性があります' : 'モデルが対応しない場合は未指定にしてください'}>
            <select className={inputClass} value={draft.effort} onChange={(e) => setDraft({ ...draft, effort: e.target.value })}>
              <option value="">指定しない（モデル既定）</option>
              {(Object.keys(EFFORT_LABELS) as ReasoningEffort[]).map((e) => (
                <option key={e} value={e}>
                  {EFFORT_LABELS[e]}（{e}）
                </option>
              ))}
            </select>
          </Field>
        )}
        {support === 'thinkingBudget' && (
          <Field label="思考トークン予算" error={errors.thinkingBudget} hint="空欄はモデル既定、-1 は自動、0 は無効">
            <input className={inputClass} inputMode="numeric" value={draft.thinkingBudget} onChange={(e) => setDraft({ ...draft, thinkingBudget: e.target.value })} />
          </Field>
        )}
        <Field label="最大出力トークン" error={errors.maxOutputTokens} hint={modelInfo?.maxOutputTokens ? `モデル上限: ${modelInfo.maxOutputTokens}` : undefined}>
          <input className={inputClass} inputMode="numeric" value={draft.maxOutputTokens} onChange={(e) => setDraft({ ...draft, maxOutputTokens: e.target.value })} />
        </Field>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {dirty && <span className="mr-auto text-xs text-amber-300">未保存の変更があります</span>}
        <Button onClick={test} busy={busy === 'test'} disabled={dirty || !assignment.providerId || !assignment.model}>
          この設定でテスト実行
        </Button>
        <Button variant="primary" onClick={save} busy={busy === 'save'} disabled={!dirty}>
          保存
        </Button>
      </div>
      {testOutput && (
        <pre className={`mt-3 whitespace-pre-wrap rounded-xl border p-3 text-xs ${testOutput.ok ? 'border-white/10 bg-ink-950/40 text-ink-50' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>{testOutput.text}</pre>
      )}
    </Card>
  );
}

export default function ModelAssignmentPage() {
  const [roles, setRoles] = useState<Record<ResearchRole, RoleAssignment> | null>(null);
  const [providers, setProviders] = useState<ProviderDTO[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api<{ roles: Record<ResearchRole, RoleAssignment> }>('/roles'), api<{ providers: ProviderDTO[] }>('/providers')])
      .then(([r, p]) => {
        setRoles(r.roles);
        setProviders(p.providers);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '読み込みに失敗しました'));
  }, []);

  return (
    <div>
      <PageHeader title="モデル割り当て" description="研究で使う役割ごとに、プロバイダーとモデルを個別に設定します。" />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      {error && <Alert kind="error" title="読み込みに失敗しました">{error}</Alert>}
      <div className="mb-4">
        <Alert kind="info" title="研究条件の固定について">
          実験を開始すると、その時点のモデル・推論設定・プロンプト・ツール構成がスナップショットとして固定され、ここでの変更は進行中の実験に影響しません。
          設定を変更して開始した実験は別の実験バージョンとして記録されます。APIキーの更新は実行中の実験にも反映されます。
        </Alert>
      </div>
      {!roles ? (
        !error && <Loading />
      ) : providers.length === 0 ? (
        <Alert kind="warning" title="APIプロバイダーが登録されていません">
          先に <Link href="/research/settings/api" className="underline">API連携</Link> でプロバイダーとAPIキーを登録してください。
        </Alert>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {researchRoles.map((role) => (
            <RoleCard
              key={`${role}-${roles[role].updatedAt}`}
              role={role}
              assignment={roles[role]}
              providers={providers}
              onSaved={(r, n) => {
                setRoles((prev) => (prev ? { ...prev, [role]: r } : prev));
                setNotice(n);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
