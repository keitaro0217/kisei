'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, inputClass, Loading, PageHeader } from '@/components/research/ui';
import { api, ApiError } from '@/lib/research/client';
import { objectiveLabels, personaLabels } from '@/lib/research/study-labels';
import type { AgentObjective, Persona, PromptSet, RulePair, RuleVersion, Study, StudyCondition } from '@/lib/research/study-types';

// 研究デザインの作成。条件（条文・提示方法・目標・ペルソナ）を並べ、同じ市場とシードで比較する。

type CondForm = StudyCondition;

const newCondition = (i: number, ruleIds: string[] = []): CondForm => ({
  id: String.fromCharCode(65 + i),
  label: `条件${String.fromCharCode(65 + i)}`,
  description: '',
  ruleVersionIds: ruleIds,
  presentRules: true,
  includePurpose: false,
  objective: 'profit_max',
  customObjective: '',
  persona: 'neutral',
});

function Designer() {
  const router = useRouter();
  const pairId = useSearchParams().get('pair');
  const [rules, setRules] = useState<RuleVersion[] | null>(null);
  const [prompts, setPrompts] = useState<PromptSet[]>([]);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [h0, setH0] = useState('');
  const [h1, setH1] = useState('');
  const [iv, setIv] = useState('条文の文言（条件）');
  const [dv, setDv] = useState('規則違反率（発注・取消の試行に占める、規則エンジンが規則違反と判定した割合）');
  const [cv, setCv] = useState('市場（価格系列・シード）、モデル、プロンプト、ステップ数');
  const [plan, setPlan] = useState('主要比較の規則違反率の差を、反復を単位とする対応のあるブートストラップ（95%区間）と符号反転の並べ替え検定で評価する。副次比較は Holm 法で補正する。');
  const [conditions, setConditions] = useState<CondForm[]>([newCondition(0), newCondition(1)]);
  const [primary, setPrimary] = useState<{ treatment: string; control: string }>({ treatment: 'B', control: 'A' });
  const [replicates, setReplicates] = useState('20');
  const [baseSeed, setBaseSeed] = useState('1');
  const [steps, setSteps] = useState('20');
  const [initialCash, setInitialCash] = useState('1000000');
  const [initialPrice, setInitialPrice] = useState('1000');
  const [volatility, setVolatility] = useState('0.02');
  const [agent, setAgent] = useState<'mock' | 'model'>('mock');
  const [promptSetId, setPromptSetId] = useState('');

  useEffect(() => {
    Promise.all([api<{ rules: RuleVersion[] }>('/rules'), api<{ pairs: RulePair[] }>('/rule-pairs'), api<{ prompts: PromptSet[] }>('/prompts')])
      .then(([r, p, ps]) => {
        setRules(r.rules);
        setPrompts(ps.prompts);
        const pair = pairId ? p.pairs.find((x) => x.id === pairId) : null;
        if (pair) {
          setTitle(pair.name);
          setQuestion(`条文の${pair.changedTerms || '文言'}の違いで、エージェントの行動と規則違反率は変わるか。`);
          setH0('条文Aと条文Bで規則違反率に差はない。');
          setH1(pair.hypothesis || '条文Aと条文Bで規則違反率に差がある。');
          setConditions([
            { ...newCondition(0, [pair.ruleA.id]), label: `条文A（${pair.ruleA.ruleKey} v${pair.ruleA.version}）` },
            { ...newCondition(1, [pair.ruleB.id]), label: `条文B（${pair.ruleB.ruleKey} v${pair.ruleB.version}）` },
          ]);
        }
      })
      .catch((e) => setError({ message: e.message }));
  }, [pairId]);

  if (!rules) return <Loading />;

  const updateCond = (i: number, patch: Partial<CondForm>) => setConditions(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const totalCalls = conditions.length * (Number(replicates) || 0) * (Number(steps) || 0);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ study: Study }>('/studies', {
        method: 'POST',
        body: {
          title,
          question,
          nullHypothesis: h0,
          alternativeHypothesis: h1,
          independentVariables: iv,
          dependentVariables: dv,
          controlVariables: cv,
          analysisPlan: plan,
          conditions,
          primaryComparison: conditions.length >= 2 ? primary : null,
          replicates: Number(replicates),
          baseSeed: Number(baseSeed),
          market: { mode: 'exogenous_simple', steps: Number(steps), initialCash: Number(initialCash), initialPrice: Number(initialPrice), volatility: Number(volatility) },
          agent: { kind: agent },
          promptSetId: promptSetId || null,
        },
      });
      router.push(`/research/studies/${res.study.id}`);
    } catch (e) {
      setError({ message: (e as Error).message, field: e instanceof ApiError ? e.field : undefined });
      setBusy(false);
    }
  };

  const latestRules = [...rules].sort((a, b) => a.ruleKey.localeCompare(b.ruleKey) || b.version - a.version);

  return (
    <>
      <PageHeader title="新しい研究" description="下書きとして保存します。開始するまで内容を変更でき、開始時に設定（規則の版・プロンプト・モデル設定）が凍結されます。" />
      {error && (
        <div className="mb-4">
          <Alert kind="error" title="保存できませんでした" onClose={() => setError(null)}>
            {error.message}
            {error.field && <span className="ml-1 font-mono text-xs">（{error.field}）</span>}
          </Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card title="研究課題と仮説" description="分析計画は実行前に記録され、凍結設定に含まれます（事前登録）。">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="研究名" required>
                <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="研究課題">
                <textarea className={inputClass} rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} />
              </Field>
            </div>
            <Field label="帰無仮説">
              <textarea className={inputClass} rows={2} value={h0} onChange={(e) => setH0(e.target.value)} />
            </Field>
            <Field label="対立仮説">
              <textarea className={inputClass} rows={2} value={h1} onChange={(e) => setH1(e.target.value)} />
            </Field>
            <Field label="独立変数">
              <input className={inputClass} value={iv} onChange={(e) => setIv(e.target.value)} />
            </Field>
            <Field label="従属変数">
              <input className={inputClass} value={dv} onChange={(e) => setDv(e.target.value)} />
            </Field>
            <div className="md:col-span-2">
              <Field label="統制変数">
                <input className={inputClass} value={cv} onChange={(e) => setCv(e.target.value)} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="分析計画">
                <textarea className={inputClass} rows={3} value={plan} onChange={(e) => setPlan(e.target.value)} />
              </Field>
            </div>
          </div>
        </Card>

        <Card
          title="条件"
          description="規則は各条件で実行可否の判定に使います。「条文を提示しない」にすると、エージェントには条文を見せずに同じ規則で判定します（対照群）。"
          actions={
            conditions.length < 8 && (
              <Button onClick={() => setConditions([...conditions, newCondition(conditions.length)])}>条件を追加</Button>
            )
          }
        >
          <div className="space-y-4">
            {conditions.map((c, i) => (
              <div key={i} className="rounded-lg border border-white/10 bg-ink-950/30 p-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="条件ID">
                    <input className={inputClass} value={c.id} onChange={(e) => updateCond(i, { id: e.target.value })} />
                  </Field>
                  <div className="md:col-span-3">
                    <Field label="名称">
                      <input className={inputClass} value={c.label} onChange={(e) => updateCond(i, { label: e.target.value })} />
                    </Field>
                  </div>
                  <div className="md:col-span-2">
                    <Field label="規則（判定に使う版）" hint="Ctrl / ⌘ を押しながら複数選択できます">
                      <select
                        multiple
                        className={`${inputClass} h-28`}
                        value={c.ruleVersionIds}
                        onChange={(e) => updateCond(i, { ruleVersionIds: Array.from(e.target.selectedOptions).map((o) => o.value) })}
                      >
                        {latestRules.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.ruleKey} v{r.version} — {r.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="space-y-3 md:col-span-2">
                    <Field label="エージェントの目標">
                      <select className={inputClass} value={c.objective} onChange={(e) => updateCond(i, { objective: e.target.value as AgentObjective })}>
                        {Object.entries(objectiveLabels).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {c.objective === 'custom' && (
                      <Field label="目標（自由記述）">
                        <input className={inputClass} value={c.customObjective} onChange={(e) => updateCond(i, { customObjective: e.target.value })} />
                      </Field>
                    )}
                    <Field label="ペルソナ">
                      <select className={inputClass} value={c.persona} onChange={(e) => updateCond(i, { persona: e.target.value as Persona })}>
                        {Object.entries(personaLabels).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-ink-100">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={c.presentRules} onChange={(e) => updateCond(i, { presentRules: e.target.checked })} />
                    条文を提示する
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={c.includePurpose} onChange={(e) => updateCond(i, { includePurpose: e.target.checked })} />
                    規制の趣旨を提示する
                  </label>
                  {conditions.length > 1 && (
                    <Button variant="ghost" className="ml-auto" onClick={() => setConditions(conditions.filter((_, j) => j !== i))}>
                      削除
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {conditions.length >= 2 && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="主要比較: 処置群">
                  <select className={inputClass} value={primary.treatment} onChange={(e) => setPrimary({ ...primary, treatment: e.target.value })}>
                    {conditions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}: {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="主要比較: 対照群">
                  <select className={inputClass} value={primary.control} onChange={(e) => setPrimary({ ...primary, control: e.target.value })}>
                    {conditions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}: {c.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>
        </Card>

        <Card title="市場と反復" description="市場モードは「外生価格＋単純約定」です。反復 r ではシード（基準シード + r）を全条件で共通に使い、同じ価格系列で比較します。">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="反復数（条件ごと）" hint="1〜500">
              <input className={inputClass} value={replicates} onChange={(e) => setReplicates(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="基準シード">
              <input className={inputClass} value={baseSeed} onChange={(e) => setBaseSeed(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="ステップ数" hint="1〜100">
              <input className={inputClass} value={steps} onChange={(e) => setSteps(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="初期現金">
              <input className={inputClass} value={initialCash} onChange={(e) => setInitialCash(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label="初期価格">
              <input className={inputClass} value={initialPrice} onChange={(e) => setInitialPrice(e.target.value)} inputMode="decimal" />
            </Field>
            <Field label="ボラティリティ" hint="0〜0.5">
              <input className={inputClass} value={volatility} onChange={(e) => setVolatility(e.target.value)} inputMode="decimal" />
            </Field>
          </div>
        </Card>

        <Card title="エージェント">
          <div className="space-y-3 text-sm text-ink-100">
            <label className="flex items-start gap-2">
              <input type="radio" className="mt-1" checked={agent === 'mock'} onChange={() => setAgent('mock')} />
              <span>
                <span className="font-semibold text-white">モック（APIキー不要）</span>
                <br />
                <span className="text-xs text-ink-200">シードから決定論的に行動を生成します。条文を読まないため、結果は「モックデータ」と表示され、AIの研究結果としては扱われません。研究フローの確認用です。</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" className="mt-1" checked={agent === 'model'} onChange={() => setAgent('model')} />
              <span>
                <span className="font-semibold text-white">AIモデル</span>
                <br />
                <span className="text-xs text-ink-200">設定 → モデル割り当ての「取引エージェント」を使います。開始時にモデル設定を凍結します。呼び出し回数の目安: {totalCalls.toLocaleString()} 回（費用が発生します）。</span>
              </span>
            </label>
            <Field label="プロンプト" hint="未選択の場合は標準プロンプトの最初の版を使います。">
              <select className={inputClass} value={promptSetId} onChange={(e) => setPromptSetId(e.target.value)}>
                <option value="">標準</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} v{p.version}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>

        <div className="flex gap-2">
          <Button variant="primary" busy={busy} onClick={create}>
            下書きとして保存
          </Button>
          <Button onClick={() => router.push('/research/studies')}>キャンセル</Button>
        </div>
      </div>
    </>
  );
}

export default function NewStudyPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Designer />
    </Suspense>
  );
}
