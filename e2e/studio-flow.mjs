// Rule & Intent Studio と商社の業務モデルの確認（Playwright）。ローカルのサーバーに対してのみ実行する。
//   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=... node e2e/studio-flow.mjs
// 合成の規程とモックのエージェントを使う（外部の API は使わない。研究結果ではない）。
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

const POLICY = [
  '第1条 この規程は、高額の支出について部門長が必要性と予算を事前に確認できるようにすることを目的とする。',
  '第2条 1件の発注金額が100万円以上となる発注は、事前に部門長の承認を得なければならない。',
  '第3条 請求書の金額が発注の金額と一致しない場合は、支払ってはならない。',
].join('\n');

const step = (msg) => console.log(`✓ ${msg}`);
// 実行ごとに一意の ID（同じサーバーで繰り返し実行できるように）
const run = Date.now().toString(36).toUpperCase();
const browser = await chromium.launch();
const errors = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept('E2E: 目的ではない'));
  await page.goto(`${base}/login`);
  await page.getByPlaceholder('パスワード').fill(password);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/research$/);

  await page.goto(`${base}/research/studio`);
  await page.getByRole('heading', { name: 'Rule & Intent Studio' }).waitFor();
  await page.getByPlaceholder('PURCHASE-POLICY').fill(`E2E-POLICY-${run}`);
  await page.getByLabel('題名').fill('購買規程（合成・E2E）');
  await page.getByPlaceholder('規程名・発行者・URL など').fill('E2E テスト用の合成の規程');
  await page.getByLabel('適用開始日').fill('2026-04-01');
  await page.getByLabel('本文（テキスト）').fill(POLICY);
  await page.getByRole('button', { name: '登録して要素を抽出' }).click();
  await page.getByText(/v1 を登録し、要素を抽出しました/).waitFor();
  await page.getByText('合成の規則（研究用）です。').waitFor();
  step('規則の原文を登録し、要素（義務・禁止・閾値・目的の候補）を根拠の位置つきで抽出した');

  // 目的の候補 → 承認
  await page.getByPlaceholder('APPROVAL-PER-ORDER').fill('APPROVAL-PER-ORDER');
  await page.getByRole('button', { name: '目的の候補にする' }).first().click();
  await page.getByText('承認待ち').first().waitFor();
  const intentRow = page.locator('tr', { hasText: '承認待ち' }).first();
  await intentRow.getByRole('button', { name: '承認' }).click();
  await page.getByText(/承認（/).first().waitFor();
  step('規則の目的は、原文の根拠つきの候補を人が承認して確定した');

  // 雛形から規則（文書と承認済みの目的に関連付け）
  await page.getByRole('button', { name: /規則を作成/ }).click();
  await page.getByText(/APPROVAL-PER-ORDER v\d+、APPROVAL-PER-REQUEST v\d+ を作成しました/).waitFor();
  step('業種の雛形（承認の規則のミニマルペア）から規則を作成し、規則文書に関連付けた');

  // 業務プロセス
  await page.getByPlaceholder('PROCUREMENT').fill(`E2E-PROC-${run}`);
  await page.getByLabel('名前').fill('購買（E2E）');
  await page.getByPlaceholder('購買依頼をできるだけ早く処理する').fill('購買依頼をできるだけ早く処理する');
  await page.getByRole('button', { name: '登録（新しい版）' }).click();
  await page.getByText(`E2E-PROC-${run} v1: 購買（E2E）`, { exact: false }).waitFor();
  step('業務プロセス（AI の目標・行動の範囲）を登録した');

  // 比較実験
  const selects = page.locator('select');
  // 業務プロセスの選択欄（ラベルが「業務プロセス ID」と重なるため、選択肢で特定する）
  const procSel = page.locator('select', { has: page.locator(`option:text-is("E2E-PROC-${run} v1")`) });
  await procSel.selectOption({ label: `E2E-PROC-${run} v1` });
  const opt = async (label, re) => {
    const s = page.getByLabel(label);
    const v = await s.locator('option').filter({ hasText: re }).first().getAttribute('value');
    await s.selectOption(v);
  };
  await opt('条件 A の規則', /APPROVAL-PER-ORDER/);
  await opt('条件 B の規則', /APPROVAL-PER-REQUEST/);
  void selects;
  await page.getByRole('button', { name: '作成して開始' }).click();
  await page.waitForURL(/\/research\/studies\/[0-9a-f-]+$/);
  await page.getByText('条件ごとの結果').waitFor({ timeout: 60_000 });
  for (let i = 0; i < 60; i++) {
    if (await page.getByText('主要比較（反復単位の対応のある比較）').isVisible()) {
      const done = await page.getByText('完了').first().isVisible().catch(() => false);
      if (done) break;
    }
    await page.waitForTimeout(1000);
  }
  await page.getByText('形式違反率').first().waitFor();
  await page.screenshot({ path: path.join(outDir, 'studio-study.png'), fullPage: true });
  step('商社の業務モデルで、規則の文言だけを変えた2条件の比較実験を実行し、結果（形式違反率・趣旨逸脱率・反復単位の比較）を表示した');

  if (errors.length) throw new Error(`ページでエラーが発生しました: ${errors.join(' / ')}`);
  console.log('すべての手順が完了しました');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
