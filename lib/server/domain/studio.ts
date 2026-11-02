import { createHash, randomUUID } from 'node:crypto';
import { DOMAINS, domainOf } from '@/lib/domain/descriptors';
import type { BusinessProcess, PolicyIntent, ReviewState, RuleDocument, RuleDocumentKind, RuleElement } from '@/lib/domain/model';
import { audit } from '../audit';
import type { Principal } from '../auth/types';
import { getDb } from '../db';
import { ValidationError } from '../research/providers';
import { saveRuleVersion } from '../research/study/rules';
import { docxToText, DocumentFormatError, MAX_DOC_BYTES } from './docText';
import { extractRuleElements } from './ruleExtraction';
import { INVOICE_MATCH_RULE, TRADING_RULE_TEMPLATES } from './templates';

// Rule & Intent Studio: 規則の原文（出典・適用期間・種別）を版として保存し、規則の要素を根拠の位置つきで抽出する。
// 規則の目的は、原文から根拠つきで抽出した候補を人が承認するか、人が入力したものだけを使う（AI が勝手に確定しない）。
// 合成の規則と、実在の法令・社内規程は種別で区別し、実在の法令についての法的な判断は行わない。

const KINDS: RuleDocumentKind[] = ['synthetic', 'real_law', 'internal_policy'];
const DOC_KEY = /^[A-Za-z][A-Za-z0-9_-]{1,59}$/;
const RULE_KEY = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/;
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const str = (v: unknown, field: string, max: number, required = false) => {
  const t = typeof v === 'string' ? v.trim() : '';
  if (required && !t) throw new ValidationError(`「${field}」を入力してください。`, field);
  if (t.length > max) throw new ValidationError(`「${field}」は${max}文字以内にしてください。`, field);
  return t;
};
const date = (v: unknown, field: string) => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new ValidationError(`「${field}」は YYYY-MM-DD で入力してください。`, field);
  return v;
};

type DocRow = { id: string; doc_key: string; version: number; kind: RuleDocumentKind; format: 'text' | 'docx'; sha256: string; effective_from: string | Date | null; effective_to: string | Date | null; created_at: Date | string; data: { title: string; source: string; text: string; createdBy: string; originalSha256?: string } };
const isoDate = (v: string | Date | null) => (v === null ? null : typeof v === 'string' ? v.slice(0, 10) : v.toISOString().slice(0, 10));
const toDoc = (r: DocRow): RuleDocument & { originalSha256: string | null } => ({
  id: r.id,
  version: Number(r.version),
  docKey: r.doc_key,
  kind: r.kind,
  title: r.data.title,
  source: r.data.source,
  effectiveFrom: isoDate(r.effective_from),
  effectiveTo: isoDate(r.effective_to),
  format: r.format,
  sha256: r.sha256,
  originalSha256: r.data.originalSha256 ?? null,
  text: r.data.text,
  createdAt: new Date(r.created_at).toISOString(),
  createdBy: r.data.createdBy,
});

type ElRow = { id: string; document_id: string; kind: RuleElement['kind']; span_start: number; span_end: number; extraction_method: RuleElement['extractionMethod']; review_state: ReviewState; data: { text: string; documentVersion: number; value?: RuleElement['value']; review: RuleElement['review'] } };
const toEl = (r: ElRow): RuleElement => ({
  id: r.id,
  documentId: r.document_id,
  documentVersion: r.data.documentVersion,
  kind: r.kind,
  text: r.data.text,
  span: { start: Number(r.span_start), end: Number(r.span_end) },
  extractionMethod: r.extraction_method,
  value: r.data.value ?? null,
  review: { ...r.data.review, state: r.review_state },
});

/** 規則文書の登録（新しい版）。本文から要素を抽出して「未レビュー」で保存する */
export async function createRuleDocument(input: Record<string, unknown>, actor: Principal) {
  const docKey = str(input.docKey, 'docKey', 60, true);
  if (!DOC_KEY.test(docKey)) throw new ValidationError('文書 ID は英字で始まる英数字・-・_（2〜60文字）にしてください。', 'docKey');
  const kind = input.kind as RuleDocumentKind;
  if (!KINDS.includes(kind)) throw new ValidationError('文書の種別（合成 / 実在の法令 / 社内規程）を選んでください。', 'kind');
  const title = str(input.title, 'title', 200, true);
  const source = str(input.source, 'source', 1000, true);
  const effectiveFrom = date(input.effectiveFrom, 'effectiveFrom');
  const effectiveTo = date(input.effectiveTo, 'effectiveTo');
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) throw new ValidationError('適用期間の終わりが始まりより前です。', 'effectiveTo');
  const format = input.format === 'docx' ? 'docx' : 'text';
  let text: string;
  let originalSha256: string;
  if (format === 'docx') {
    const b64 = typeof input.contentBase64 === 'string' ? input.contentBase64 : '';
    const buf = Buffer.from(b64, 'base64');
    if (!buf.length) throw new ValidationError('DOCX ファイルを選んでください。', 'contentBase64');
    if (buf.length > MAX_DOC_BYTES) throw new ValidationError('ファイルが大きすぎます（5MB まで）。', 'contentBase64');
    try {
      text = docxToText(buf);
    } catch (e) {
      throw new ValidationError(e instanceof DocumentFormatError ? e.message : 'DOCX を読み取れませんでした。', 'contentBase64');
    }
    originalSha256 = sha256(buf);
  } else {
    text = str(input.text, 'text', 200_000, true);
    originalSha256 = sha256(text);
  }
  if (!text.trim()) throw new ValidationError('本文が空です。', 'text');
  const db = await getDb();
  const doc = await db.transaction(async (tx) => {
    const v = await tx.query<{ v: number | null }>(`SELECT max(version) AS v FROM rc_rule_documents WHERE project_id = 'default' AND doc_key = $1`, [docKey]);
    const version = Number(v[0]?.v ?? 0) + 1;
    const rows = await tx.query<DocRow>(
      `INSERT INTO rc_rule_documents (id, doc_key, version, kind, format, sha256, effective_from, effective_to, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::jsonb) RETURNING *`,
      [randomUUID(), docKey, version, kind, format, sha256(text), effectiveFrom, effectiveTo, JSON.stringify({ title, source, text, createdBy: actor.displayName, originalSha256 })],
    );
    const d = toDoc(rows[0]);
    for (const e of extractRuleElements(text)) {
      await tx.query(
        `INSERT INTO rc_rule_elements (id, document_id, kind, span_start, span_end, extraction_method, data) VALUES ($1, $2, $3, $4, $5, 'pattern-v1', $6::text::jsonb)`,
        [randomUUID(), d.id, e.kind, e.start, e.end, JSON.stringify({ text: e.text, documentVersion: version, value: e.value ?? null, review: { state: 'unreviewed', by: null, at: null, note: null } })],
      );
    }
    return d;
  });
  await audit(actor, 'rule_document.create', doc.id, 'success', `${docKey} v${doc.version} ${kind}`);
  return doc;
}

export async function listRuleDocuments() {
  const db = await getDb();
  const rows = await db.query<DocRow>(`SELECT * FROM rc_rule_documents ORDER BY doc_key, version DESC LIMIT 200`);
  return rows.map((r) => {
    const { text, ...rest } = toDoc(r);
    return { ...rest, length: text.length };
  });
}

export async function getRuleDocument(id: string) {
  const db = await getDb();
  const rows = await db.query<DocRow>('SELECT * FROM rc_rule_documents WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const elements = (await db.query<ElRow>('SELECT * FROM rc_rule_elements WHERE document_id = $1 ORDER BY span_start, kind', [id])).map(toEl);
  const intents = (await db.query<IntentRow>('SELECT * FROM rc_policy_intents WHERE document_id = $1 ORDER BY rule_key, version', [id])).map(toIntent);
  return { document: toDoc(rows[0]), elements, intents };
}

/** 要素のレビュー（承認・却下・修正）。修正した場合は元の抽出結果を履歴に残す */
export async function reviewRuleElement(id: string, input: Record<string, unknown>, actor: Principal) {
  const state = input.state as ReviewState;
  if (!['approved', 'rejected', 'edited'].includes(state)) throw new ValidationError('レビューの結果を選んでください。', 'state');
  const note = str(input.note, 'note', 1000, state !== 'approved');
  const db = await getDb();
  const rows = await db.query<ElRow>('SELECT * FROM rc_rule_elements WHERE id = $1', [id]);
  if (!rows[0]) throw new ValidationError('要素が見つかりません。');
  const prev = rows[0].data;
  const text = state === 'edited' ? str(input.text, 'text', 2000, true) : prev.text;
  const data = { ...prev, text, history: [...((prev as { history?: unknown[] }).history ?? []), { text: prev.text, review: prev.review }], review: { state, by: actor.displayName, at: new Date().toISOString(), note } };
  await db.query('UPDATE rc_rule_elements SET review_state = $2, data = $3::text::jsonb WHERE id = $1', [id, state, JSON.stringify(data)]);
  await audit(actor, `rule_element.${state}`, id, 'success', note);
  return toEl({ ...rows[0], review_state: state, data });
}

// ---------- 規則の目的（PolicyIntent） ----------

type IntentRow = { id: string; rule_key: string; version: number; basis: PolicyIntent['basis']; document_id: string | null; evidence_element_id: string | null; status: PolicyIntent['status']; created_at: Date | string; data: { text: string; decidedBy: string | null; decidedAt: string | null; createdBy: string } };
const toIntent = (r: IntentRow): PolicyIntent & { createdBy: string } => ({
  id: r.id,
  version: Number(r.version),
  ruleKey: r.rule_key,
  text: r.data.text,
  basis: r.basis,
  documentId: r.document_id,
  evidenceElementId: r.evidence_element_id,
  status: r.status,
  decidedBy: r.data.decidedBy,
  decidedAt: r.data.decidedAt,
  createdAt: new Date(r.created_at).toISOString(),
  createdBy: r.data.createdBy,
});

/**
 * 規則の目的の登録。
 * - elementId を指定: 原文の要素を根拠とする「候補」（人の承認が必要）
 * - text だけを指定: 人が入力した目的（原文から確認できない場合）。入力者を記録し、承認済みとして扱う
 */
export async function createPolicyIntent(input: Record<string, unknown>, actor: Principal) {
  const ruleKey = str(input.ruleKey, 'ruleKey', 40, true);
  if (!RULE_KEY.test(ruleKey)) throw new ValidationError('規則 ID は英字で始まる英数字・-・_にしてください。', 'ruleKey');
  const db = await getDb();
  let basis: PolicyIntent['basis'];
  let text: string;
  let documentId: string | null = null;
  let elementId: string | null = null;
  if (typeof input.elementId === 'string' && input.elementId) {
    const el = (await db.query<ElRow>('SELECT * FROM rc_rule_elements WHERE id = $1', [input.elementId]))[0];
    if (!el) throw new ValidationError('根拠の要素が見つかりません。', 'elementId');
    if (el.review_state === 'rejected') throw new ValidationError('却下された要素は根拠にできません。', 'elementId');
    basis = 'extracted';
    text = el.data.text;
    documentId = el.document_id;
    elementId = el.id;
  } else {
    basis = 'human_entered';
    text = str(input.text, 'text', 2000, true);
    documentId = typeof input.documentId === 'string' && input.documentId ? input.documentId : null;
  }
  const status: PolicyIntent['status'] = basis === 'human_entered' ? 'approved' : 'candidate';
  const now = new Date().toISOString();
  const rows = await db.transaction(async (tx) => {
    const v = await tx.query<{ v: number | null }>('SELECT max(version) AS v FROM rc_policy_intents WHERE rule_key = $1', [ruleKey]);
    return tx.query<IntentRow>(
      `INSERT INTO rc_policy_intents (id, rule_key, version, basis, document_id, evidence_element_id, status, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text::jsonb) RETURNING *`,
      [randomUUID(), ruleKey, Number(v[0]?.v ?? 0) + 1, basis, documentId, elementId, status, JSON.stringify({ text, decidedBy: status === 'approved' ? actor.displayName : null, decidedAt: status === 'approved' ? now : null, createdBy: actor.displayName })],
    );
  });
  await audit(actor, `policy_intent.create.${basis}`, rows[0].id, 'success', ruleKey);
  return toIntent(rows[0]);
}

export async function decidePolicyIntent(id: string, input: Record<string, unknown>, actor: Principal) {
  const decision = input.decision === 'approve' ? 'approved' : input.decision === 'reject' ? 'rejected' : null;
  if (!decision) throw new ValidationError('承認か却下を選んでください。', 'decision');
  const db = await getDb();
  const row = (await db.query<IntentRow>('SELECT * FROM rc_policy_intents WHERE id = $1', [id]))[0];
  if (!row) throw new ValidationError('規則の目的が見つかりません。');
  if (row.status !== 'candidate') throw new ValidationError('候補の状態の目的だけを承認・却下できます。');
  const data = { ...row.data, decidedBy: actor.displayName, decidedAt: new Date().toISOString() };
  await db.query('UPDATE rc_policy_intents SET status = $2, data = $3::text::jsonb WHERE id = $1', [id, decision, JSON.stringify(data)]);
  await audit(actor, `policy_intent.${decision}`, id, 'success', row.rule_key);
  return toIntent({ ...row, status: decision, data });
}

/** 規則の承認済みの目的（最新の版）。なければ null（目的は未確定） */
export async function approvedIntent(ruleKey: string) {
  const db = await getDb();
  const rows = await db.query<IntentRow>(`SELECT * FROM rc_policy_intents WHERE rule_key = $1 AND status = 'approved' ORDER BY version DESC LIMIT 1`, [ruleKey]);
  return rows[0] ? toIntent(rows[0]) : null;
}

export async function listPolicyIntents(ruleKey?: string) {
  const db = await getDb();
  return (await db.query<IntentRow>('SELECT * FROM rc_policy_intents WHERE ($1::text IS NULL OR rule_key = $1) ORDER BY rule_key, version DESC LIMIT 500', [ruleKey ?? null])).map(toIntent);
}

// ---------- 業務プロセス ----------

type ProcRow = { id: string; process_key: string; version: number; domain: string; created_at: Date | string; data: Omit<BusinessProcess, 'id' | 'version' | 'processKey' | 'domain' | 'createdAt'> };
const toProc = (r: ProcRow): BusinessProcess => ({ ...r.data, id: r.id, version: Number(r.version), processKey: r.process_key, domain: r.domain as BusinessProcess['domain'], createdAt: new Date(r.created_at).toISOString() });

export async function createBusinessProcess(input: Record<string, unknown>, actor: Principal) {
  const processKey = str(input.processKey, 'processKey', 60, true);
  if (!DOC_KEY.test(processKey)) throw new ValidationError('業務プロセス ID は英字で始まる英数字・-・_にしてください。', 'processKey');
  const d = domainOf(String(input.domain ?? ''));
  if (!d) throw new ValidationError('評価環境（ドメイン）を選んでください。', 'domain');
  const permitted = Array.isArray(input.permittedActions) ? input.permittedActions.filter((x): x is string => typeof x === 'string') : d.actions.map((a) => a.type);
  if (!permitted.every((a) => d.actions.some((x) => x.type === a))) throw new ValidationError('行動の範囲に、この評価環境にない行動が含まれています。', 'permittedActions');
  const ruleKeys = Array.isArray(input.ruleKeys) ? input.ruleKeys.filter((x): x is string => typeof x === 'string').slice(0, 30) : [];
  const data = {
    industry: d.industry,
    name: str(input.name, 'name', 120, true),
    description: str(input.description, 'description', 2000),
    objective: str(input.objective, 'objective', 1000, true),
    permittedActions: permitted,
    ruleKeys,
    createdBy: actor.displayName,
  };
  const db = await getDb();
  const rows = await db.transaction(async (tx) => {
    const v = await tx.query<{ v: number | null }>(`SELECT max(version) AS v FROM rc_business_processes WHERE project_id = 'default' AND process_key = $1`, [processKey]);
    return tx.query<ProcRow>(`INSERT INTO rc_business_processes (id, process_key, version, domain, data) VALUES ($1, $2, $3, $4, $5::text::jsonb) RETURNING *`, [randomUUID(), processKey, Number(v[0]?.v ?? 0) + 1, d.id, JSON.stringify(data)]);
  });
  await audit(actor, 'business_process.create', rows[0].id, 'success', `${processKey} v${rows[0].version}`);
  return toProc(rows[0]);
}

export async function listBusinessProcesses() {
  const db = await getDb();
  return (await db.query<ProcRow>('SELECT * FROM rc_business_processes ORDER BY process_key, version DESC LIMIT 200')).map(toProc);
}

export async function getBusinessProcess(id: string) {
  const db = await getDb();
  const r = (await db.query<ProcRow>('SELECT * FROM rc_business_processes WHERE id = $1', [id]))[0];
  return r ? toProc(r) : null;
}

/**
 * ドメインの雛形から規則の版を作る。規則文書（出典）に関連付け、規則の目的は承認済みの PolicyIntent があればそれを使う
 * （なければ雛形の目的を「合成の雛形の目的」として使い、承認待ちである旨を返す）。
 */
export async function createRulesFromTemplate(input: Record<string, unknown>, actor: Principal) {
  const templateId = String(input.templateId ?? '');
  const t = TRADING_RULE_TEMPLATES.find((x) => x.id === templateId);
  const defs = t ? [t.a, t.b] : templateId === 'invoice_match' ? [INVOICE_MATCH_RULE] : null;
  if (!defs) throw new ValidationError('雛形が見つかりません。', 'templateId');
  const documentId = typeof input.documentId === 'string' && input.documentId ? input.documentId : null;
  const doc = documentId ? await getRuleDocument(documentId) : null;
  if (documentId && !doc) throw new ValidationError('規則文書が見つかりません。', 'documentId');
  const created = [];
  const pendingIntent: string[] = [];
  for (const def of defs) {
    const intent = await approvedIntent(def.ruleKey);
    if (!intent) pendingIntent.push(def.ruleKey);
    // 文書の中で条文に一致する要素を根拠として関連付ける
    const elementIds = doc ? doc.elements.filter((e) => e.review.state !== 'rejected' && def.text.includes(e.text.replace(/。$/, ''))).map((e) => e.id) : [];
    created.push(
      await saveRuleVersion({ ...def, purpose: intent?.text ?? def.purpose, sourceDocumentId: documentId, sourceElementIds: elementIds } as unknown as Record<string, unknown>, actor),
    );
  }
  return { rules: created, pendingIntent };
}

export const studioCatalog = () => ({
  domains: Object.values(DOMAINS),
  templates: [
    ...TRADING_RULE_TEMPLATES.map((t) => ({ id: t.id, domain: 'trading_company', label: t.label, changedTerms: t.changedTerms, hypothesis: t.hypothesis, rules: [t.a, t.b] })),
    { id: 'invoice_match', domain: 'trading_company', label: '請求書の照合', changedTerms: '', hypothesis: '', rules: [INVOICE_MATCH_RULE] },
  ],
});
