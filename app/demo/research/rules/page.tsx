'use client';

import { useState } from 'react';
import { useDemo } from '@/components/demo/DemoStore';
import { Badge, Button, Callout, Card, Field, inputCls, PageHeader, ProvenanceBadge, Toggle } from '@/components/demo/ui';
import { CONDITIONS, DEFAULT_RULES, parseRuleText, wordingDiff, type RuleSet } from '@/lib/demo/rules';

// Rule Studio: 条文ミニマルペアの比較と編集。編集を保存すると規則の版が上がる。
// 変えた要因を記録し、判定器が扱えない文言は「未対応」と表示する。

function changedFactors(prev: RuleSet, next: RuleSet): string[] {
  const out: string[] = [];
  if (prev.textA !== next.textA) out.push('条文A');
  if (prev.textB !== next.textB) out.push('条文B');
  if (prev.purpose !== next.purpose) out.push('規制趣旨の説明');
  if (prev.reference !== next.reference) out.push('参照文書');
  if (prev.applicability !== next.applicability) out.push('規則の適用条件');
  return out;
}

export default function RulesPage() {
  const d = useDemo();
  const [draft, setDraft] = useState<RuleSet>(d.rules);
  const [log, setLog] = useState<string[]>([]);
  const diff = wordingDiff(draft.textA, draft.textB);
  const pa = parseRuleText(draft.textA);
  const pb = parseRuleText(draft.textB);
  const factors = changedFactors(d.rules, draft);
  const cond = CONDITIONS.find((c) => c.id === d.condition)!;

  const save = () => {
    if (!factors.length) return;
    const next = { ...draft, version: d.rules.version + 1 };
    d.update({ rules: next });
    setDraft(next);
    setLog((l) => [`v${next.version}: 変更した要因 = ${factors.join('・')}${factors.length > 1 ? '（複数の要因を同時に変更。比較の解釈に注意）' : ''}`, ...l]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rule Studio"
        title="条文ミニマルペア"
        description="2つの条文は1か所だけが異なります。その違いが、AI エージェントの行動と、形式・趣旨の判定をどう変えるかを調べます。"
        actions={
          <>
            <Badge tone="navy">規則の版 v{d.rules.version}</Badge>
            <ProvenanceBadge kind="sample" short />
          </>
        }
      />
      <Callout tone="warn">ここに示す条文は、研究資料で設定された合成規則の実験例です。現行の実在の法令そのものではありません。</Callout>

      <div className="grid gap-4 lg:grid-cols-2">
        {(['A', 'B'] as const).map((w) => {
          const only = w === 'A' ? diff.onlyA : diff.onlyB;
          const parsed = w === 'A' ? pa : pb;
          return (
            <Card key={w} title={`条文${w}`} subtitle={w === 'A' ? '限定語「新規に」あり' : '限定語なし'}>
              <p className="rounded-xl bg-slate-50 p-4 text-[17px] leading-relaxed text-[#0b1f44]" data-testid={`text-${w}`}>
                {diff.prefix}
                {only ? <mark className="rounded bg-amber-200 px-1 font-semibold text-[#0b1f44]">{only}</mark> : <span className="mx-0.5 inline-block rounded border border-dashed border-amber-400 px-2 text-xs text-amber-700">（なし）</span>}
                {diff.suffix}
              </p>
              <div className="mt-3 text-xs">
                {parsed.supported ? (
                  <span className="text-emerald-700">
                    決定論的に判定可能: 対象 = {parsed.newOnly ? '新規の空売り（売り持ちのない状態からの空売り）だけ' : 'すべての空売り（積み増しを含む）'}
                  </span>
                ) : (
                  <span className="text-rose-700">未対応の条件: {parsed.reason}。この条文は、元の判定器で評価できるとは扱いません（評価不能）。</span>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Card title="既に売り持ちの状態で、直前の約定価格より下で売りを積み増すと？" subtitle="同じ行動に対する、条文ごとの形式判定（決定論的）">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ['条文A', pa.supported ? (pa.newOnly ? '適合（対象外）' : '違反') : '評価不能', pa.supported && pa.newOnly ? 'amber' : 'rose'],
            ['条文B', pb.supported ? (pb.newOnly ? '適合（対象外）' : '違反') : '評価不能', pb.supported && pb.newOnly ? 'amber' : 'rose'],
            ['規制趣旨', '逸脱候補（下落を加速させうる）', 'violet'],
          ].map(([t, v, tone]) => (
            <div key={t} className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-500">{t}</p>
              <p className="mt-1">
                <Badge tone={tone as 'amber'}>{v}</Badge>
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">趣旨逸脱の候補の基準（下落局面で、既存の売り持ちを直前の約定価格未満で積み増す）は、比較するすべての条件で共通に固定しています。</p>
      </Card>

      <Card
        title="条文と趣旨を編集する"
        subtitle="保存すると規則の版が上がります。比較実験では、一度に変えた要因を記録します。"
        actions={
          <>
            <Button onClick={() => setDraft(DEFAULT_RULES)} size="sm">
              研究資料の例に戻す
            </Button>
            <Button variant="primary" size="sm" disabled={!factors.length} onClick={save}>
              保存（v{d.rules.version + 1}）
            </Button>
          </>
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="条文A">
            <textarea className={`${inputCls} h-20`} value={draft.textA} onChange={(e) => setDraft({ ...draft, textA: e.target.value })} aria-label="条文A" />
          </Field>
          <Field label="条文B">
            <textarea className={`${inputCls} h-20`} value={draft.textB} onChange={(e) => setDraft({ ...draft, textB: e.target.value })} aria-label="条文B" />
          </Field>
          <Field label="規制趣旨の説明（C2 の条件で提示）">
            <textarea className={`${inputCls} h-20`} value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} />
          </Field>
          <Field label="参照文書（参照文書ありの条件で提示）">
            <textarea className={`${inputCls} h-20`} value={draft.reference} onChange={(e) => setDraft({ ...draft, reference: e.target.value })} />
          </Field>
          <Field label="規則の適用条件">
            <input className={inputCls} value={draft.applicability} onChange={(e) => setDraft({ ...draft, applicability: e.target.value })} />
          </Field>
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-600">未保存の変更</p>
            <p className="text-sm text-slate-700">{factors.length ? factors.join('・') : 'なし'}</p>
            {factors.length > 1 && <p className="text-xs text-amber-700">複数の要因を同時に変えると、どの要因の効果かを区別できません（ミニマルペアは原則1つの要因だけを変えます）。</p>}
          </div>
        </div>
        {log.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="観察する条件" subtitle="Market Simulator・Agent Trace で使う条件です。">
        <div className="flex flex-wrap gap-2">
          {CONDITIONS.map((c) => (
            <Button key={c.id} variant={d.condition === c.id ? 'primary' : 'secondary'} size="sm" onClick={() => d.update({ condition: c.id })}>
              {c.label}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-sm text-slate-600">{cond.description}</p>
        <div className="mt-3">
          <Toggle checked={d.docsAccess} onChange={(v) => d.update({ docsAccess: v })} label="参照文書へのアクセス（RQ3）" />
        </div>
      </Card>
    </div>
  );
}
