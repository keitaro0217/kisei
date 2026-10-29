'use client';

import Link from 'next/link';
import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/research/client';
import { categoryLabels } from '@/lib/research/study-labels';
import type { DecisionRecord } from '@/lib/research/study-types';
import { Badge, Button, Card, inputClass, Table, td } from './ui';

// 意思決定ログ。1つの判断を「A. 実験条件 / B. 表明された説明 / C. 提案された行動 / D. 規則エンジンの判定 / E. 監視AIの評価」に分けて表示する。

const PAGE = 50;

const actionText = (d: DecisionRecord) => {
  const a = d.attempted;
  if (a.parse === 'invalid') return '解釈不能';
  if (a.action === 'hold') return '見送り';
  if (a.action === 'cancel') return `取消 ${a.cancelOrderId ?? ''}`;
  return `${a.action === 'buy' ? '買い' : '売り'} ${a.quantity ?? '?'}株 ${a.orderType === 'limit' ? `指値 ${a.limitPrice}` : '成行'}`;
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-ink-950/40 p-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-300">{label}</p>
      <div className="space-y-1 text-xs leading-relaxed text-ink-100">{children}</div>
    </div>
  );
}

function Detail({ d }: { d: DecisionRecord }) {
  const e = d.enforcement;
  return (
    <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
      <Section label="A. 実験条件（この時点の市場）">
        <p>
          価格 {d.context.price}・直前約定 {d.context.lastTradePrice}
        </p>
        <p>
          現金 {d.context.cash.toLocaleString()}・保有 {d.context.position}
        </p>
        <p>未約定: {d.context.openOrders.length ? d.context.openOrders.map((o) => `${o.id}(${o.side} ${o.quantity}@${o.limitPrice})`).join(', ') : 'なし'}</p>
      </Section>
      <Section label="B. 表明された説明（AIの主張）">
        <p>{d.reasoning.rationale || '（説明なし）'}</p>
        <p>引用した規則: {d.reasoning.citedRules.join(', ') || 'なし'}</p>
        <p>自己評価: {d.reasoning.selfAssessedCompliance}</p>
        <p className="text-ink-300">※ この主張は判定に使われていません。</p>
      </Section>
      <Section label="C. 提案された行動">
        <p>{actionText(d)}</p>
        {d.attempted.parseError && <p className="text-violet-200">解釈エラー: {d.attempted.parseError}</p>}
        <details>
          <summary className="cursor-pointer text-ink-300">モデルの生出力</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{d.attempted.raw}</pre>
        </details>
      </Section>
      <Section label="D. 規則エンジンの判定">
        <p className="font-semibold">{e.verdict}</p>
        {e.violations.map((v, i) => (
          <p key={i} className="text-rose-200">
            {v.code}（{v.ruleKey ?? '取引所の基本チェック'}）: {v.message}
          </p>
        ))}
        {e.intentDeviations.map((v, i) => (
          <p key={i} className="text-amber-200">
            趣旨逸脱 {v.code}: {v.message}
          </p>
        ))}
        <p>
          約定 {e.filledQuantity}株{e.fillPrice !== null ? ` @ ${e.fillPrice}` : ''}・判定後 現金 {e.after.cash.toLocaleString()} / 保有 {e.after.position}
        </p>
        {e.evaluations.length > 0 && <p className="text-ink-300">評価した判定: {e.evaluations.map((x) => `${x.code}=${x.violated ? '違反' : '適合'}`).join(', ')}</p>}
      </Section>
      <Section label="E. 監視AIの評価">
        <p>{d.monitor ? `${d.monitor.judgement}: ${d.monitor.rationale}` : '未実施（このバージョンでは監視AIは未実装です）'}</p>
      </Section>
      <Section label="関連">
        <Link href={`/research/traces?study=${d.studyId}&condition=${encodeURIComponent(d.conditionId)}&replicate=${d.replicate}`} className="underline underline-offset-2">
          このセッションの実行トレース
        </Link>
      </Section>
      <Section label="研究上の分類">
        <Badge className={categoryLabels[d.category].className}>{categoryLabels[d.category].label}</Badge>
        {d.reasoningActionDiscrepancy && <p className="text-amber-200">説明では「適法」としたが、規則エンジンに拒否されました。</p>}
        {d.isMock && <p className="text-violet-200">モックデータ（AIの判断ではありません）</p>}
        {d.usage && (
          <p className="text-ink-300">
            トークン 入力 {d.usage.inputTokens} / 出力 {d.usage.outputTokens}
          </p>
        )}
      </Section>
    </div>
  );
}

export default function DecisionLog({ studyId, conditions }: { studyId: string; conditions: { id: string; label: string }[] }) {
  const [condition, setCondition] = useState('');
  const [replicate, setReplicate] = useState('');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<DecisionRecord[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // トレースなどから「?condition=&replicate=&step=」で開いた場合は、その判断を表示する
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get('condition');
    const r = q.get('replicate');
    const st = q.get('step');
    if (c && r && /^\d+$/.test(r)) {
      setCondition(c);
      setReplicate(r);
      if (st && /^\d+$/.test(st)) {
        setOffset(Math.floor(Number(st) / PAGE) * PAGE);
        setOpen(`${c}/${r}/${st}`);
      }
      document.getElementById('decision-log')?.scrollIntoView();
    }
  }, []);

  useEffect(() => {
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (condition) q.set('condition', condition);
    if (replicate) q.set('replicate', replicate);
    api<{ decisions: DecisionRecord[] }>(`/studies/${studyId}/decisions?${q}`)
      .then((r) => setRows(r.decisions))
      .catch((e) => setError(e.message));
  }, [studyId, condition, replicate, offset]);

  const key = (d: DecisionRecord) => `${d.conditionId}/${d.replicate}/${d.step}`;

  return (
    <Card
      id="decision-log"
      title="意思決定ログ"
      description="行をクリックすると、説明・行動・判定・監視を分けて表示します。"
      actions={
        <span className="flex gap-2">
          <select
            className={`${inputClass} w-56`}
            value={condition}
            onChange={(e) => {
              setCondition(e.target.value);
              setOffset(0);
            }}
            aria-label="条件で絞り込み"
          >
            <option value="">すべての条件</option>
            {conditions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            className={`${inputClass} w-24`}
            value={replicate}
            onChange={(e) => {
              setReplicate(e.target.value.replace(/\D/g, ''));
              setOffset(0);
            }}
            placeholder="反復"
            aria-label="反復で絞り込み"
            inputMode="numeric"
          />
        </span>
      }
    >
      {error && <p className="mb-2 text-sm text-rose-300">{error}</p>}
      <Table head={['条件', '反復', 'ステップ', '提案された行動', 'AIの自己評価', '判定', '違反コード', '分類']} empty="記録はまだありません">
        {rows.map((d) => (
          <Fragment key={key(d)}>
            <tr className="cursor-pointer" onClick={() => setOpen(open === key(d) ? null : key(d))}>
              <td className={td}>{conditions.find((c) => c.id === d.conditionId)?.label ?? d.conditionId}</td>
              <td className={td}>{d.replicate}</td>
              <td className={td}>{d.step + 1}</td>
              <td className={td}>{actionText(d)}</td>
              <td className={td}>{d.reasoning.selfAssessedCompliance}</td>
              <td className={td}>{d.enforcement.verdict}</td>
              <td className={`${td} font-mono text-xs`}>{d.enforcement.violations.map((v) => v.code).join(', ') || '—'}</td>
              <td className={td}>
                <Badge className={categoryLabels[d.category].className}>{categoryLabels[d.category].label}</Badge>
              </td>
            </tr>
            {open === key(d) && (
              <tr>
                <td colSpan={8} className="bg-ink-950/30">
                  <Detail d={d} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>
      <div className="mt-3 flex items-center gap-2">
        <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          前へ
        </Button>
        <Button disabled={rows.length < PAGE} onClick={() => setOffset(offset + PAGE)}>
          次へ
        </Button>
        <span className="text-xs text-ink-300">
          {offset + 1}〜{offset + rows.length} 件目
        </span>
      </div>
    </Card>
  );
}
