// 研究デモ（/demo/research）の確認（Playwright）。ローカルのサーバーに対してのみ実行する。ログインは不要。
//   E2E_BASE_URL=http://127.0.0.1:3100 node e2e/demo-flow.mjs
// 外部の API には接続しない（ブラウザ内の決定論的なシミュレーション）。
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const base = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';
const outDir = process.env.E2E_OUT_DIR ?? 'e2e-output';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('E2E はローカルのサーバーに対してのみ実行します');
mkdirSync(outDir, { recursive: true });

const step = (msg) => console.log(`✓ ${msg}`);
const browser = await chromium.launch();
const errors = [];
const external = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  // 外部への通信がないこと（同じオリジン以外へのリクエストを記録）
  page.on('request', (r) => {
    if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url());
  });

  await page.goto(`${base}/demo/research`);
  await page.getByText('規則を守るAIは、その規則の目的まで守っているか。').waitFor();
  await page.getByText('Kisei Research Lab').first().waitFor();
  step('ログインなしで研究デモの概要を表示した（仮説と結果を区別）');

  // ガイド付きモード Step 1: 規則の違い
  await page.getByRole('link', { name: /研究デモを開始/ }).click();
  await page.waitForURL(/\/demo\/research\/rules$/);
  await page.getByText('Step 1：規則の違いを理解する').waitFor();
  const mark = await page.getByTestId('text-A').locator('mark').innerText();
  if (mark !== '新規に') throw new Error(`強調表示が「新規に」ではありません: ${mark}`);
  await page.getByText('適合（対象外）').first().waitFor();
  step('条文A/Bを並べ、違い「新規に」を強調し、同じ行動の形式判定の違いを示した');

  // 規則の編集（版が上がる・未対応の文言は評価不能）
  await page.getByLabel('条文B').fill('直前の約定価格を下回る価格で、空売り注文を出してはならない。ただし、リスク調整の売りはこの限りでない。');
  await page.getByText(/未対応の条件/).waitFor();
  await page.getByRole('button', { name: '研究資料の例に戻す' }).click();
  step('判定器が扱えない文言を「未対応の条件」と表示した');

  // Step 2 → 3: 市場
  await page.getByRole('button', { name: '次へ' }).click();
  await page.waitForURL(/\/experiment$/);
  await page.getByRole('button', { name: '次へ' }).click();
  await page.waitForURL(/\/market$/);
  await page.getByText('Step 3：AI エージェントの行動を観察する').waitFor();
  // シードによる再現性: 20 ステップ進めた状態を記録 → Reset → 同じ操作で同じ状態
  for (let i = 0; i < 20; i++) await page.getByRole('button', { name: 'Step Forward' }).click();
  const snap = async () => [await page.getByText(/^t = \d+ \/ \d+$/).innerText(), await page.getByTestId('agent-orders').innerText()].join('|');
  const first = await snap();
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByText(/^t = 0 \/ \d+$/).waitFor();
  for (let i = 0; i < 20; i++) await page.getByRole('button', { name: 'Step Forward' }).click();
  if ((await snap()) !== first) throw new Error('同じシードで同じ結果になりません');
  step('同じシード・同じ操作で、同じ市場とエージェントの状態を再現した');
  await page.getByRole('button', { name: /^(Start|Resume)$/ }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Pause' }).click();
  const t1 = await page.getByText(/^t = \d+ \/ \d+$/).innerText();
  await page.waitForTimeout(600);
  const t2 = await page.getByText(/^t = \d+ \/ \d+$/).innerText();
  if (t1 !== t2) throw new Error('一時停止後も進んでいます');
  await page.getByText('直前の約定価格').first().waitFor();
  await page.screenshot({ path: path.join(outDir, 'demo-market.png'), fullPage: true });
  step(`Start / Pause で市場が動き・止まる（${t1}）。注文板・約定履歴・AI の注文を表示した`);

  // トレース
  await page.goto(`${base}/demo/research/trace`);
  await page.getByText('動作サイクル').first().waitFor();
  await page.getByText('アプリが生成した説明（LLM の出力ではない）').waitFor();
  await page.getByText('B. Real LLM Agent').waitFor();
  step('Agent Trace: 動作サイクルの各項目・アプリ生成の説明・実 LLM モードの無効表示');

  // Step 4: Dual Grading
  await page.goto(`${base}/demo/research/grading`);
  await page.getByText('Build Axis（取引ログ）').waitFor();
  await page.getByText('Judge Axis（説明・文書）').waitFor();
  step('Dual Grading: Build と Judge を分けて表示した');

  // 2×2 実験
  await page.goto(`${base}/demo/research/experiment`);
  await page.getByLabel('エピソード数').fill('12');
  await page.getByRole('button', { name: 'Run Experiment' }).click();
  await page.getByText('completed').waitFor({ timeout: 120_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const csv = readFileSync(await dl.path(), 'utf8');
  if (!csv.includes('deterministic_simulation_output') || csv.split('\n').length !== 1 + 12 * 5) throw new Error('CSV の内容が想定と異なります');
  step('2×2＋規則なしの実験（12 エピソード × 5 条件）を実行し、CSV をエクスポートした');

  // 分析
  await page.goto(`${base}/demo/research/analysis`);
  await page.getByText('4条件の比較と因果効果').waitFor();
  await page.getByTestId('effects').getByText('文言の主効果（B − A）').waitFor();
  await page.getByText(/エピソードと少ないため|独立な単位はエピソード/).first().waitFor();
  await page.getByRole('tab', { name: '誤拒否率' }).click();
  await page.screenshot({ path: path.join(outDir, 'demo-analysis.png'), fullPage: true });
  step('Causal Analysis: 条件別の指標・主効果・交互作用・区間・警告を表示した');

  // 修正案
  await page.goto(`${base}/demo/research/patch`);
  await page.getByRole('button', { name: 'Generate Patch Candidate' }).click();
  const card = page.locator('section', { hasText: '限定語「新規に」を削除する' });
  await card.getByRole('button', { name: 'Review Candidate' }).click();
  await card.getByRole('button', { name: 'Apply to Sandbox' }).click();
  await card.getByRole('button', { name: 'Rerun & Compare' }).click();
  await card.getByTestId('verify-remove-qualifier').waitFor({ timeout: 60_000 });
  // 副作用（誤拒否率・正常取引の成功率）の行が測定されていること（統計的に確定するかはエピソード数による）
  await card.getByTestId('verify-remove-qualifier').getByText('誤拒否率').waitFor();
  await card.getByText(/逸脱候補率は低下|改善は確認できない/).waitFor();
  await page.screenshot({ path: path.join(outDir, 'demo-patch.png'), fullPage: true });
  step('修正案をレビュー → サンドボックスに適用 → 同じシードで再実験し、改善と副作用（誤拒否）を両方表示した');

  // レポート
  await page.goto(`${base}/demo/research/report`);
  await page.getByText('13. Reproducibility Information').waitFor();
  const [dj] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  const report = JSON.parse(readFileSync(await dj.path(), 'utf8'));
  if (report.kind !== 'deterministic_simulation_output' || !report.patchVerifications.length) throw new Error('レポートの内容が想定と異なります');
  step('研究レポート（13 項目）を表示し、JSON をエクスポートした');

  // ページ間・リロードで状態を維持
  await page.reload();
  await page.getByText(/実験 v\d+（completed/).waitFor();
  step('リロード後も状態（実験の結果・修正の検証）を維持した');

  // スマートフォンの表示
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mp = await mobile.newPage();
  mp.on('pageerror', (e) => errors.push(e.message));
  await mp.goto(`${base}/demo/research/rules`);
  await mp.getByRole('button', { name: 'メニュー' }).click();
  await mp.getByRole('link', { name: /Market Simulator/ }).click();
  await mp.waitForURL(/\/market$/);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  await mp.screenshot({ path: path.join(outDir, 'demo-mobile.png'), fullPage: true });
  if (overflow) throw new Error('スマートフォンの幅で横にはみ出しています');
  step('スマートフォンの幅で、メニューから画面を切り替えられ、横にはみ出さない');
  await mobile.close();

  if (external.length) throw new Error(`外部への通信がありました: ${external.join(', ')}`);
  if (errors.length) throw new Error(`ページでエラーが発生しました: ${errors.join(' / ')}`);
  step('外部への通信なし・ページのエラーなし');
  console.log('すべての手順が完了しました');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
