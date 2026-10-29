# アーキテクチャのベースライン（Step 0 時点）

調査対象: `main`（コミット `19c14c1`、PR #11 マージ後）。コードを優先して判断した。

## 構成

| 層 | 実装 |
|---|---|
| フロントエンド | Next.js 16（App Router）・React 19・Tailwind v4。`app/research/**`（クライアントコンポーネント中心）、共通部品 `components/research/ui.tsx` |
| 入口 | `proxy.ts`（HTTPS 強制・CSRF・総当たり対策・認証・本番の設定不備表示） |
| 認証 | `lib/server/auth`。ログイン画面 `/login` → 署名付きセッション Cookie（12時間）。スクリプト向けに Authorization ヘッダーも可。共有パスワード1つ（`BASIC_AUTH_PASSWORD`）、主体は固定の「研究チーム」 |
| API | `app/api/research/**`（`withAuth` で権限を再検証） |
| DB | `lib/server/db`。`DATABASE_URL` があれば postgres.js（Neon）、なければ PGlite。スキーマは起動時に `CREATE TABLE IF NOT EXISTS` を冪等に適用 |
| LLM | `lib/server/llm`（5 プロバイダーのアダプター、SSRF 対策、再試行、予算確認、使用量記録） |
| ワーカー | `lib/server/research/scheduler.ts`（`after()` → スライス実行 → `/api/research/worker` で引き継ぎ、Vercel Cron 1日1回） |

## 既存機能の状態

| 機能 | 状態 | 場所 |
|---|---|---|
| 研究実験（単一条件・最大100,000エピソード・並列・一時停止/再開/停止・リース） | 実装済み | `lib/server/research/experiments.ts`、`sim/episode.ts`、`sim/market.ts` |
| 実験スナップショット・バージョンハッシュ | 実装済み | `snapshot.ts` |
| LLM Judge（エピソード単位の 1〜5 点評価） | 実装済み（単純） | `sim/prompts.ts` の `JUDGE_SYSTEM` |
| API連携・暗号化・モデル割り当て・接続テスト | 実装済み | `research/providers.ts`、`settings.ts`、`crypto/secretBox.ts` |
| 費用・予算管理 | 実装済み | `research/usage.ts`、`pricing.ts` |
| 監査ログ | 実装済み | `audit.ts`（`rc_audit`） |
| 規則 DSL・決定論的判定エンジン | 実装済み | `lib/server/rules/dsl.ts`、`sim/exchange.ts` |
| 規則の版管理・条文ミニマルペア・プロンプト版管理 | 実装済み | `research/study/rules.ts` |
| 多条件の研究（凍結・SHA-256・セッション排他実行・同一シード） | 実装済み | `research/study/studies.ts` |
| 4要素の意思決定ログ（説明/行動/判定/監視） | 部分実装（監視AIは常に未実施） | `rc_decisions` |
| 統計（Wilson・反復ブートストラップ・並べ替え検定・Holm・χ²・Fisher） | 実装済み | `research/study/stats.ts` |
| エクスポート（Markdown/CSV/JSON） | 実装済み | `research/study/exports.ts` |
| 注文板（LOB）シミュレーター | **未実装**（外生価格＋単純約定のみ） | — |
| 実行トレース（Span） | **未実装**（判断単位のログはある） | — |
| 多層評価・人手評価・評価器の信頼性 | **未実装**（形式判定と趣旨逸脱の事前基準のみ） | — |
| ロジスティック回帰・交互作用 | **未実装** | — |
| Failure / Root Cause / Patch / Regression / PoC / Monitoring | **未実装** | — |
| 個別アカウント・RBAC・テナント分離 | **未実装**（共有パスワードのみ） | — |
| CI（GitHub Actions） | **未実装** | — |
| マイグレーション履歴 | **未実装**（冪等 DDL のみ） | — |

## 今回の方針（再利用と新規モジュール）

中核の実行単位は既存の **研究（Study）のセッション**（条件 × 反復）とし、旧来の単一条件「研究実験」は変更しない。

| 追加機能 | 再利用する既存部品 | 新規モジュール |
|---|---|---|
| Tracing | `runStudySession`（計測点を追加）、`security/redact` | `research/trace/*`、`rc_traces` |
| 多層評価 | 判定エンジンの結果、`invokeModel`（Judge）、`llm_judge` の割り当て | `research/eval/*`、`rc_eval_runs`・`rc_annotations` |
| 比較・因果 | `stats.ts`、研究の条件設計 | ロジスティック回帰（IRLS）、2×2 の雛形 |
| Failure | 意思決定ログ、規則 | `research/failure/*`、`rc_failures`・`rc_test_cases` |
| Root Cause | 研究の作成・実行（介入実験） | `rc_hypotheses` |
| Auto-Patch | 規則の版管理、差分表示 | `rc_patches` |
| Regression | 判定エンジン（記録した状態からの決定論的リプレイ） | `rc_regression_runs` |
| Business Impact | 上記の集計 | `rc_poc` |
| Monitoring | 規則 DSL（一次判定） | `rc_monitor_sources`・`rc_monitor_events`・`rc_monitor_alerts` |

DB 変更はすべて追加（新テーブル）のみで、既存テーブルは変更しない。適用履歴を `rc_schema_migrations` に記録する。

## 外部サービス

LangSmith などへの外部転送は実装しない（kisei 内部のトレースモデルを中核とし、OpenTelemetry 互換の JSON 出力で将来の連携に備える）。理由: 研究データ・規則と密に結び付ける必要があり、外部転送には明示的な同意と別の鍵管理が要るため。
