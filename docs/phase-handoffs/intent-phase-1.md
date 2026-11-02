# Intent Phase 1 — Universal Rule & Intent Engine

ブランチ: `feature/intent-platform`（`feature/phase-2-research` の上）。実施日: 2026-11-02。

## 1. 実装したもの

### 共通ドメインモデル（`lib/domain/model.ts`）

- **定義した共通の型**
  - Organization / Industry / BusinessProcess / Environment（ドメインとシナリオ設定）
  - Actor / Agent / Objective / Rule / RuleVersion / PolicyIntent
  - 規則の要素（義務・禁止・許可・例外・閾値・承認条件・定義・目的の候補）
  - Action / Observation / State（アダプターの状態）/ Reward・Outcome / Evidence
- **ID と版**: 永続化するものは UUID と版を持ちます。
  - 規則文書: 版ごとに不変（DB のトリガーで更新・削除を拒否）
  - 規則・目的・業務プロセス: 新しい版を追加する方式
- **Constraint / Exception / Permission / Prohibition**
  - 規則文書の要素（`rc_rule_elements`）として原文の根拠を持ちます。
  - 判定に使う形は、規則 DSL の `checks` / `intentCriteria` です。

### ドメインアダプター（`lib/server/domain/`）

- **インターフェース**（`adapter.ts`）の10メソッド:
  - `initializeScenario` / `observe` / `listPermittedActions` / `validateAction` / `applyAction`
  - `calculateOutcome` / `evaluateFormalCompliance` / `evaluateIntentAlignment` / `getEvidence` / `reset`
  - ほかに、モックのエージェント・LLM の出力の解釈・出力形式。
- **Financial Market Adapter**（`financial.ts`）
  - 既存の取引所の関数をそのまま包むアダプターです。既存の研究は従来どおりの実行（`rc_decisions`）のままです。
  - 共通の実行ループで実行した場合も、既存の実行と同じ判定・違反コード・趣旨逸脱になることを `tests/domain.test.ts` で確認しました。
- **Trading Company Adapter**（`tradingCompany.ts`、商社の取引承認・請求業務、合成の業務モデル）
  - 購買依頼の到着、発注（承認の申請／なし）、承認の日数と予算による承認・却下、請求書の到着と金額の不一致（注入）、支払。
  - 業務の目標（早く処理する）と承認の規則が衝突しうる設計です。
  - モックのエージェントは3種類あります（AI の行動ではありません）:
    - diligent: 規則どおりに承認を申請する
    - gaming: 承認を避けるため分割して発注する
    - careless: 請求書を確認せず、承認を忘れる
- **規則 DSL の汎用化**: 変数のホワイトリストをドメインごとに切り替えます（`lib/domain/descriptors.ts`）。別のドメインの変数を使った規則は保存時に拒否します。
- **共通の実行ループ**（`runner.ts`）
  - 流れ: Observe → Retrieve Rules → Choose Action（モックまたは LLM）→ Execute → Outcome → Update State
  - 研究の仕組み（凍結・リース・再開・トレース・費用の上限）は既存のものを共有し、ステップの記録は `rc_domain_steps` に保存します（判断の記録と同じ保護）。
  - **行動の範囲の強制**: 業務プロセスで許されていない行動は、モデルの出力に関係なくコードで拒否します（`SYS_ACTION_NOT_PERMITTED`）。
- **集計**（`stats.ts`）
  - 形式違反率・趣旨逸脱率・正常処理の成功率・解釈不能率（Wilson、参考値）
  - 業務の指標（処理件数・リードタイム・支出・承認の申請数・過払い）
  - 主要比較: 反復単位の対応のあるブートストラップと並べ替え検定

### Rule & Intent Studio（`/research/studio`、`lib/server/domain/studio.ts`）

- **規則文書の登録**
  - 項目: 文書 ID・版・種別（合成 / 実在の法令 / 社内規程）・題名・出典・適用期間・SHA-256（本文と原本）
  - 形式: テキストと DOCX。DOCX は ZIP の本文 XML だけを `node:zlib` で読み、マクロ等は実行しません。新しい依存はありません。
  - 実在の法令には「法的な判断を行わない」と表示します。
- **要素の抽出（pattern-v1）**
  - 日本語の規則の文型から、義務・禁止・許可・例外・承認条件・定義・目的の候補・閾値（数値と単位）を抽出します。
  - 原文の位置（文字オフセット）を記録し、「未レビュー」で保存します。
  - 人が承認・却下・修正します（修正・却下は理由が必須で、修正前の内容を履歴に残します）。
- **規則の目的（PolicyIntent）**
  - 原文の要素を根拠とする候補は、人が承認するまで確定しません（`candidate`）。
  - 原文から確認できない場合は、人が入力します（入力者を記録）。
  - DB の CHECK 制約で、抽出した目的は根拠の要素を必ず持ちます。
- **雛形からの規則の作成**
  - 商社の承認の規則のミニマルペア（「1件の発注」と「同一の購買依頼の合計」）、請求書の照合。
  - 規則文書の要素と承認済みの目的に関連付けます。目的が未承認の規則は、その旨を返します。
- **業務プロセス**: AI の業務の目標・行動の範囲・適用する規則を版として保存します。
- **比較実験の作成**: 業務プロセス・規則の版（A / B）・モックの傾向から、同じシナリオ・同じシードの2条件の研究を作成して開始します。

## 2. DB の変更（`2026-11-05-001-universal-domain`、追加のみ）

| テーブル | 内容 |
|---|---|
| `rc_rule_documents` | 版・種別・形式・ハッシュ・適用期間の CHECK。更新・削除はトリガーで拒否 |
| `rc_rule_elements` | 種類・位置・抽出方法・レビューの状態の CHECK |
| `rc_policy_intents` | 根拠・状態の CHECK。抽出した目的は根拠の要素が必須 |
| `rc_business_processes` | 版 |
| `rc_domain_steps` | 追記のみ。完了したセッションの記録は削除不可 |

規則（`rc_rules.data`）には、任意項目の `domain` / `sourceDocumentId` / `sourceElementIds` を追加しました。以前の規則は金融市場として扱います。

## 3. API

| メソッド | パス |
|---|---|
| GET | `/api/research/studio`（評価環境・雛形・規則文書・業務プロセス・目的） |
| POST | `/api/research/studio/documents` |
| GET | `/api/research/studio/documents/[id]` |
| POST | `/api/research/studio/elements/[id]`（レビュー） |
| POST | `/api/research/studio/intents` |
| POST | `/api/research/studio/intents/[id]`（承認・却下） |
| POST | `/api/research/studio/processes` |
| POST | `/api/research/studio/rules`（雛形から規則） |
| POST | `/api/research/studies`（追加の入力: `domain`・`environment`・`businessProcess`・条件の `agentPersona`） |
| GET | `/api/research/studies/[id]`（金融以外は `domainStats` を返す） |

## 4. 受入条件

| 条件 | 結果 |
|---|---|
| 金融の既存実験が動作する | 達成（既存のテスト・E2E がすべて成功。アダプターも既存と同じ判定） |
| 商社の業務モデルでも同じ実験エンジンを使用できる | 達成（研究の作成・凍結・実行・再開・トレース・集計。テスト・E2E） |
| 規則・目的・行動・結果を独立して保存できる | 達成。規則は `rc_rules`、目的は `rc_policy_intents`、行動と判定は `rc_domain_steps`、結果はセッションの `domainOutcome` |
| 規則の出典と適用時点を追跡できる | 達成（規則 → 文書・要素 → 出典・適用期間・版・ハッシュ） |

## 5. テスト（2026-11-02、ローカル）

| 種類 | 結果 |
|---|---|
| 型・ESLint・本番ビルド | 成功 |
| vitest（組み込み Postgres） | 114件成功・5件スキップ |
| vitest（PostgreSQL 16） | 115件成功・4件スキップ |
| E2E | `login-api`・`study-flow`・`risk-flow`・`phase2-flow`・`studio-flow` すべて成功 |

追加したテスト:

- `tests/domain.test.ts`
  - 金融アダプターの互換
  - 商社のミニマルペア（4条件 × 4反復 × 25日）
  - 行動の範囲の強制
  - 別のドメインの規則の拒否
  - 記録の保護
- `tests/studio.test.ts`
  - 抽出と位置、DOCX、版、文書の不変性
  - 目的の承認、雛形からの規則、業務プロセス
- `e2e/studio-flow.mjs`

### モックでの観察（研究結果ではない）

商社のミニマルペアで、同じ「分割する」モックの担当者（同じシード）に対し、規則の文言だけを変えて比べました（E2E の一例。5反復 × 20日）。

| 規則 | 形式違反率 | 趣旨逸脱率 |
|---|---|---|
| 「1件の発注」 | 0.0% | 39.8% |
| 「同一の購買依頼の合計」 | 81.6% | — |

- 形式違反率の差は +81.6 pt（反復単位の 95% 区間 [74.9, 87.8]、並べ替え検定 p = 0.063。5反復の正確検定の下限）でした。
- モックの行動は規則を読まないため、この差は**判定基準の違いだけ**を示します。AI の行動の変化ではありません。

## 6. 未実装・Phase 2 以降への引き継ぎ

- PDF の読み取り（Enterprise Data Hub で対応）。
- 規則の要素から DSL の判定ロジックを作る支援（現在は雛形と、人が書く DSL）。
- 商社以外の業種のアダプター（製造・保険・物流・IT・医療・行政）。インターフェースに従って追加します。
- 金融以外のドメインでの、多層評価・Failure・原因仮説・修正案。これらは現在、金融の判断の記録（`rc_decisions`）を前提としています。`rc_domain_steps` への対応は Phase 3〜4 で行います。
- 実 LLM での実行。実装はしましたが、費用の承認がないため未実行です。
- 研究の作成画面（`/research/studies/new`）は金融のみ対応しています。金融以外は Studio から作成します。

## 7. Phase 2（Enterprise Evidence & EUC Intelligence）で使う契約

| 契約 | 内容 |
|---|---|
| `RuleDocument` / `RuleElement` / `PolicyIntent` | 出典と根拠の位置。ファイル台帳から規則への関連付けに使う |
| `BusinessProcess` | ファイル・業務記録から業務プロセスへの関連付けに使う |
| `DomainStepRecord` / `EvidenceRef` | 行動・結果・根拠。Evidence Graph のノード |
| `DomainAdapter` | 業種の追加 |
