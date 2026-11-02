# Intent Phase 0 — 既存システムの回復とアーキテクチャの監査

実施日: 2026-11-02。対象: `keitaro0217/kisei`（ローカル `hounonukeana`）

## 1. リポジトリの状態

### Git

| 項目 | 状態 |
|---|---|
| main | `7b40fb7`（PR #13 まで） |
| マージ待ち: PR #14 `fix/logout-to-login` | ログアウト後のログイン画面の修正 |
| マージ待ち: PR #15 `feature/production-foundation` | 本番運用の基盤（Research Phase 1 に相当） |
| `feature/phase-2-research` | PR #15 の上の Research Phase 2。push 済み・PR 未作成 |
| 作業ブランチ | `feature/intent-platform`（`feature/phase-2-research` の上） |
| 未コミットの変更 | なし（Phase 0 の開始時点。Research Phase 2 の UI の未コミット分は、作業の再開時にコミット・push 済み） |

### 技術スタック・規模

- Next.js 16.2.9（App Router、`proxy.ts`）、React 19.2、TypeScript、Tailwind v4。
- DB は postgres.js（Neon）と PGlite（ローカル・テスト）。
- テストは Vitest と Playwright（E2E スクリプト）。
- 依存は最小限です（実行時: next・react・postgres・pglite のみ）。
- 規模: API Route 80本、画面 41枚、テストファイル 18、E2E 4本。

### DB マイグレーション

基本スキーマ（`SCHEMA_STATEMENTS`）に加えて、次の4件を適用しています。すべて追加のみです。

1. `2026-10-29-001-risk-intelligence`
2. `2026-11-02-001-auth-attempts`
3. `2026-11-03-001-production-foundation`
4. `2026-11-04-001-evaluation-validation`

### 認証・権限

- 個人研究モード（共有パスワード、ブラウザセッション Cookie、サーバー側の期限、試行制限）。
- `Permission` によって API ごとに検査します。共有アカウントは全権限を持ちます。

### その他

- **API キー**: AES-256-GCM で暗号化して保存し、画面にはマスク表示のみ。かんたん接続と接続テストがあります。
- **docs/phase-handoffs/**: `phase-1.md`（Research Phase 1 の作業時には作られておらず、後から作成）、`phase-2.md`。

## 2. Research Phase 2 の実装状態

| 機能 | 分類 | 根拠 |
|---|---|---|
| Experiment Engine（研究・凍結・リース・再開・費用の上限） | 完成 | テスト・負荷試験（10万判断） |
| Trace / Span | 完成 | テスト・E2E |
| Evaluation（6分類・2軸・複合評価） | 完成 | `tests/phase2.test.ts` |
| LLM Judge（v2・独立評価・順序） | 部分実装 | モックの Judge でのみ検証。実 LLM は未検証 |
| Human Review（追記のみ） | 完成 | テスト・E2E |
| 外部ラベル・指標・バイアスの検証 | 完成（合成データのみ） | 実データでは未検証 |
| Causal Experiments（ミニマルペア・2×2・仮説の検証） | 完成（モック） | 実 LLM での行動の変化は未検証 |
| Auto-Patch・Verification（回帰テスト・再実験） | 完成（モック） | `tests/patch.test.ts`・E2E |
| Monitor | 部分実装 | 試験版 |
| 金融市場シミュレーション（外生価格＋単純約定） | 完成 | 既存のテスト・E2E |
| 実 LLM での実験 | 未検証 | 費用の承認が必要 |
| ツール・RAG・アクセス制御のある環境 | 未実装 | 金融市場には存在しない |

## 3. 共通エンティティと既存 DB の対応

| 共通エンティティ | 既存の対応 | 方針（Intent Phase 1） |
|---|---|---|
| Organization | `rc_organizations` | 再利用 |
| Industry | 規則の `industry`（文字列） | ドメインアダプターの登録情報（`DomainDescriptor.industry`）として定義。DB には文字列で保存 |
| BusinessProcess | なし | `rc_business_processes`（新規、版つき） |
| Environment | 研究の `market` 設定（金融のみ） | 研究デザインの `domain` と `environment`（アダプターのシナリオ設定） |
| Actor / Agent | 研究の `AgentSpec` | 共通型 `Actor` / `AgentProfile`。研究の凍結設定に保存 |
| Objective | 条件の `objective`（金融の目標） | 共通型 `Objective`（アダプターが解釈） |
| Rule / RuleVersion | `rc_rules`（`rule_key` + `version`） | 再利用。出典・適用期間の参照は、規則文書の要素への参照として追加 |
| PolicyIntent | 規則の `purpose`（文字列、根拠なし） | `rc_policy_intents`（新規）。原文の根拠の位置、承認の状態。AI だけでは確定しない |
| Constraint / Exception / Permission / Prohibition | 規則定義の文字列（`prohibitedActions` など）と DSL | `rc_rule_elements`（新規）。原文から根拠つきで抽出し、レビューの状態を持たせる |
| Action / State / Observation / Reward / Outcome | 金融の判断の記録（`attempted`・`context`・`enforcement`・`pnl`） | 共通型。金融は既存の記録のまま（アダプターで共通型に変換）、他の業種は `rc_domain_steps`（新規） |
| Evidence | 判断の記録・トレース・Judge の証拠 ID | 共通型 `EvidenceRef`（文書の位置・トレースの Span・判断） |
| 規則の原文・出典 | なし | `rc_rule_documents`（新規）。版・種別（合成 / 実在の法令 / 社内規程）・出典・適用期間・SHA-256 |

すべての共通エンティティは、不変の ID（UUID）と版（整数）を持ちます。版を更新するときは新しい行として追加し、元の行は変更しません。

## 4. 互換性の方針

- 既存の金融市場の研究は、これまでどおり `rc_decisions` に記録します。既存の分析・評価・Failure・修正案はすべて変更しません。
- `FinancialMarketAdapter` は、既存の取引所の関数（`judgeAction` / `applyAction` / `settleRestingOrders`）を共通のインターフェースで包むアダプターです。既存の判定と一致することをテストで確かめます。
- 研究デザインに `domain` を追加します。未指定（以前の研究）は `financial_market` です。
- 他の業種（最初は商社）は、同じ研究・セッション・リース・凍結・トレースの仕組みで実行します。ステップの記録だけを `rc_domain_steps` に分けます。

## 5. 全体の進め方とこの作業の範囲

Intent Phase 0〜6 は大規模なため、各 Phase を実装・テスト・引き継ぎまで完了させてから次へ進みます。

| Phase | 内容 |
|---|---|
| Phase 1 | 共通ドメインモデル、ドメインアダプター（金融・商社）、規則文書と要素の抽出（テキスト・DOCX）、規則の目的の承認、Rule & Intent Studio、共通の実験の実行 |
| Phase 2 以降 | Enterprise Data Hub、エージェントのサンドボックス、修正、仮想企業、製品の統合。各 Phase の引き継ぎ文書に、その時点の状態を記録します |

承認が必要なもの（実行していません）:

- 実 LLM の実験
- 有料のクラウドサービス
- 本番 DB の変更（マイグレーションは追加のみで、デプロイ時に自動で適用）
- PR #14 / #15 のマージ
