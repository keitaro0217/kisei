// ブラウザでの Trace → Detect → Explain → Patch → Verify → Report の一連の確認（Playwright）。
// 合成規則・仮想金融市場・モックエージェントで、主要な画面の操作が最後まで完了することを確かめる。
//
//   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=... node e2e/risk-flow.mjs
// ローカルで起動したサーバーに対してのみ実行する（本番には実行しない）。
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
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
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
// 画面と同じログイン状態（Cookie）で API を呼ぶ
const api = async (p, body, method = 'POST') => {
  const r = await page.evaluate(
    async ({ url, body, method }) => {
      const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
      return { ok: res.ok, status: res.status, text: await res.text() };
    },
    { url: `/api/research${p}`, body, method },
  );
  if (!r.ok) throw new Error(`${method} ${p}: ${r.status} ${r.text}`);
  return JSON.parse(r.text);
};
const waitFor = async (fn, ms = 120_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await page.waitForTimeout(1000);
  }
  throw new Error('待機がタイムアウトしました');
};

try {
  // ログイン
  await page.goto(`${base}/research`);
  await page.getByLabel('パスワード').fill(password);
  await page.getByRole('button', { name: 'ログイン' }).click();
  await page.waitForURL(/\/research$/);

  // 1. 仮想環境でエージェントを実行（条文A/B のミニマルペア → 2×2 計画）
  await page.goto(`${base}/research/rules`);
  await page.getByRole('button', { name: 'この雛形で条文A/Bを作成' }).first().click();
  await page.waitForURL(/\/research\/rules\/pairs\//);
  await page.getByRole('link', { name: 'このペアで研究を作成' }).click();
  await page.waitForURL(/\/research\/studies\/new/);
  await page.getByRole('button', { name: '2×2（文言A/B × 趣旨なし/あり）にする' }).click();
  await page.getByLabel('反復数（条件ごと）').fill('8');
  await page.getByLabel('ステップ数').fill('15');
  await page.getByRole('button', { name: '下書きとして保存' }).click();
  await page.waitForURL(/\/research\/studies\/[0-9a-f-]{36}$/);
  const studyId = page.url().split('/').pop();
  await page.getByRole('button', { name: '設定を凍結して開始' }).click();
  await page.getByText('完了', { exact: true }).first().waitFor({ timeout: 120_000 });
  await page.getByText('要因の効果（ロジスティック回帰）').waitFor();
  await page.getByText('文言（版） × 趣旨の提示（交互作用）', { exact: false }).first().waitFor();
  step('2×2 計画の研究を実行し、ロジスティック回帰（交互作用を含む）を表示した');
  await shot('1-study');

  // 2. Trace に記録
  await page.locator(`a[href="/research/traces?study=${studyId}"]`).click();
  await page.waitForURL(/\/research\/traces\?study=/);
  await page.locator('table a[href^="/research/traces/"]').first().click();
  await page.waitForURL(/\/research\/traces\/[0-9a-f]{32}$/);
  await page.getByText('Span のツリーと時系列').waitFor();
  await page.getByRole('button', { name: /^step 1/ }).first().click();
  step('トレースのツリー・Span の詳細を表示した');
  await shot('2-trace');

  // 3. 多層評価（モック Judge）と人による評価
  await page.goto(`${base}/research/studies/${studyId}/evaluation`);
  await page.getByLabel('評価する判断の数').fill('40');
  await page.getByRole('button', { name: '評価を開始' }).click();
  await page.getByText('40 / 40').waitFor({ timeout: 60_000 });
  await page.getByText('Layer 5: 評価器の信頼性').waitFor();
  await page.goto(`${base}/research/studies/${studyId}/review`);
  await page.getByLabel('評価者の名前').fill('研究者E2E');
  await page.getByLabel('趣旨逸脱の疑い').check();
  await page.getByRole('button', { name: '保存して次へ' }).click();
  await page.getByText('保存しました').waitFor();
  step('Judge による評価と人による評価を保存した');

  // 4. 逸脱を検出し、根拠を表示（Failure Library）
  await page.goto(`${base}/research/failures`);
  await page.getByLabel('研究').selectOption(studyId);
  await page.getByRole('button', { name: '検出して登録' }).click();
  await page.getByText(/逸脱の疑いを検出し/).waitFor();
  await page.locator('table a[href^="/research/failures/"]').first().click();
  await page.waitForURL(/\/research\/failures\/[0-9a-f]{16}$/);
  const fingerprint = page.url().split('/').pop();
  step('Failure を検出・分類し、クラスターの詳細を表示した');

  // 5. 原因の候補 → 6. 統制実験
  await page.getByRole('button', { name: '原因の候補を生成' }).click();
  await page.getByText(/件の候補を作成しました/).waitFor();
  // 自動で介入（統制実験）を作れる候補を選ぶ
  await page.locator('tr', { hasText: /替える|提示する|に変える/ }).locator('a[href^="/research/hypotheses/"]').first().click();
  await page.waitForURL(/\/research\/hypotheses\//);
  await page.getByText('証拠グラフ', { exact: true }).waitFor();
  await page.getByLabel('反復数').fill('6');
  await page.getByRole('button', { name: '検証実験を作成して開始' }).click();
  await page.getByRole('button', { name: '結果から評価する' }).waitFor({ timeout: 120_000 });
  await page.getByRole('button', { name: '結果から評価する' }).click();
  await page.getByText(/Failure 率: 処置/).waitFor();
  step('原因の候補を統制実験で検証し、効果の推定と状態を表示した');
  await shot('3-hypothesis');

  // 7. 修正候補を生成 → 承認 → 8. 同じシナリオで再検証
  await page.goto(`${base}/research/failures/${fingerprint}`);
  await page.getByRole('button', { name: 'テストケースの候補を作成' }).click();
  await page.getByText(/件の候補を作成しました/).waitFor();
  await page.getByRole('button', { name: '修正案を作成' }).click();
  await page.getByText(/件の修正案を作成しました/).waitFor();
  // テストケースを承認（期待する趣旨の判定は人が選ぶ）
  await api('/test-cases/normal', { studyId, count: 10 });
  const { testCases } = await api('/test-cases', null, 'GET');
  await page.goto(`${base}/research/test-cases`);
  for (const t of testCases) {
    await api(`/test-cases/${t.id}`, { status: 'approved', expectedIntent: t.dataset === 'normal_behavior' ? 'aligned' : 'deviation_suspected' }, 'PATCH');
  }
  await page.reload();
  await page.locator('td', { hasText: '承認済み' }).first().waitFor();
  step(`テストケース ${testCases.length} 件を承認した`);

  await page.goto(`${base}/research/patches`);
  await page.locator('table a[href^="/research/patches/"]').first().click();
  await page.waitForURL(/\/research\/patches\//);
  await page.getByText('この修正案は仮想環境の検証にだけ使います').waitFor();
  await page.getByRole('button', { name: 'レビューに回す' }).click();
  await page.getByRole('button', { name: '実験への使用を承認' }).click();
  await page.getByRole('button', { name: '回帰テストを実行' }).waitFor();
  await page.getByLabel('最小件数').fill('1');
  await page.getByRole('button', { name: '回帰テストを実行' }).click();
  await page.getByText('既知の Failure を防げた割合').waitFor();
  await page.getByLabel('反復数').fill('4');
  await page.getByRole('button', { name: '再実験を作成して開始' }).click();
  await page.getByRole('link', { name: '再実験の研究を開く' }).waitFor();
  const patchUrl = page.url();
  const patchId = patchUrl.split('/').pop();
  await waitFor(async () => (await api(`/patches/${patchId}`, null, 'GET')).experiment?.status === 'completed');
  await page.getByRole('button', { name: '回帰テストを実行' }).click();
  // 9. 逸脱の改善と副作用の比較
  await page.getByText('再実験（同じ市場・シード）').waitFor({ timeout: 30_000 });
  step('修正案を承認・回帰テスト・再実験し、改善と副作用を比較した');
  await shot('4-patch');

  // 10. 回帰テスト・監査レポート（PoC）へ保存
  await page.goto(`${base}/research/poc`);
  await page.getByLabel('名称').fill('E2E PoC');
  await page.getByRole('button', { name: '作成' }).click();
  await page.waitForURL(/\/research\/poc\/[0-9a-f-]{36}$/);
  await page.getByLabel('研究を追加').selectOption(studyId);
  await page.getByRole('button', { name: '追加', exact: true }).first().click();
  await page.getByText('専門家が確認した発見').first().waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Markdown' }).click()]);
  const file = path.join(outDir, download.suggestedFilename());
  await download.saveAs(file);
  const md = readFileSync(file, 'utf8');
  if (!md.includes('PoC 評価レポート') || !md.includes('モックデータ')) throw new Error('PoC レポートの内容が想定と異なります');
  step('PoC レポートを出力した（モックデータと明示）');

  // 監視（試験版）: サンプルを送信
  await page.goto(`${base}/research/monitoring`);
  await page.getByLabel('名前').fill('E2E 接続元');
  await page.locator('select[multiple] option').first().click();
  await page.getByRole('button', { name: '作成してトークンを発行' }).click();
  await page.getByText(/トークンは今だけ表示されます/).waitFor();
  await page.getByRole('button', { name: 'サンプルを送信' }).first().click();
  await page.getByRole('button', { name: 'イベント', exact: true }).first().click();
  await page.getByText('サンプル', { exact: true }).first().waitFor();
  step('監視の接続元を作成し、サンプルイベントの一次判定を表示した');
  await shot('5-monitoring');

  if (errors.length) throw new Error(`ページでエラーが発生しました: ${errors.join(' / ')}`);
  console.log('すべての手順が完了しました');
} catch (e) {
  await shot('failure').catch(() => undefined);
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
