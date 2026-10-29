'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Stat, Table, td } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import type { ExpertFinding, PocMetrics, PocProject, TimeEntry } from '@/lib/research/poc-types';
import type { Study } from '@/lib/research/study-types';

type Data = { poc: PocProject; metrics: PocMetrics };

const ACTIVITY: Record<TimeEntry['activity'], string> = {
  risk_review: 'リスクの洗い出し・確認',
  patch_drafting: '修正案の作成',
  reverification: '再検証',
  reporting: '報告書の作成',
  other: 'その他',
};
const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(1)}%`);
const mins = (x: number | null) => (x === null ? '—' : `${x.toFixed(1)} 分`);
const tri = (v: boolean | null) => (v === null ? '未確認' : v ? 'はい' : 'いいえ');

export default function PocPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [studies, setStudies] = useState<Study[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [studyId, setStudyId] = useState('');
  const [time, setTime] = useState({ phase: 'baseline', activity: 'risk_review', minutes: '', kind: 'estimated', note: '' });
  const [finding, setFinding] = useState({ title: '', foundByRuleChecker: '', foundByExpert: '', foundByKisei: true, expertReview: 'unreviewed', severity: '', note: '' });
  const [info, setInfo] = useState<{ purpose: string; comparisonTargets: string; limitations: string; remainingIssues: string } | null>(null);

  const load = useCallback(
    () =>
      api<Data>(`/poc/${id}`)
        .then((d) => {
          setData(d);
          setInfo((cur) => cur ?? { purpose: d.poc.purpose, comparisonTargets: d.poc.comparisonTargets, limitations: d.poc.limitations, remainingIssues: d.poc.remainingIssues });
        })
        .catch((e) => setError(e.message)),
    [id],
  );
  useEffect(() => {
    load();
    api<{ studies: Study[] }>('/studies')
      .then((r) => setStudies(r.studies.filter((s) => s.frozen)))
      .catch(() => undefined);
  }, [load]);

  const op = async (body: Record<string, unknown>) => {
    setError(null);
    try {
      setData(await api<Data>(`/poc/${id}`, { method: 'PUT', body }));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };

  if (!data || !info) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;
  const { poc: p, metrics: m } = data;
  const triVal = (v: string) => (v === 'true' ? true : v === 'false' ? false : null);

  return (
    <>
      <PageHeader
        title={`PoC: ${p.name}`}
        description="研究データから自動で集計した値と、人が入力した値（実測・推定）を分けて表示します。"
        actions={
          <>
            <a href={`/api/research/poc/${id}/report?format=md`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
              Markdown
            </a>
            <a href={`/api/research/poc/${id}/report?format=json`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
              JSON
            </a>
            <a href={`/api/research/poc/${id}/report?format=csv`} className="rounded-md bg-white/5 px-3.5 py-1.5 text-sm text-ink-100 ring-1 ring-inset ring-white/15 hover:bg-white/10">
              CSV
            </a>
            <Link href={`/print/poc/${id}`} target="_blank" className="rc-primary inline-flex rounded-md px-3.5 py-1.5 text-sm font-medium">
              印刷用（PDF）
            </Link>
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      {m.dataNotice.map((n) => (
        <div key={n} className="mb-4">
          <Alert kind="warning" title={n} />
        </div>
      ))}
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="削減時間（人の作業）" value={mins(m.time.savedMinutes)} sub={m.time.baselineEstimated || m.time.humanEstimated ? '推定値を含む' : m.time.savedMinutes === null ? '時間の入力が必要' : '実測'} />
          <Stat label="専門家が確認した発見" value={m.detection.confirmedFindings} sub={`うちルールチェッカーで検出できないもの ${m.detection.novelFindings}`} />
          <Stat label="修正案" value={`${m.patches.generated} 件`} sub={`提案として承認 ${m.patches.recommended}・回帰PASS ${m.patches.regressionPassed}`} />
          <Stat label="追跡可能なセッション" value={pct(m.auditability.traceableRate)} sub={`トレースなし ${m.auditability.unrecordedSessions}`} />
        </div>

        <Card title="対象の研究">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="研究を追加">
              <select className={`${inputClass} w-80`} value={studyId} onChange={(e) => setStudyId(e.target.value)}>
                <option value="">選んでください</option>
                {studies
                  .filter((s) => !p.studyIds.includes(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.design.title}
                      {s.isMock ? '（モック）' : ''}
                    </option>
                  ))}
              </select>
            </Field>
            <Button disabled={!studyId} onClick={() => op({ op: 'link_study', studyId }).then(() => setStudyId(''))}>
              追加
            </Button>
          </div>
          <ul className="mt-3 space-y-1 text-sm">
            {p.studyIds.map((sid) => (
              <li key={sid} className="flex items-center gap-3">
                <Link href={`/research/studies/${sid}`} className="text-white underline-offset-2 hover:underline">
                  {studies.find((s) => s.id === sid)?.design.title ?? sid}
                </Link>
                <button type="button" className="text-xs text-ink-300 underline" onClick={() => op({ op: 'unlink_study', studyId: sid })}>
                  外す
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="検出（比較対象との比較）" description="専門家が確認した発見だけを数えます。未確認の疑いは別に表示します。">
            <Table head={['指標', '値']}>
              <tr>
                <td className={td}>専門家が確認した発見</td>
                <td className={td}>{m.detection.confirmedFindings}</td>
              </tr>
              <tr>
                <td className={td}>従来のルールチェッカーでは検出できない発見</td>
                <td className={td}>{m.detection.novelFindings}</td>
              </tr>
              <tr>
                <td className={td}>誤検出</td>
                <td className={td}>{m.detection.falsePositives}</td>
              </tr>
              <tr>
                <td className={td}>見逃し（専門家のみが発見）</td>
                <td className={td}>{m.detection.falseNegatives}</td>
              </tr>
              <tr>
                <td className={td}>未確認の疑い（発見としては数えない）</td>
                <td className={td}>{m.detection.unreviewed}</td>
              </tr>
              <tr>
                <td className={td}>検出の網羅率</td>
                <td className={td}>{pct(m.detection.detectionCoverage)}</td>
              </tr>
            </Table>
          </Card>
          <Card title="修正案・副作用・監査可能性">
            <Table head={['指標', '値']}>
              <tr>
                <td className={td}>修正案（作成 / 実験承認 / 提案承認）</td>
                <td className={td}>
                  {m.patches.generated} / {m.patches.expertValid} / {m.patches.recommended}
                </td>
              </tr>
              <tr>
                <td className={td}>再実験 / 回帰テスト PASS</td>
                <td className={td}>
                  {m.patches.reverified} / {m.patches.regressionPassed}
                </td>
              </tr>
              <tr>
                <td className={td}>レビュー時間（中央値）</td>
                <td className={td}>{mins(m.patches.medianReviewMinutes)}</td>
              </tr>
              <tr>
                <td className={td}>誤拒否率の増加（平均）</td>
                <td className={td}>{m.sideEffects.meanFalseRejectionIncrease === null ? '—' : `${(m.sideEffects.meanFalseRejectionIncrease * 100).toFixed(1)} pt`}</td>
              </tr>
              <tr>
                <td className={td}>新たな失敗</td>
                <td className={td}>{m.sideEffects.newFailures}</td>
              </tr>
              <tr>
                <td className={td}>証拠付きの Failure / 再現可能な実験</td>
                <td className={td}>
                  {pct(m.auditability.evidenceLinkedRate)} / {pct(m.auditability.reproducibleRate)}
                </td>
              </tr>
              <tr>
                <td className={td}>承認履歴の記録</td>
                <td className={td}>{pct(m.auditability.approvalRecordedRate)}</td>
              </tr>
            </Table>
          </Card>
        </div>

        <Card title="作業時間" description="従来の作業時間（ベースライン）と、kisei 利用時の人の作業時間を入力します。システムの処理時間は研究の実行時間から自動で集計し、人の作業時間とは別に表示します。">
          <div className="grid gap-3 md:grid-cols-6">
            <Field label="区分">
              <select className={inputClass} value={time.phase} onChange={(e) => setTime({ ...time, phase: e.target.value })}>
                <option value="baseline">従来（ベースライン）</option>
                <option value="human">kisei 利用時の人の作業</option>
              </select>
            </Field>
            <Field label="作業">
              <select className={inputClass} value={time.activity} onChange={(e) => setTime({ ...time, activity: e.target.value })}>
                {Object.entries(ACTIVITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="時間（分）">
              <input className={inputClass} value={time.minutes} onChange={(e) => setTime({ ...time, minutes: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="実測／推定">
              <select className={inputClass} value={time.kind} onChange={(e) => setTime({ ...time, kind: e.target.value })}>
                <option value="measured">実測</option>
                <option value="estimated">推定</option>
              </select>
            </Field>
            <Field label="メモ">
              <input className={inputClass} value={time.note} onChange={(e) => setTime({ ...time, note: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button onClick={() => op({ op: 'add_time', ...time, minutes: Number(time.minutes) }).then((ok) => ok && setTime({ ...time, minutes: '', note: '' }))}>追加</Button>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink-100">
            従来 {mins(m.time.baselineMinutes)}・人の作業 {mins(m.time.humanMinutes)}・システムの処理 {mins(m.time.systemMinutes)}
          </p>
          <div className="mt-3">
            <Table head={['区分', '作業', '時間', '実測／推定', 'メモ', '']} empty="まだ入力されていません">
              {p.timeEntries.map((t) => (
                <tr key={t.id}>
                  <td className={td}>{t.phase === 'baseline' ? '従来' : 'kisei 利用時'}</td>
                  <td className={td}>{ACTIVITY[t.activity]}</td>
                  <td className={td}>{t.minutes} 分</td>
                  <td className={td}>{t.kind === 'measured' ? '実測' : <Badge className="bg-amber-500/10 text-amber-200 ring-amber-400/30">推定</Badge>}</td>
                  <td className={`${td} text-xs`}>{t.note}</td>
                  <td className={td}>
                    <button type="button" className="text-xs underline" onClick={() => op({ op: 'remove_time', entryId: t.id })}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>

        <Card title="比較表（ルールチェッカー・専門家・kisei）" description="専門家が確認した発見・誤検出を記録します。kisei の Failure の確認状態は Failure Library で記録したものが自動で集計されます。">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <Field label="発見の内容">
                <input className={inputClass} value={finding.title} onChange={(e) => setFinding({ ...finding, title: e.target.value })} />
              </Field>
            </div>
            {(
              [
                ['foundByRuleChecker', 'ルールチェッカーで検出'],
                ['foundByExpert', '専門家が検出'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <select className={inputClass} value={finding[k]} onChange={(e) => setFinding({ ...finding, [k]: e.target.value })}>
                  <option value="">未確認</option>
                  <option value="true">はい</option>
                  <option value="false">いいえ</option>
                </select>
              </Field>
            ))}
            <Field label="専門家の確認">
              <select className={inputClass} value={finding.expertReview} onChange={(e) => setFinding({ ...finding, expertReview: e.target.value })}>
                <option value="unreviewed">未確認</option>
                <option value="confirmed">確認済み（問題あり）</option>
                <option value="false_positive">誤検出</option>
              </select>
            </Field>
            <Field label="重大度">
              <select className={inputClass} value={finding.severity} onChange={(e) => setFinding({ ...finding, severity: e.target.value })}>
                <option value="">未設定</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-ink-100">
              <input type="checkbox" checked={finding.foundByKisei} onChange={(e) => setFinding({ ...finding, foundByKisei: e.target.checked })} />
              kisei で検出
            </label>
            <div className="flex items-end">
              <Button
                onClick={() =>
                  op({
                    op: 'upsert_finding',
                    finding: { ...finding, foundByRuleChecker: triVal(finding.foundByRuleChecker), foundByExpert: triVal(finding.foundByExpert), severity: finding.severity || null },
                  }).then((ok) => ok && setFinding({ ...finding, title: '', note: '' }))
                }
              >
                追加
              </Button>
            </div>
          </div>
          <div className="mt-3">
            <Table head={['発見', 'ルールチェッカー', '専門家', 'kisei', '確認', '重大度', '']} empty="まだ記録されていません">
              {p.findings.map((f: ExpertFinding) => (
                <tr key={f.id}>
                  <td className={`${td} whitespace-normal`}>{f.title}</td>
                  <td className={td}>{tri(f.foundByRuleChecker)}</td>
                  <td className={td}>{tri(f.foundByExpert)}</td>
                  <td className={td}>{f.foundByKisei ? 'はい' : 'いいえ'}</td>
                  <td className={td}>{{ confirmed: '確認済み', false_positive: '誤検出', unreviewed: '未確認' }[f.expertReview]}</td>
                  <td className={td}>{f.severity ?? '—'}</td>
                  <td className={td}>
                    <button type="button" className="text-xs underline" onClick={() => op({ op: 'remove_finding', findingId: f.id })}>
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>

        <Card title="レポートの記載事項">
          <div className="grid gap-3 md:grid-cols-2">
            {(
              [
                ['purpose', '検証目的'],
                ['comparisonTargets', '比較対象'],
                ['limitations', '制約と不確実性'],
                ['remainingIssues', '導入判断に必要な残課題'],
              ] as const
            ).map(([k, l]) => (
              <Field key={k} label={l}>
                <textarea className={inputClass} rows={3} value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Button className="mt-3" onClick={() => op({ op: 'info', ...info })}>
            保存
          </Button>
        </Card>
      </div>
    </>
  );
}
