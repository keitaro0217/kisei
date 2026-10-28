'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { useBasicSettings } from '@/components/research/ResearchShell';
import { api, formatDate } from '@/lib/research/client';
import { classificationLabels, reviewLabels } from '@/lib/research/study-labels';
import type { RulePair, RuleVersion } from '@/lib/research/study-types';

type Template = { id: string; label: string; changedTerms: string; hypothesis: string };

export default function RulesPage() {
  const router = useRouter();
  const basic = useBasicSettings() ?? undefined;
  const [rules, setRules] = useState<RuleVersion[] | null>(null);
  const [pairs, setPairs] = useState<RulePair[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    Promise.all([api<{ rules: RuleVersion[]; templates: Template[] }>('/rules'), api<{ pairs: RulePair[] }>('/rule-pairs')])
      .then(([r, p]) => {
        setRules(r.rules);
        setTemplates(r.templates);
        setPairs(p.pairs);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  // 規則IDごとに最新の版と版数をまとめる
  const grouped = useMemo(() => {
    const m = new Map<string, RuleVersion[]>();
    for (const r of rules ?? []) m.set(r.ruleKey, [...(m.get(r.ruleKey) ?? []), r]);
    return [...m.values()].map((vs) => vs.sort((a, b) => b.version - a.version));
  }, [rules]);

  const fromTemplate = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await api<{ pair: RulePair }>('/rules/templates', { method: 'POST', body: { templateId: id } });
      router.push(`/research/rules/pairs/${res.pair.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="規則・条文"
        description="研究で使う規則を版ごとに管理します。保存するたびに新しい版として記録され、過去の版は変更されません（実行済みの研究の再現性を保つため）。判定ロジックは JSON の規則 DSL で記述し、サーバー上で任意のコードとして実行されることはありません。"
        actions={
          <Link href="/research/rules/edit" className="rc-primary inline-flex rounded-md px-3.5 py-1.5 text-sm font-medium">
            新しい規則
          </Link>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="エラー" onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="条文ミニマルペアの雛形" description="一語だけ異なる条文A/Bと、それぞれの判定ロジックを作成します。作成後に文言や閾値を編集できます（例示条文であり、実在の法令ではありません）。">
          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <div key={t.id} className="rounded-lg border border-white/10 bg-ink-950/30 p-4">
                <p className="text-sm font-semibold text-white">{t.label}</p>
                <p className="mt-1 text-xs text-ink-200">変更: {t.changedTerms}</p>
                <p className="mt-1 text-xs text-ink-300">仮説の例: {t.hypothesis}</p>
                <Button variant="primary" className="mt-3" busy={busy === t.id} disabled={busy !== null} onClick={() => fromTemplate(t.id)}>
                  この雛形で条文A/Bを作成
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <Card title="条文ミニマルペア" description="意味の等価性・差分の分類は自動では確定せず、研究者が確認します。">
          <Table head={['名称', '条文A', '条文B', '差分の分類', '確認', '作成日時']} empty="ミニマルペアはまだありません">
            {pairs.map((p) => (
              <tr key={p.id}>
                <td className={td}>
                  <Link href={`/research/rules/pairs/${p.id}`} className="font-medium text-white underline-offset-2 hover:underline">
                    {p.name}
                  </Link>
                </td>
                <td className={td}>
                  {p.ruleA.ruleKey} v{p.ruleA.version}
                </td>
                <td className={td}>
                  {p.ruleB.ruleKey} v{p.ruleB.version}
                </td>
                <td className={td}>{classificationLabels[p.classification]}</td>
                <td className={td}>
                  <Badge className={reviewLabels[p.equivalenceReview].className}>{reviewLabels[p.equivalenceReview].label}</Badge>
                </td>
                <td className={td}>{formatDate(p.createdAt, basic)}</td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="規則の一覧" description="各規則の最新版を表示します。「新しい版を作成」で内容を変更した版を追加できます。">
          {rules === null ? (
            <Loading />
          ) : (
            <Table head={['規則ID', '名称', '最新版', '版の数', '判定', '趣旨逸脱の基準', '判定ロジックのハッシュ', '更新日時', '']} empty="規則はまだありません">
              {grouped.map((vs) => {
                const r = vs[0];
                return (
                  <tr key={r.ruleKey}>
                    <td className={`${td} font-mono text-xs`}>{r.ruleKey}</td>
                    <td className={td}>{r.name}</td>
                    <td className={td}>v{r.version}</td>
                    <td className={td}>{vs.length}</td>
                    <td className={td}>{r.checks.length}</td>
                    <td className={td}>{r.intentCriteria.length}</td>
                    <td className={`${td} font-mono text-xs`}>{r.logicHash}</td>
                    <td className={td}>{formatDate(r.createdAt, basic)}</td>
                    <td className={td}>
                      <Link href={`/research/rules/edit?from=${r.id}`} className="text-xs text-ink-100 underline underline-offset-2 hover:text-white">
                        新しい版を作成
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
