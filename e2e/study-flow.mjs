// ブラウザでの一連の研究フローの確認（Playwright）。
// 条文A/Bの作成 → 研究の作成（同一条件） → 実行 → 行動ログの確認 → 統計比較 → エクスポート。
//
// 使い方（ローカルで起動したサーバーに対して実行。本番環境には実行しないでください）:
//   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=... node e2e/study-flow.mjs
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
const context = await browser.newContext({ httpCredentials: { username: 'researcher', password }, acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

try {
  // 1. 雛形から条文A/B（見せ玉: かつ / 又は）を作成
  await page.goto(`${base}/research/rules`);
  await page.getByText('見せ玉: 「かつ」と「又は」').first().waitFor();
  await page.getByRole('button', { name: 'この雛形で条文A/Bを作成' }).first().click();
  await page.waitForURL(/\/research\/rules\/pairs\//);
  await page.locator('del', { hasText: 'かつ' }).first().waitFor();
  await page.locator('ins', { hasText: '又は' }).first().waitFor();
  step('条文A/Bを作成し、差分（かつ → 又は）が強調表示された');
  await page.screenshot({ path: path.join(outDir, '1-pair.png'), fullPage: true });

  // 研究者による確認
  await page.getByLabel('確認結果').selectOption('approved');
  await page.getByRole('button', { name: '確認結果を保存' }).click();
  await page.getByText('保存しました').waitFor();
  step('研究者が差分の分類を確認した');

  // 2. このペアで研究を作成（同じ市場・シード）
  await page.getByRole('link', { name: 'このペアで研究を作成' }).click();
  await page.waitForURL(/\/research\/studies\/new/);
  await page.getByLabel('反復数（条件ごと）').fill('8');
  await page.getByLabel('ステップ数').fill('12');
  await page.getByRole('button', { name: '下書きとして保存' }).click();
  await page.waitForURL(/\/research\/studies\/[0-9a-f-]{36}$/);
  step('研究デザインを下書きとして保存した（モックエージェント）');

  // 3. 凍結して開始し、完了を待つ
  await page.getByRole('button', { name: '設定を凍結して開始' }).click();
  await page.getByText('完了', { exact: true }).first().waitFor({ timeout: 120_000 });
  const hash = await page.locator('dd.font-mono').first().textContent();
  if (!/^[0-9a-f]{64}$/.test(hash?.trim() ?? '')) throw new Error(`凍結ハッシュが表示されていません: ${hash}`);
  await page.getByText('モックデータ', { exact: true }).first().waitFor();
  step(`実行が完了した（凍結ハッシュ ${hash.trim().slice(0, 12)}…、モックデータと表示）`);

  // 4. 統計比較
  await page.getByText('条件間の比較（規則違反率）').waitFor();
  await page.getByText('主要', { exact: true }).waitFor();
  await page.locator('svg[role="img"]').waitFor();
  step('統計比較の表とグラフが表示された');

  // 5. 行動ログ（4要素）の確認
  await page.getByRole('heading', { name: '意思決定ログ' }).scrollIntoViewIfNeeded();
  await page.locator('tr.cursor-pointer').first().click();
  for (const label of ['A. 実験条件', 'B. 表明された説明', 'C. 提案された行動', 'D. 規則エンジンの判定', 'E. 監視AIの評価']) {
    await page.getByText(label).first().waitFor();
  }
  step('意思決定ログを4要素（＋実験条件）に分けて確認できた');
  await page.screenshot({ path: path.join(outDir, '2-study.png'), fullPage: true });

  // 6. エクスポート
  for (const [name, check] of [
    ['レポート（Markdown）', (t) => t.includes('【モックデータ】') && t.includes('法的助言ではありません')],
    ['意思決定ログ（CSV）', (t) => t.includes('condition_id') && t.split('\n').length > 100],
    ['凍結設定（JSON）', (t) => JSON.parse(t).frozenHash === hash.trim()],
  ]) {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name }).click()]);
    const file = path.join(outDir, download.suggestedFilename());
    await download.saveAs(file);
    const text = (await import('node:fs')).readFileSync(file, 'utf8').replace(/^﻿/, '');
    if (!check(text)) throw new Error(`${name} の内容が想定と異なります`);
    step(`${name} をエクスポートした（${download.suggestedFilename()}）`);
  }

  if (errors.length) throw new Error(`ページでエラーが発生しました: ${errors.join(' / ')}`);
  console.log('すべての手順が完了しました');
} catch (e) {
  await page.screenshot({ path: path.join(outDir, 'failure.png'), fullPage: true }).catch(() => undefined);
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
