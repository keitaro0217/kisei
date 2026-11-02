// ブラウザでのログインと API 連携の画面の確認（Playwright）。ローカルのサーバーに対してのみ実行する。
//   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=... node e2e/login-api.mjs
// 外部の AI サービスには実際のキーを送らない（無効なダミーのキーで、エラーの表示と保存・削除の流れを確認する）。
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
  // スマートフォンの画面サイズ
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const m = await mobile.newPage();
  m.on('pageerror', (e) => errors.push(e.message));
  await m.goto(`${base}/research/settings/api`);
  await m.waitForURL(/\/login\?next=%2Fresearch%2Fsettings%2Fapi/);
  await m.getByText('kisei', { exact: true }).waitFor();
  await m.getByText('Regulatory AI Research Console').waitFor();
  await m.getByText('パスワードを入力してください', { exact: true }).waitFor();
  step('未ログインで開くとログイン画面になる（元の URL を保持）');

  // 誤ったパスワード → エラー。表示切り替え。Enter キーでログイン
  await m.getByPlaceholder('パスワード').fill('wrong-password');
  await m.keyboard.press('Enter');
  await m.getByText('パスワードが正しくありません。もう一度入力してください。').waitFor();
  await m.getByRole('button', { name: '表示' }).click();
  if ((await m.getByPlaceholder('パスワード').getAttribute('type')) !== 'text') throw new Error('パスワードの表示切り替えが動きません');
  await m.screenshot({ path: path.join(outDir, 'login-mobile.png') });
  await m.getByPlaceholder('パスワード').fill(password);
  await m.keyboard.press('Enter');
  await m.waitForURL(/\/research\/settings\/api$/);
  step('誤ったパスワードはエラー、正しいパスワードを Enter で送ると元の画面へ戻る');

  // セッション Cookie（有効期限なし・HttpOnly）
  const cookies = await mobile.cookies();
  const session = cookies.find((c) => c.name.endsWith('kisei_session'));
  if (!session || session.expires !== -1 || !session.httpOnly || session.sameSite !== 'Lax') throw new Error(`Cookie の属性が想定と異なります: ${JSON.stringify(session)}`);
  step(`セッション Cookie は有効期限なし（ブラウザを閉じると消える）・HttpOnly・SameSite=Lax（${session.name}）`);

  // ページを更新してもログインしたまま
  await m.reload();
  await m.getByRole('heading', { name: 'API連携' }).waitFor();
  step('ページを更新してもログイン状態が続く');
  await m.screenshot({ path: path.join(outDir, 'api-mobile.png'), fullPage: true });

  // API 連携: ダミーのキーを保存して接続テスト（外部に到達できない／認証エラーのどちらかで失敗が表示される）
  const card = m.locator('section', { has: m.getByRole('heading', { name: 'OpenAI', exact: true }) });
  await card.getByPlaceholder('sk-...').fill('sk-e2e-dummy-key-not-real-0000');
  await card.getByRole('button', { name: '保存して接続テスト' }).click();
  const t0 = Date.now();
  await card.getByText(/APIキーは暗号化して保存しましたが、接続テストに失敗しました/).waitFor({ timeout: 120_000 });
  console.log(`  （接続テストの結果まで ${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
  await card.getByText('sk-••••••••0000').waitFor();
  const html = await m.content();
  if (html.includes('sk-e2e-dummy-key-not-real-0000')) throw new Error('APIキーの全文が画面に残っています');
  await card.getByText('接続エラー').waitFor();
  step('キーを保存すると全文は表示されず（マスク表示）、接続テストの失敗が表示される（接続済みにはならない）');
  m.once('dialog', (d) => d.accept());
  await card.getByRole('button', { name: 'APIキーを削除' }).click();
  await card.getByText('APIキーを削除しました。').waitFor();
  await card.getByText('未登録').waitFor();
  step('キーを削除できる');
  await card.getByText('APIキーの取得方法').click();
  const href = await card.getByRole('link', { name: 'APIキーを発行する（公式ページ）' }).getAttribute('href');
  if (href !== 'https://platform.openai.com/api-keys') throw new Error(`取得方法のリンクが想定と異なります: ${href}`);
  step('APIキーの取得方法と公式ページへのリンクを表示する');

  // 研究の作成: 使えるモデルがなければ AI モデルは選べない
  await m.goto(`${base}/research/studies/new`);
  await m.getByText('使えるモデルがありません。').waitFor();
  step('使えるモデルがないとき、研究の作成画面で AI モデルを選べない（API 連携へ案内）');

  // ログアウト → 保護された画面・API は使えない
  await m.getByRole('button', { name: 'ログアウト' }).first().click();
  await m.waitForURL(/\/login\?reason=logout/);
  await m.getByText('ログアウトしました。').waitFor();
  await m.goto(`${base}/research/settings/api`);
  await m.waitForURL(/\/login\?next=/);
  const res = await m.evaluate(async () => (await fetch('/api/research/api-settings')).status);
  if (res !== 401) throw new Error(`ログアウト後の API の応答が ${res} でした`);
  step('ログアウト後は保護された画面・API を使えない（API は 401）');
  await mobile.close();

  // ブラウザを閉じたあと（新しいブラウザのセッション）はログインが必要
  const fresh = await browser.newContext();
  const f = await fresh.newPage();
  await f.goto(`${base}/research`);
  await f.waitForURL(/\/login/);
  step('新しいブラウザのセッションではパスワードが必要');
  await fresh.close();

  // 以前の Basic 認証の資格情報をブラウザが記憶していても、ログアウトするとログイン画面になる
  const cached = await browser.newContext({ httpCredentials: { username: 'x', password } });
  const c = await cached.newPage();
  await c.goto(`${base}/research`);
  await c.waitForURL(/\/login/);
  await c.getByPlaceholder('パスワード').fill(password);
  await c.keyboard.press('Enter');
  await c.waitForURL(/\/research$/);
  await c.getByRole('button', { name: 'ログアウト' }).first().click();
  await c.waitForURL(/\/login\?reason=logout/);
  await c.getByText('ログアウトしました。').waitFor();
  await c.reload();
  await c.getByPlaceholder('パスワード').waitFor();
  step('ブラウザが Basic 認証の資格情報を記憶していても、ログアウト後はログイン画面になる');
  await cached.close();

  if (errors.length) throw new Error(`ページでエラーが発生しました: ${errors.join(' / ')}`);
  console.log('すべての手順が完了しました');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
