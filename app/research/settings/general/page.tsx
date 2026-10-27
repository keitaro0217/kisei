'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass, Loading, NoticeBar, PageHeader, type Notice } from '@/components/research/ui';
import { api, formatDate } from '@/lib/research/client';
import type { AppSettings, BasicSettings } from '@/lib/research/types';

const TIME_ZONES = ['Asia/Tokyo', 'UTC', 'Asia/Singapore', 'Asia/Hong_Kong', 'Europe/London', 'America/New_York'];
const DATE_FORMATS: BasicSettings['dateFormat'][] = ['yyyy/MM/dd HH:mm', 'yyyy-MM-dd HH:mm', 'MM/dd HH:mm'];

export default function GeneralSettingsPage() {
  const router = useRouter();
  const [form, setForm] = useState<BasicSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ settings: AppSettings }>('/settings')
      .then((r) => setForm(r.settings.basic))
      .catch((e) => setNotice({ kind: 'error', title: '読み込みに失敗しました', message: e.message }));
  }, []);

  const save = async () => {
    if (!form) return;
    if (!form.appDisplayName.trim() || form.appDisplayName.trim().length > 60) {
      setError('アプリ表示名は1〜60文字で入力してください');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ settings: AppSettings }>('/settings', { method: 'PUT', body: { basic: form } });
      setForm(res.settings.basic);
      setNotice({ kind: 'success', title: '基本設定を保存しました' });
      router.refresh();
    } catch (e) {
      setNotice({ kind: 'error', title: '保存できませんでした', message: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="基本設定" description="画面表示に関する設定です。" />
      <NoticeBar notice={notice} onClose={() => setNotice(null)} />
      {!form ? (
        <Loading />
      ) : (
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="アプリ表示名" required error={error}>
              <input className={inputClass} value={form.appDisplayName} maxLength={60} onChange={(e) => setForm({ ...form, appDisplayName: e.target.value })} />
            </Field>
            <Field label="表示言語" hint="現在は日本語のみ対応しています">
              <select className={inputClass} value={form.language} onChange={() => undefined}>
                <option value="ja">日本語</option>
                <option value="en" disabled>
                  English（準備中）
                </option>
              </select>
            </Field>
            <Field label="タイムゾーン">
              <select className={inputClass} value={form.timeZone} onChange={(e) => setForm({ ...form, timeZone: e.target.value })}>
                {TIME_ZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="日付・時刻の表示形式" hint={`表示例: ${formatDate(new Date().toISOString(), form)}`}>
              <select className={inputClass} value={form.dateFormat} onChange={(e) => setForm({ ...form, dateFormat: e.target.value as BasicSettings['dateFormat'] })}>
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={save} busy={busy}>
              保存
            </Button>
          </div>
        </Card>
      )}
      <div className="mt-4">
        <Alert kind="info">設定はサーバーに保存され、すべての利用者に適用されます。</Alert>
      </div>
    </div>
  );
}
