'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { MonitorAlert, MonitorEvent, MonitorSource } from '@/lib/research/monitor-types';
import type { RuleVersion } from '@/lib/research/study-types';

// 監視（試験版）: 外部の AI エージェントの行動イベントを取り込み、規則エンジンで一次判定して警告を出す。

type Overview = {
  sources: MonitorSource[];
  stats: { sourceId: string; events: number; flagged: number; ruleViolations: number; similarToKnown: number; judgeSampled: number; samples: number }[];
  alerts: MonitorAlert[];
};

const ALERT_STATUS: Record<MonitorAlert['status'], { label: string; className: string }> = {
  open: { label: '未対応', className: 'bg-rose-500/10 text-rose-200 ring-rose-400/30' },
  acknowledged: { label: '確認済み', className: 'bg-amber-500/10 text-amber-200 ring-amber-400/30' },
  resolved: { label: '解決', className: 'bg-emerald-500/10 text-emerald-200 ring-emerald-400/30' },
};

export default function MonitoringPage() {
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<Overview | null>(null);
  const [rules, setRules] = useState<RuleVersion[]>([]);
  const [events, setEvents] = useState<{ sourceId: string; items: MonitorEvent[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', ruleVersionIds: [] as string[], judgeSamplingRate: '0.1', alertViolationRate: '0.2', retentionDays: '30' });

  const load = useCallback(
    () =>
      api<Overview>('/monitoring')
        .then(setData)
        .catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    load();
    api<{ rules: RuleVersion[] }>('/rules')
      .then((r) => setRules(r.rules))
      .catch(() => undefined);
  }, [load]);

  const call = async <T,>(fn: () => Promise<T>) => {
    setError(null);
    try {
      const r = await fn();
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };
  const showEvents = (sourceId: string) =>
    api<{ events: MonitorEvent[] }>(`/monitoring/sources/${sourceId}/events?limit=100`)
      .then((r) => setEvents({ sourceId, items: r.events }))
      .catch((e) => setError(e.message));

  return (
    <>
      <PageHeader
        title="監視（試験版）"
        description="外部の AI エージェントの行動イベントを取り込み、規則エンジンで一次判定して、既知の Failure との類似や規則違反率の上昇を警告します。"
      />
      <div className="mb-4">
        <Alert kind="warning" title="試験版です">
          共有パスワードのログインのみで、個別アカウント・権限管理がないため、外部企業の本番データの接続には使わないでください。指摘のあるイベントの LLM Judge への抽出は記録のみで、評価の実行はこの版では行いません。
        </Alert>
      </div>
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      {token && (
        <div className="mb-4">
          <Alert kind="success" title="接続元を作成しました。トークンは今だけ表示されます" onClose={() => setToken(null)}>
            <code className="break-all text-white">{token}</code>
            <p className="mt-1 text-xs">送信先: POST /api/monitor/events（ヘッダー Authorization: Bearer トークン、本文は JSON）。トークンはサーバーにはハッシュだけを保存しており、再表示できません。</p>
          </Alert>
        </div>
      )}
      {!data ? (
        <Loading />
      ) : (
        <div className="space-y-6">
          <Card title="接続元を作成">
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="名前" required>
                <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <div className="md:col-span-2">
                <Field label="一次判定に使う規則" hint="Ctrl / ⌘ で複数選択">
                  <select multiple className={`${inputClass} h-24`} value={form.ruleVersionIds} onChange={(e) => setForm({ ...form, ruleVersionIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
                    {rules.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.ruleKey} v{r.version}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Judge への抽出率（0〜1）">
                <input className={inputClass} value={form.judgeSamplingRate} onChange={(e) => setForm({ ...form, judgeSamplingRate: e.target.value })} />
              </Field>
              <Field label="警告: 違反率の閾値（0〜1）">
                <input className={inputClass} value={form.alertViolationRate} onChange={(e) => setForm({ ...form, alertViolationRate: e.target.value })} />
              </Field>
            </div>
            <Button
              variant="primary"
              className="mt-3"
              onClick={() =>
                call(() => api<{ token: string }>('/monitoring/sources', { method: 'POST', body: { ...form, judgeSamplingRate: Number(form.judgeSamplingRate), alertViolationRate: Number(form.alertViolationRate), retentionDays: Number(form.retentionDays) } })).then(
                  (r) => r && setToken(r.token),
                )
              }
            >
              作成してトークンを発行
            </Button>
          </Card>

          <Card title="接続元">
            <Table head={['名前', 'トークン', 'イベント', '指摘', '規則違反', '既知のパターン', 'Judge 抽出（未実行）', 'サンプル', '']} empty="接続元はまだありません">
              {data.sources.map((s) => {
                const st = data.stats.find((x) => x.sourceId === s.id);
                return (
                  <tr key={s.id}>
                    <td className={td}>
                      {s.name} {s.disabled && <Badge className="bg-white/5 text-ink-300 ring-white/10">無効</Badge>}
                    </td>
                    <td className={`${td} font-mono text-xs`}>{s.tokenPrefix}…</td>
                    <td className={td}>{st?.events ?? 0}</td>
                    <td className={td}>{st?.flagged ?? 0}</td>
                    <td className={td}>{st?.ruleViolations ?? 0}</td>
                    <td className={td}>{st?.similarToKnown ?? 0}</td>
                    <td className={td}>{st?.judgeSampled ?? 0}</td>
                    <td className={td}>{st?.samples ?? 0}</td>
                    <td className={`${td} space-x-1`}>
                      <Button onClick={() => call(() => api(`/monitoring/sources/${s.id}/sample`, { method: 'POST', body: { count: 30 } }))}>サンプルを送信</Button>
                      <Button variant="ghost" onClick={() => showEvents(s.id)}>
                        イベント
                      </Button>
                      <a href={`/api/research/monitoring/sources/${s.id}/report`} className="text-xs underline underline-offset-2">
                        監査レポート
                      </a>
                      <Button variant="ghost" onClick={() => call(() => api(`/monitoring/sources/${s.id}`, { method: 'PATCH', body: { disabled: !s.disabled } }))}>
                        {s.disabled ? '有効にする' : '無効にする'}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </Table>
          </Card>

          <Card title="警告">
            <Table head={['日時', '接続元', '種類', '内容', '状態', '']} empty="警告はありません">
              {data.alerts.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{formatDate(a.createdAt, basic)}</td>
                  <td className={td}>{data.sources.find((s) => s.id === a.sourceId)?.name ?? a.sourceId.slice(0, 8)}</td>
                  <td className={td}>{a.type === 'violation_rate' ? '規則違反率の上昇' : '既知の Failure と類似'}</td>
                  <td className={`${td} max-w-md whitespace-normal text-xs`}>{a.message}</td>
                  <td className={td}>
                    <Badge className={ALERT_STATUS[a.status].className}>{ALERT_STATUS[a.status].label}</Badge>
                  </td>
                  <td className={`${td} space-x-1`}>
                    {a.status === 'open' && <Button onClick={() => call(() => api(`/monitoring/alerts/${a.id}`, { method: 'PATCH', body: { status: 'acknowledged' } }))}>確認</Button>}
                    {a.status !== 'resolved' && <Button variant="ghost" onClick={() => call(() => api(`/monitoring/alerts/${a.id}`, { method: 'PATCH', body: { status: 'resolved' } }))}>解決</Button>}
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          {events && (
            <Card title={`イベント（${data.sources.find((s) => s.id === events.sourceId)?.name ?? ''}・直近100件）`}>
              <Table head={['受信', 'エージェント', '行動', '判定', 'コード', '既知のパターン', 'Judge 抽出', '']}>
                {events.items.map((e) => (
                  <tr key={e.id}>
                    <td className={td}>{formatDate(e.receivedAt, basic)}</td>
                    <td className={`${td} text-xs`}>{e.input.agentId}</td>
                    <td className={`${td} text-xs`}>
                      {e.input.action} {e.input.quantity ?? e.input.cancel?.quantity ?? ''}
                    </td>
                    <td className={td}>{e.result.verdict}</td>
                    <td className={`${td} font-mono text-xs`}>{[...e.result.codes, ...e.result.deviations].join(', ') || '—'}</td>
                    <td className={`${td} font-mono text-xs`}>{e.result.similarFailure ?? '—'}</td>
                    <td className={td}>{e.result.judgeSampled ? '抽出（未実行）' : '—'}</td>
                    <td className={td}>{e.isSample && <Badge className="bg-violet-500/10 text-violet-200 ring-violet-400/30">サンプル</Badge>}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
