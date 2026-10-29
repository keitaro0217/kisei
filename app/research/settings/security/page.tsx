'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import type { AppSettings, AuditEntry, SecurityStatus } from '@/lib/research/types';

const ok = 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30';
const ng = 'bg-rose-500/10 text-rose-300 ring-rose-400/30';
const warn = 'bg-amber-500/10 text-amber-300 ring-amber-400/30';

function Row({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-sm text-white">{label}</p>
        {children && <p className="mt-0.5 text-xs text-ink-200">{children}</p>}
      </div>
      <div className="flex-shrink-0">{value}</div>
    </div>
  );
}

const PAYLOAD_MODES: { value: AppSettings['observability']['tracePayloadMode']; label: string; hint: string }[] = [
  { value: 'metadata', label: 'メタデータのみ', hint: 'プロンプト・応答の本文を保存しません（件数・トークン数・判定などの属性のみ）。' },
  { value: 'redacted', label: '伏せ字で保存（推奨）', hint: 'APIキーの形式・メールアドレス・長い数字列などを伏せて保存します。' },
  { value: 'full', label: 'そのまま保存', hint: '本文をそのまま保存します。機密情報を含む入力を扱う場合は選ばないでください。' },
];

function TraceSettingsCard() {
  const [obs, setObs] = useState<AppSettings['observability'] | null>(null);
  const [days, setDays] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ settings: AppSettings }>('/settings')
      .then((r) => {
        setObs(r.settings.observability);
        setDays(String(r.settings.observability.traceRetentionDays));
      })
      .catch((e) => setMessage({ kind: 'error', text: e.message }));
  }, []);
  if (!obs) return null;
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ settings: AppSettings }>('/settings', { method: 'PUT', body: { observability: { tracePayloadMode: obs.tracePayloadMode, traceRetentionDays: Number(days) } } });
      setObs(r.settings.observability);
      setMessage({ kind: 'success', text: '保存しました。次に開始する研究から適用されます（開始済みの研究は開始時の設定のまま）。' });
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="実行トレースの記録" description="APIキーと Authorization ヘッダーは、どの設定でも記録しません。">
      <div className="space-y-3 text-sm text-ink-100">
        {PAYLOAD_MODES.map((m) => (
          <label key={m.value} className="flex items-start gap-2">
            <input type="radio" className="mt-1" checked={obs.tracePayloadMode === m.value} onChange={() => setObs({ ...obs, tracePayloadMode: m.value })} />
            <span>
              <span className="font-semibold text-white">{m.label}</span>
              <br />
              <span className="text-xs text-ink-200">{m.hint}</span>
            </span>
          </label>
        ))}
        <Field label="保存期間（日）" hint="期間を過ぎたトレースは自動で削除されます（1〜3650日）。">
          <input className={`${inputClass} w-32`} value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" />
        </Field>
        {message && <Alert kind={message.kind} title={message.text} />}
        <Button variant="primary" busy={busy} onClick={save}>
          保存
        </Button>
      </div>
    </Card>
  );
}

export default function SecurityPage() {
  const basic = useBasicSettings() ?? undefined;
  const [data, setData] = useState<{ status: SecurityStatus; audit: AuditEntry[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ status: SecurityStatus; audit: AuditEntry[] }>('/security')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <Alert kind="error" title="読み込みに失敗しました">{error}</Alert>;
  if (!data) return <Loading />;
  const s = data.status;

  return (
    <div className="space-y-4">
      <PageHeader title="セキュリティ" description="アクセス制御とAPI認証情報の管理状況、監査ログを確認します。" />
      {!s.basicAuth.enabled && (
        <Alert kind="warning" title="Basic認証が無効です（開発モード）">
          環境変数 BASIC_AUTH_PASSWORD が未設定です。本番環境では未設定のまま起動できません。
        </Alert>
      )}
      {!s.encryption.configured && (
        <Alert kind="warning" title="APIキー暗号化キーが未設定です">
          API連携を使う前に、環境変数 API_KEY_ENCRYPTION_KEY（32バイト）を設定してください。設定するまでAPIキーは登録できません。
        </Alert>
      )}
      <Card title="アクセス制御">
        <div className="divide-y divide-ink-800">
          <Row label="パスワード認証（ログイン画面）" value={<Badge className={s.basicAuth.enabled ? ok : warn}>{s.basicAuth.enabled ? '稼働中' : '無効（開発モード）'}</Badge>}>
            画面・APIのすべてでログインを要求し、バックエンドの各エンドポイントでも再検証します。共有パスワード1つのため、個人ごとの権限やテナントの分離は未対応です。
          </Row>
          <Row label="HTTPSの強制" value={<Badge className={s.basicAuth.httpsEnforced ? ok : warn}>{s.basicAuth.httpsEnforced ? '有効' : '開発環境のため無効'}</Badge>}>
            本番環境ではHTTPS以外のアクセスをリダイレクト・拒否し、HSTSを付与します。
          </Row>
          <Row label="今後の拡張" value={<span className="text-xs text-ink-200">個別アカウント・権限管理・多要素認証</span>}>
            認証は差し替え可能な AuthProvider として実装されており、金融機関ごとのアカウント管理へ拡張できます。
          </Row>
        </div>
      </Card>
      <TraceSettingsCard />
      <Card title="API認証情報の管理状況">
        <div className="divide-y divide-ink-800">
          <Row label="保存時の暗号化" value={<Badge className={s.encryption.configured ? ok : ng}>{s.encryption.configured ? s.encryption.algorithm : '未設定'}</Badge>}>
            APIキーはサーバー側で認証付き暗号により暗号化して保存し、ブラウザ・ログ・エラーメッセージ・監査ログには出力しません。
          </Row>
          <Row label="外部通信" value={<Badge className={ok}>SSRF対策 有効</Badge>}>
            https のみ許可、プライベートアドレス・メタデータサービスへの接続を拒否、リダイレクト非追跡。
            {s.allowedPrivateHosts.length > 0 && ` 例外として許可: ${s.allowedPrivateHosts.join(', ')}`}
            {s.egressProxy && ' 外部通信は指定プロキシ経由で行います。'}
          </Row>
        </div>
        <div className="mt-2">
          <Table head={['プロバイダー', 'APIキー', '最終更新']} empty="プロバイダーが登録されていません">
            {s.providers.map((p) => (
              <tr key={p.id}>
                <td className={td}>{p.name}</td>
                <td className={td}>
                  <Badge className={p.hasApiKey ? ok : warn}>{p.hasApiKey ? '暗号化して保存済み' : '未登録'}</Badge>
                </td>
                <td className={td}>{formatDate(p.apiKeyUpdatedAt, basic)}</td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
      <Card title="監査ログ" description="設定変更・認証情報の操作・接続テスト・実験操作の記録（直近200件）">
        <Table head={['日時', '利用者', '操作', '対象', '結果', '詳細']} empty="記録はまだありません">
          {data.audit.map((a) => (
            <tr key={a.id}>
              <td className={td}>{formatDate(a.at, basic)}</td>
              <td className={td}>{a.actor}</td>
              <td className={`${td} font-mono text-xs`}>{a.action}</td>
              <td className={`${td} max-w-[12rem] truncate font-mono text-xs`} title={a.target ?? ''}>
                {a.target ?? '—'}
              </td>
              <td className={td}>
                <Badge className={a.result === 'success' ? ok : ng}>{a.result === 'success' ? '成功' : '失敗'}</Badge>
              </td>
              <td className={`${td} max-w-md truncate`} title={a.detail ?? ''}>
                {a.detail ?? '—'}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
