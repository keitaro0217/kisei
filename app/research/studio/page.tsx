'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, inputClass, Loading, PageHeader, Table, td } from '@/components/research/ui';
import { api } from '@/lib/research/client';
import type { DomainDescriptor } from '@/lib/domain/descriptors';
import type { BusinessProcess, PolicyIntent, RuleDocument, RuleElement } from '@/lib/domain/model';
import type { RuleVersion } from '@/lib/research/study-types';

// Rule & Intent Studio: 規則の原文（出典・適用期間・種別）→ 要素の抽出とレビュー → 規則の目的の承認 → 規則の作成 → 業務プロセス → 実験。

type Catalog = {
  domains: DomainDescriptor[];
  templates: { id: string; domain: string; label: string; changedTerms: string; hypothesis: string }[];
  documents: (Omit<RuleDocument, 'text'> & { length: number })[];
  processes: BusinessProcess[];
  intents: (PolicyIntent & { createdBy: string })[];
};
type DocDetail = { document: RuleDocument; elements: RuleElement[]; intents: PolicyIntent[] };

const KIND_LABEL: Record<string, string> = { synthetic: '合成の規則', real_law: '実在の法令', internal_policy: '社内規程' };
const ELEMENT_LABEL: Record<string, string> = {
  obligation: '義務',
  prohibition: '禁止',
  permission: '許可',
  exception: '例外',
  threshold: '閾値',
  approval_condition: '承認条件',
  definition: '定義',
  purpose_candidate: '目的の候補',
};
const REVIEW_LABEL: Record<string, string> = { unreviewed: '未レビュー', approved: '承認', rejected: '却下', edited: '修正' };

export default function StudioPage() {
  const [cat, setCat] = useState<Catalog | null>(null);
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [rules, setRules] = useState<RuleVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ docKey: '', title: '', kind: 'synthetic', source: '', effectiveFrom: '', effectiveTo: '', text: '' });
  const [file, setFile] = useState<File | null>(null);
  const [intentKey, setIntentKey] = useState('');
  const [humanIntent, setHumanIntent] = useState({ ruleKey: '', text: '' });
  const [templateId, setTemplateId] = useState('approval_per_order_vs_request');
  const [proc, setProc] = useState({ processKey: '', domain: 'trading_company', name: '', objective: '', permittedActions: ['order', 'pay', 'wait'] as string[] });
  const [exp, setExp] = useState({ processId: '', ruleA: '', ruleB: '', extraRule: '', persona: 'gaming', replicates: 5, steps: 20 });

  const load = useCallback(
    () =>
      Promise.all([api<Catalog>('/studio'), api<{ rules: RuleVersion[] }>('/rules')])
        .then(([c, r]) => {
          setCat(c);
          setRules(r.rules);
        })
        .catch((e) => setError(e.message)),
    [],
  );
  const openDoc = useCallback(async (id: string) => setDoc(await api<DocDetail>(`/studio/documents/${id}`)), []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setError(null);
    setMsg(null);
    try {
      const m = await fn();
      if (m) setMsg(m);
      await load();
      if (doc) await openDoc(doc.document.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!cat) return error ? <Alert kind="error" title="読み込みに失敗しました">{error}</Alert> : <Loading />;
  const domainRules = rules.filter((r) => (r.domain ?? 'financial_market') === proc.domain || (r.domain ?? 'financial_market') === (cat.processes.find((p) => p.id === exp.processId)?.domain ?? 'trading_company'));
  const tradingRules = rules.filter((r) => r.domain === 'trading_company');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rule & Intent Studio"
        description="規則の原文を出典・適用期間つきで登録し、義務・禁止・例外・閾値・承認条件を根拠の位置つきで抽出します。規則の目的は AI が確定せず、原文の根拠つきの候補を人が承認するか、人が入力します。形式的な適合と目的への適合は別の評価軸です。"
      />
      {error && (
        <Alert kind="error" title="エラー" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {msg && <Alert kind="success" title={msg} onClose={() => setMsg(null)} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="1. 規則の原文を登録" description="同じ文書 ID で登録すると新しい版になります（以前の版は変更されません）。DOCX は本文の文字列だけを読み取ります（原本は変更しません）。">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="文書 ID" required>
              <input className={inputClass} value={form.docKey} onChange={(e) => setForm({ ...form, docKey: e.target.value })} placeholder="PURCHASE-POLICY" />
            </Field>
            <Field label="種別" required>
              <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="synthetic">合成の規則（研究用）</option>
                <option value="internal_policy">社内規程</option>
                <option value="real_law">実在の法令</option>
              </select>
            </Field>
            <Field label="題名" required>
              <input className={inputClass} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="出典" required>
              <input className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="規程名・発行者・URL など" />
            </Field>
            <Field label="適用開始日">
              <input type="date" className={inputClass} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
            </Field>
            <Field label="適用終了日">
              <input type="date" className={inputClass} value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3 space-y-2">
            <Field label="本文（テキスト）">
              <textarea className={`${inputClass} h-32 text-xs`} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
            </Field>
            <Field label="または DOCX ファイル">
              <input type="file" accept=".docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-xs text-ink-200" />
            </Field>
            <Button
              variant="primary"
              busy={busy === 'doc'}
              onClick={() =>
                run('doc', async () => {
                  const body: Record<string, unknown> = { ...form };
                  if (file) {
                    const buf = new Uint8Array(await file.arrayBuffer());
                    let bin = '';
                    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
                    body.format = 'docx';
                    body.contentBase64 = btoa(bin);
                  }
                  const r = await api<{ document: RuleDocument }>('/studio/documents', { method: 'POST', body });
                  await openDoc(r.document.id);
                  return `「${r.document.title}」v${r.document.version} を登録し、要素を抽出しました。`;
                })
              }
            >
              登録して要素を抽出
            </Button>
          </div>
        </Card>

        <Card title="規則文書">
          <Table head={['文書', '版', '種別', '適用期間', '']} empty="まだ登録されていません。">
            {cat.documents.map((d) => (
              <tr key={d.id}>
                <td className={`${td} text-xs`}>
                  {d.title}
                  <div className="text-ink-400">{d.docKey}</div>
                </td>
                <td className={td}>v{d.version}</td>
                <td className={`${td} text-xs`}>{KIND_LABEL[d.kind]}</td>
                <td className={`${td} text-xs`}>
                  {d.effectiveFrom ?? '—'} 〜 {d.effectiveTo ?? ''}
                </td>
                <td className={td}>
                  <Button onClick={() => run('open', () => openDoc(d.id))}>開く</Button>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      {doc && (
        <Card
          title={`2. 要素のレビュー: ${doc.document.title} v${doc.document.version}`}
          description={`出典: ${doc.document.source}・SHA-256 ${doc.document.sha256.slice(0, 16)}…・抽出方法 pattern-v1（文型の規則による抽出。AI の解釈ではありません）`}
        >
          {doc.document.kind === 'real_law' && <Alert kind="warning" title="実在の法令です。kisei は法的な判断を行いません。抽出結果は研究用の要素であり、法令の解釈ではありません。" />}
          {doc.document.kind === 'synthetic' && <p className="mb-3 text-xs text-ink-300">合成の規則（研究用）です。実在の法令・社内規程ではありません。</p>}
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label="目的の候補にする規則 ID">
              <input className={`${inputClass} w-56`} value={intentKey} onChange={(e) => setIntentKey(e.target.value)} placeholder="APPROVAL-PER-ORDER" />
            </Field>
          </div>
          <Table head={['種類', '原文（根拠の位置）', '値', 'レビュー', '']}>
            {doc.elements.map((e) => (
              <tr key={e.id}>
                <td className={td}>
                  <Badge className="bg-white/10 text-ink-100 ring-white/15">{ELEMENT_LABEL[e.kind]}</Badge>
                </td>
                <td className={`${td} max-w-xl whitespace-normal text-xs`}>
                  {e.text}
                  <span className="ml-1 text-ink-400">
                    [{e.span.start}–{e.span.end}]
                  </span>
                </td>
                <td className={`${td} text-xs`}>{e.value ? `${e.value.number.toLocaleString()} ${e.value.unit}` : ''}</td>
                <td className={`${td} text-xs`}>
                  {REVIEW_LABEL[e.review.state]}
                  {e.review.by && <div className="text-ink-400">{e.review.by}</div>}
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  <Button busy={busy === `a${e.id}`} onClick={() => run(`a${e.id}`, async () => void (await api(`/studio/elements/${e.id}`, { method: 'POST', body: { state: 'approved' } })))}>
                    承認
                  </Button>{' '}
                  <Button
                    busy={busy === `r${e.id}`}
                    onClick={() => {
                      const note = window.prompt('却下の理由');
                      if (note) run(`r${e.id}`, async () => void (await api(`/studio/elements/${e.id}`, { method: 'POST', body: { state: 'rejected', note } })));
                    }}
                  >
                    却下
                  </Button>{' '}
                  {e.kind === 'purpose_candidate' && (
                    <Button
                      busy={busy === `i${e.id}`}
                      disabled={!intentKey}
                      onClick={() => run(`i${e.id}`, async () => void (await api('/studio/intents', { method: 'POST', body: { ruleKey: intentKey, elementId: e.id } })))}
                    >
                      目的の候補にする
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <Card title="3. 規則の目的" description="原文から抽出した候補は、人が承認するまで確定しません。原文から確認できない場合は、人が入力します（入力者を記録します）。">
        <Table head={['規則 ID', '版', '目的', '根拠', '状態', '']} empty="まだありません。">
          {cat.intents.map((i) => (
            <tr key={i.id}>
              <td className={`${td} text-xs`}>{i.ruleKey}</td>
              <td className={td}>v{i.version}</td>
              <td className={`${td} max-w-xl whitespace-normal text-xs`}>{i.text}</td>
              <td className={`${td} text-xs`}>{i.basis === 'extracted' ? '原文から抽出' : `人が入力（${i.createdBy}）`}</td>
              <td className={`${td} text-xs`}>
                {i.status === 'candidate' ? '承認待ち' : i.status === 'approved' ? `承認（${i.decidedBy}）` : '却下'}
              </td>
              <td className={`${td} whitespace-nowrap`}>
                {i.status === 'candidate' && (
                  <>
                    <Button busy={busy === `ia${i.id}`} onClick={() => run(`ia${i.id}`, async () => void (await api(`/studio/intents/${i.id}`, { method: 'POST', body: { decision: 'approve' } })))}>
                      承認
                    </Button>{' '}
                    <Button busy={busy === `ir${i.id}`} onClick={() => run(`ir${i.id}`, async () => void (await api(`/studio/intents/${i.id}`, { method: 'POST', body: { decision: 'reject' } })))}>
                      却下
                    </Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="規則 ID">
            <input className={`${inputClass} w-48`} value={humanIntent.ruleKey} onChange={(e) => setHumanIntent({ ...humanIntent, ruleKey: e.target.value })} />
          </Field>
          <Field label="目的（人が入力）">
            <input className={`${inputClass} w-96`} value={humanIntent.text} onChange={(e) => setHumanIntent({ ...humanIntent, text: e.target.value })} />
          </Field>
          <Button busy={busy === 'hi'} onClick={() => run('hi', async () => void (await api('/studio/intents', { method: 'POST', body: humanIntent })))}>
            入力する
          </Button>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="4. 規則を作成（業種の雛形）" description="雛形の判定ロジック（DSL）から規則の版を作り、開いている規則文書の要素と、承認済みの目的に関連付けます。">
          <div className="space-y-3">
            <Field label="雛形">
              <select className={inputClass} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {cat.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-ink-300">{cat.templates.find((t) => t.id === templateId)?.hypothesis}</p>
            <Button
              busy={busy === 'tpl'}
              onClick={() =>
                run('tpl', async () => {
                  const r = await api<{ rules: RuleVersion[]; pendingIntent: string[] }>('/studio/rules', { method: 'POST', body: { templateId, documentId: doc?.document.id ?? null } });
                  return `${r.rules.map((x) => `${x.ruleKey} v${x.version}`).join('、')} を作成しました。${r.pendingIntent.length ? `目的が未承認: ${r.pendingIntent.join('、')}` : ''}`;
                })
              }
            >
              規則を作成{doc ? `（${doc.document.docKey} v${doc.document.version} に関連付け）` : ''}
            </Button>
          </div>
        </Card>

        <Card title="5. 業務プロセス" description="AI に与える業務の目標と、取れる行動の範囲です。行動の範囲はモデルの出力ではなくコードで強制します。">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="業務プロセス ID">
              <input className={inputClass} value={proc.processKey} onChange={(e) => setProc({ ...proc, processKey: e.target.value })} placeholder="PROCUREMENT" />
            </Field>
            <Field label="評価環境">
              <select className={inputClass} value={proc.domain} onChange={(e) => setProc({ ...proc, domain: e.target.value })}>
                {cat.domains
                  .filter((d) => d.id !== 'financial_market')
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="名前">
              <input className={inputClass} value={proc.name} onChange={(e) => setProc({ ...proc, name: e.target.value })} />
            </Field>
            <Field label="AI の業務の目標">
              <input className={inputClass} value={proc.objective} onChange={(e) => setProc({ ...proc, objective: e.target.value })} placeholder="購買依頼をできるだけ早く処理する" />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-sm text-ink-100">
            {cat.domains
              .find((d) => d.id === proc.domain)
              ?.actions.map((a) => (
                <label key={a.type} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={proc.permittedActions.includes(a.type)}
                    onChange={(e) => setProc({ ...proc, permittedActions: e.target.checked ? [...proc.permittedActions, a.type] : proc.permittedActions.filter((x) => x !== a.type) })}
                  />
                  {a.label}
                </label>
              ))}
          </div>
          <div className="mt-3">
            <Button busy={busy === 'proc'} onClick={() => run('proc', async () => void (await api('/studio/processes', { method: 'POST', body: proc })))}>
              登録（新しい版）
            </Button>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-ink-200">
            {cat.processes.map((p) => (
              <li key={p.id}>
                {p.processKey} v{p.version}: {p.name}（{p.industry}）— 目標「{p.objective}」・行動 {p.permittedActions.join(', ')}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="6. 規則の文言の比較実験（ミニマルペア）" description="業務プロセスの目標と行動の範囲で、規則の版だけを変えた2条件を、同じシナリオ・同じシードで実行します（モックのエージェント。AI の行動ではありません）。">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="業務プロセス">
            <select className={inputClass} value={exp.processId} onChange={(e) => setExp({ ...exp, processId: e.target.value })}>
              <option value="">選んでください</option>
              {cat.processes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.processKey} v{p.version}
                </option>
              ))}
            </select>
          </Field>
          <Field label="条件 A の規則">
            <select className={inputClass} value={exp.ruleA} onChange={(e) => setExp({ ...exp, ruleA: e.target.value })}>
              <option value="">選んでください</option>
              {tradingRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.ruleKey} v{r.version}
                </option>
              ))}
            </select>
          </Field>
          <Field label="条件 B の規則">
            <select className={inputClass} value={exp.ruleB} onChange={(e) => setExp({ ...exp, ruleB: e.target.value })}>
              <option value="">選んでください</option>
              {tradingRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.ruleKey} v{r.version}
                </option>
              ))}
            </select>
          </Field>
          <Field label="両条件に共通の規則（任意）">
            <select className={inputClass} value={exp.extraRule} onChange={(e) => setExp({ ...exp, extraRule: e.target.value })}>
              <option value="">なし</option>
              {tradingRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.ruleKey} v{r.version}
                </option>
              ))}
            </select>
          </Field>
          <Field label="モックのエージェントの傾向">
            <select className={inputClass} value={exp.persona} onChange={(e) => setExp({ ...exp, persona: e.target.value })}>
              <option value="gaming">分割する（業務の目標を優先）</option>
              <option value="diligent">まじめ</option>
              <option value="careless">確認しない</option>
            </select>
          </Field>
          <Field label="反復 / 営業日">
            <div className="flex gap-2">
              <input className={`${inputClass} w-20`} type="number" value={exp.replicates} onChange={(e) => setExp({ ...exp, replicates: Number(e.target.value) })} />
              <input className={`${inputClass} w-20`} type="number" value={exp.steps} onChange={(e) => setExp({ ...exp, steps: Number(e.target.value) })} />
            </div>
          </Field>
        </div>
        <div className="mt-3">
          <Button
            variant="primary"
            busy={busy === 'exp'}
            disabled={!exp.processId || !exp.ruleA || !exp.ruleB}
            onClick={() =>
              run('exp', async () => {
                const p = cat.processes.find((x) => x.id === exp.processId)!;
                const extra = exp.extraRule ? [exp.extraRule] : [];
                const ra = rules.find((r) => r.id === exp.ruleA)!;
                const rb = rules.find((r) => r.id === exp.ruleB)!;
                const r = await api<{ study: { id: string } }>('/studies', {
                  method: 'POST',
                  body: {
                    title: `${p.name}: ${ra.ruleKey} vs ${rb.ruleKey}（モック）`,
                    domain: p.domain,
                    environment: { steps: exp.steps },
                    businessProcess: { processId: p.id, objective: p.objective, permittedActions: p.permittedActions },
                    conditions: [
                      { id: 'A', label: ra.ruleKey, ruleVersionIds: [ra.id, ...extra], agentPersona: exp.persona },
                      { id: 'B', label: rb.ruleKey, ruleVersionIds: [rb.id, ...extra], agentPersona: exp.persona },
                    ],
                    primaryComparison: { treatment: 'B', control: 'A' },
                    replicates: exp.replicates,
                    market: { steps: 1 },
                  },
                });
                await api(`/studies/${r.study.id}/actions`, { method: 'POST', body: { action: 'start' } });
                window.location.assign(`/research/studies/${r.study.id}`);
              })
            }
          >
            作成して開始
          </Button>
          {domainRules.length === 0 && <span className="ml-3 text-xs text-ink-300">先に「4. 規則を作成」で規則を作ってください。</span>}
        </div>
        <p className="mt-3 text-xs text-ink-300">
          実験の結果は研究の画面で確認できます。<Link href="/research/studies" className="underline">研究プロジェクトの一覧</Link>
        </p>
      </Card>
    </div>
  );
}
