import { deflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupEnv } from './helpers';

// Rule & Intent Studio: 規則文書（出典・適用期間・種別・版）、要素の抽出（根拠の位置）、目的の承認、業務プロセス、雛形からの規則の作成。
// 文書は合成のテスト用（実在の社内規程ではない）。

const actor = { id: 'basic:shared', displayName: '研究チーム', tenantId: 'default', permissions: [], authMethod: 'session' as const };

const POLICY = [
  '第1条 この規程は、高額の支出について部門長が必要性と予算を事前に確認できるようにすることを目的とする。',
  '第2条 1件の発注金額が100万円以上となる発注は、事前に部門長の承認を得なければならない。',
  '第3条 請求書の金額が発注の金額と一致しない場合は、支払ってはならない。',
  '第4条 購買担当者は、50万円未満の消耗品を承認なしに発注することができる。ただし、同一の取引先への同日の発注の合計が100万円以上となる場合は、この限りでない。',
  '第5条 この規程において「発注」とは、取引先に対して物品の購入を申し込むことをいう。',
].join('\n');

/** 最小の DOCX（ZIP の中の word/document.xml だけ）をテストの中で作る */
function makeDocx(paragraphs: string[]): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((p) => `<w:p><w:r><w:t>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`)
    .join('')}</w:body></w:document>`;
  const name = Buffer.from('word/document.xml');
  const raw = Buffer.from(xml, 'utf8');
  const data = deflateRawSync(raw);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + data.length;
  const cd = Buffer.concat([central, name]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, cd, eocd]);
}

beforeAll(async () => {
  await setupEnv();
});
afterAll(async () => {
  const { resetStoreForTests } = await import('@/lib/server/storage/store');
  await resetStoreForTests();
});

describe('規則の要素の抽出（pattern-v1）', () => {
  it('義務・禁止・許可・例外・承認条件・定義・目的の候補・閾値を、原文の位置つきで抽出する', async () => {
    const { extractRuleElements } = await import('@/lib/server/domain/ruleExtraction');
    const els = extractRuleElements(POLICY);
    const kinds = (k: string) => els.filter((e) => e.kind === k);
    expect(kinds('obligation')[0].text).toContain('承認を得なければならない');
    expect(kinds('prohibition')[0].text).toContain('支払ってはならない');
    expect(kinds('permission')[0].text).toContain('することができる');
    expect(kinds('exception')[0].text).toContain('この限りでない');
    expect(kinds('definition')[0].text).toContain('をいう');
    expect(kinds('purpose_candidate')[0].text).toContain('目的とする');
    expect(kinds('approval_condition').length).toBeGreaterThanOrEqual(2);
    const th = kinds('threshold').map((e) => e.value!.number);
    expect(th).toContain(1_000_000);
    expect(th).toContain(500_000);
    // 位置は元の本文を指す
    for (const e of els) expect(POLICY.slice(e.start, e.end)).toBe(e.text);
  });
});

describe('Rule & Intent Studio（DB）', () => {
  it('規則文書を版として保存し（種別・出典・適用期間・ハッシュ）、DOCX からも本文を読み取る。保存した版は変更できない', async () => {
    const studio = await import('@/lib/server/domain/studio');
    const v1 = await studio.createRuleDocument({ docKey: 'PURCHASE-POLICY', kind: 'synthetic', title: '購買規程（合成）', source: 'テスト用の合成の規程', effectiveFrom: '2026-04-01', text: POLICY }, actor);
    expect([v1.version, v1.kind, v1.format, v1.effectiveFrom]).toEqual([1, 'synthetic', 'text', '2026-04-01']);
    expect(v1.sha256).toMatch(/^[0-9a-f]{64}$/);
    const docx = makeDocx(POLICY.split('\n'));
    const v2 = await studio.createRuleDocument({ docKey: 'PURCHASE-POLICY', kind: 'internal_policy', title: '購買規程（DOCX）', source: 'テスト用', format: 'docx', contentBase64: docx.toString('base64') }, actor);
    expect(v2.version).toBe(2);
    expect(v2.text).toBe(POLICY);
    expect(v2.originalSha256).not.toBe(v2.sha256);
    await expect(studio.createRuleDocument({ docKey: 'X1', kind: 'synthetic', title: 't', source: 's', effectiveFrom: '2026-05-01', effectiveTo: '2026-04-01', text: 'a' }, actor)).rejects.toThrow(/適用期間/);
    await expect(studio.createRuleDocument({ docKey: 'X2', kind: 'synthetic', title: 't', source: 's', format: 'docx', contentBase64: Buffer.from('not a zip').toString('base64') }, actor)).rejects.toThrow(/DOCX/);
    const { getDb } = await import('@/lib/server/db');
    await expect((await getDb()).query(`UPDATE rc_rule_documents SET kind = 'real_law' WHERE id = $1`, [v1.id])).rejects.toThrow();
    const got = (await studio.getRuleDocument(v1.id))!;
    expect(got.elements.length).toBeGreaterThan(5);
    expect(got.elements.every((e) => e.review.state === 'unreviewed' && e.extractionMethod === 'pattern-v1')).toBe(true);
  });

  it('規則の目的は、原文から根拠つきで抽出した候補を人が承認するまで確定しない。人が入力した目的は入力者を記録する', async () => {
    const studio = await import('@/lib/server/domain/studio');
    const doc = (await studio.listRuleDocuments()).find((d) => d.docKey === 'PURCHASE-POLICY' && d.version === 1)!;
    const full = (await studio.getRuleDocument(doc.id))!;
    const purpose = full.elements.find((e) => e.kind === 'purpose_candidate')!;
    const cand = await studio.createPolicyIntent({ ruleKey: 'APPROVAL-PER-ORDER', elementId: purpose.id }, actor);
    expect([cand.status, cand.basis, cand.evidenceElementId]).toEqual(['candidate', 'extracted', purpose.id]);
    expect(await studio.approvedIntent('APPROVAL-PER-ORDER')).toBeNull();
    const ok = await studio.decidePolicyIntent(cand.id, { decision: 'approve' }, actor);
    expect(ok.status).toBe('approved');
    await expect(studio.decidePolicyIntent(cand.id, { decision: 'reject' }, actor)).rejects.toThrow(/候補/);
    const human = await studio.createPolicyIntent({ ruleKey: 'PAY-MATCH', text: '発注していない金額の支払を防ぐ。' }, actor);
    expect([human.status, human.basis, human.decidedBy]).toEqual(['approved', 'human_entered', '研究チーム']);
    // 却下した要素は根拠にできない
    const other = full.elements.find((e) => e.kind === 'definition')!;
    await studio.reviewRuleElement(other.id, { state: 'rejected', note: '目的ではない' }, actor);
    await expect(studio.createPolicyIntent({ ruleKey: 'X-1', elementId: other.id }, actor)).rejects.toThrow(/却下/);
    // 修正は理由が必要で、元の抽出結果を履歴に残す
    await expect(studio.reviewRuleElement(purpose.id, { state: 'edited', text: '修正' }, actor)).rejects.toThrow(/note/);
    const edited = await studio.reviewRuleElement(purpose.id, { state: 'edited', text: '高額の支出を部門長が確認する。', note: '要約' }, actor);
    expect([edited.review.state, edited.text]).toEqual(['edited', '高額の支出を部門長が確認する。']);
  });

  it('雛形から規則を作ると、規則文書の要素と承認済みの目的に関連付く。業務プロセス（目標・行動の範囲）を版として保存する', async () => {
    const studio = await import('@/lib/server/domain/studio');
    const doc = (await studio.listRuleDocuments()).find((d) => d.docKey === 'PURCHASE-POLICY' && d.version === 1)!;
    const r = await studio.createRulesFromTemplate({ templateId: 'approval_per_order_vs_request', documentId: doc.id }, actor);
    const perOrder = r.rules.find((x) => x.ruleKey === 'APPROVAL-PER-ORDER')!;
    expect(perOrder.domain).toBe('trading_company');
    expect(perOrder.sourceDocumentId).toBe(doc.id);
    expect(perOrder.sourceElementIds!.length).toBeGreaterThan(0);
    expect(perOrder.purpose).toBe('第1条 この規程は、高額の支出について部門長が必要性と予算を事前に確認できるようにすることを目的とする。');
    // 承認済みの目的がない規則は「目的は未確定」として返す
    expect(r.pendingIntent).toContain('APPROVAL-PER-REQUEST');
    const p = await studio.createBusinessProcess({ processKey: 'PROCUREMENT', domain: 'trading_company', name: '購買', objective: '購買依頼を早く処理する', permittedActions: ['order', 'pay'], ruleKeys: ['APPROVAL-PER-ORDER'] }, actor);
    expect([p.version, p.industry, p.permittedActions]).toEqual([1, '商社', ['order', 'pay']]);
    await expect(studio.createBusinessProcess({ processKey: 'BAD', domain: 'trading_company', name: 'x', objective: 'x', permittedActions: ['buy'] }, actor)).rejects.toThrow(/行動の範囲/);
    expect((await studio.createBusinessProcess({ processKey: 'PROCUREMENT', domain: 'trading_company', name: '購買 v2', objective: '承認を守りつつ早く処理する' }, actor)).version).toBe(2);
  });
});
