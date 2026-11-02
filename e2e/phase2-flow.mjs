// Phase 2 の画面の確認（Playwright）。ローカルのサーバーに対してのみ実行する。
//   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=... node e2e/phase2-flow.mjs
// モックの研究と合成のテスト用ラベルを使う（外部の API は使わない。研究結果ではない）。
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
const password = process.env.E2E_PASSWORD;
const outDir = process.env.E2E_OUT_DIR ?? 'e2e-output';
if (!password) throw new Error('E2E_PASSWORD を指定してください');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('E2E はローカルのサーバーに対してのみ実行します');
mkdirSync(outDir, { recursive: true });

const step = (msg) => console.log(`✓ ${msg}`);
const browser = await chromium.launch();
const errors = [];

try {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const call = (url, method = 'GET', body) =>
    page.evaluate(
      async ({ url, method, body }) => {
        const r = await fetch(`/api/research${url}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error?.message ?? r.status);
        return j;
      },
      { url, method, body },
    );
  await page.goto(`${base}/login`);
  await page.getByPlaceholder('パスワード').fill(password);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/research$/);

  // 準備: 規則のミニマルペアでモックの研究を実行し、モックの Judge で評価する（API 経由）
  const pair = await call('/rules/templates', 'POST', { templateId: 'spoof_and_or' });
  const ruleId = pair.ruleB.id;
  const study = (
    await call('/studies', 'POST', {
      title: 'E2E Phase 2（モック）',
      conditions: [{ id: 'OR', label: '又は', ruleVersionIds: [ruleId] }],
      replicates: 3,
      market: { steps: 10 },
    })
  ).study;
  await call(`/studies/${study.id}/actions`, 'POST', { action: 'start' });
  for (let i = 0; i < 120; i++) {
    const s = (await call(`/studies/${study.id}`)).study;
    if (s.status === 'completed') break;
    await page.waitForTimeout(500);
  }
  await call(`/studies/${study.id}/evaluation/runs`, 'POST', { kind: 'mock', sampleSize: 30 });
  for (let i = 0; i < 60; i++) {
    const u = await call(`/studies/${study.id}/evaluations?limit=5`);
    if (u.evaluators.some((e) => e.evaluator.kind === 'llm_judge' && e.evaluated > 0)) break;
    await page.waitForTimeout(500);
  }
  step('モックの研究を実行し、モックの Judge で評価した');

  // 評価の統合: 評価器ごとの判定・複合評価・レビュー
  await page.goto(`${base}/research/studies/${study.id}`);
  await page.getByRole('link', { name: '評価の統合' }).click();
  await page.getByRole('heading', { name: /評価の統合/ }).waitFor();
  await page.getByText('カテゴリの内訳').waitFor();
  await page.getByText('規則エンジン: 規則エンジン（形式判定）').first().waitFor();
  await page.getByText('不一致・要確認のみ').click();
  await page.getByPlaceholder('例: 専門家A').fill('E2E 評価者');
  await page.getByRole('button', { name: 'レビュー' }).first().click();
  await page.getByRole('combobox').filter({ hasText: '承認' }).selectOption('correct');
  await page.getByLabel('理由（修正・却下では必須）').fill('E2E: 修正の確認');
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByText('修正 →').first().waitFor();
  await page.screenshot({ path: path.join(outDir, 'phase2-evaluations.png'), fullPage: true });
  step('評価の統合の画面で、評価器の判定を修正としてレビューした（履歴に残る）');

  // 評価器の検証: データセットの作成 → CSV のラベル → 指標
  const decisions = (await call(`/studies/${study.id}/decisions?limit=30`)).decisions;
  const csv = [
    'study_id,condition_id,replicate,step,annotator,category,formal,note',
    ...decisions.map((d) => {
      const cat = d.enforcement.violations.some((v) => v.ruleKey) ? 'explicit_violation' : d.enforcement.intentDeviations.length ? 'intent_deviation' : 'compliant';
      return `${study.id},${d.conditionId},${d.replicate},${d.step},e2e,${cat},${cat === 'explicit_violation' ? 'violation' : 'compliant'},`;
    }),
  ].join('\n');
  await page.goto(`${base}/research/evaluation/validation`);
  await page.getByRole('heading', { name: '評価器の検証' }).waitFor();
  await page.getByLabel('名前').fill('E2E 合成ラベル');
  await page.getByRole('combobox').first().selectOption('evaluation_test');
  await page.getByLabel('出典（誰が、どの基準で付けたか）').fill('E2E: 規則の定義から作成した合成の正解');
  await page.getByRole('button', { name: '作成' }).click();
  await page.getByText(/データセット「E2E 合成ラベル」v1 を作成しました/).waitFor();
  await page.locator('textarea').fill(csv);
  await page.getByRole('button', { name: 'ラベルを登録' }).click();
  await page.getByText(`${decisions.length} 件のラベルを登録しました。`).waitFor();
  await page.getByText('評価器のテスト用データです。研究結果としては扱いません。').waitFor();
  await page.getByText('評価器ごとの指標').waitFor();
  await page.getByText(/混同行列とクラス別の指標/).first().waitFor();
  await page.screenshot({ path: path.join(outDir, 'phase2-validation.png'), fullPage: true });
  step('外部ラベル（テスト用）を登録し、評価器ごとの指標・混同行列を表示した');

  // Failure Library: 検出と絞り込み
  await call('/failures/detect', 'POST', { studyId: study.id });
  await page.goto(`${base}/research/failures`);
  await page.getByText('検索・絞り込み').waitFor();
  await page.getByLabel('逸脱分類').selectOption('formal_violation');
  await page.waitForTimeout(800);
  const rows = await page.locator('table').last().locator('tbody tr').count();
  await page.screenshot({ path: path.join(outDir, 'phase2-failures.png'), fullPage: true });
  step(`Failure Library を逸脱分類で絞り込んだ（${rows} 件）`);

  if (errors.length) throw new Error(`ページでエラーが発生しました: ${errors.join(' / ')}`);
  console.log('すべての手順が完了しました');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
