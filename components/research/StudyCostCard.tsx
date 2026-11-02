'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import type { StudyEstimate } from '@/lib/server/research/study/operations';

const usd = (v: number | null) => (v === null ? '—' : `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);

/** API 費用の事前見積もりと、研究ごとの費用の上限 */
export default function StudyCostCard({ studyId, editable, refreshKey }: { studyId: string; editable: boolean; refreshKey: string }) {
  const [est, setEst] = useState<StudyEstimate | null>(null);
  const [cap, setCap] = useState('');
  const [msg, setMsg] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api<{ estimate: StudyEstimate }>(`/studies/${studyId}/estimate`)
        .then((r) => {
          setEst(r.estimate);
          setCap((c) => (c === '' && r.estimate.maxCostUsd !== null ? String(r.estimate.maxCostUsd) : c));
        })
        .catch((e) => setMsg({ kind: 'error', text: e.message })),
    [studyId],
  );
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!est) return null;
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/studies/${studyId}/actions`, { method: 'POST', body: { action: 'budget', maxCostUsd: cap.trim() === '' ? null : Number(cap) } });
      setMsg({ kind: 'success', text: cap.trim() === '' ? '費用の上限を解除しました。' : `費用の上限を $${cap} にしました。` });
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const over = est.estimatedUsd !== null && est.maxCostUsd !== null && est.spentUsd + est.estimatedUsd > est.maxCostUsd;

  return (
    <Card title="API 費用" description="見積もりは目安です。実際の費用は各サービスの請求で確認してください。上限に達すると研究を一時停止します。">
      <dl className="grid gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-300">残りの呼び出し回数</dt>
          <dd className="text-ink-50">{est.calls.toLocaleString()} 回</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-300">見積もり（残り）</dt>
          <dd className="text-ink-50">{usd(est.estimatedUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-300">使った費用</dt>
          <dd className="text-ink-50">{usd(est.spentUsd)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-300">1回あたりのトークン（{est.tokensPerCall.basis === 'observed' ? '実績' : '想定'}）</dt>
          <dd className="text-ink-50">
            入力 {est.tokensPerCall.input.toLocaleString()} / 出力 {est.tokensPerCall.output.toLocaleString()}
          </dd>
        </div>
      </dl>
      {est.model && <p className="mt-2 text-xs text-ink-300">モデル: {est.model}{est.price ? `（単価: 入力 $${est.price.inputPerMTok} / 出力 $${est.price.outputPerMTok} / 100万トークン）` : ''}</p>}
      {est.note && <p className="mt-2 text-xs text-amber-200">{est.note}</p>}
      {over && <p className="mt-2 text-xs text-amber-200">見積もりが費用の上限を超えています。上限に達した時点で研究を一時停止します。</p>}
      {editable && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="費用の上限（米ドル・空欄で上限なし）">
            <input className={`${inputClass} w-40`} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="例: 5" />
          </Field>
          <Button busy={busy} onClick={save}>
            上限を保存
          </Button>
        </div>
      )}
      {msg && (
        <div className="mt-3">
          <Alert kind={msg.kind} title={msg.text} onClose={() => setMsg(null)} />
        </div>
      )}
    </Card>
  );
}
