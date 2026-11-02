# Research Phase 2 の引き継ぎ（Phase 3: Auto-Patch・Verify へ）

ブランチ: `feature/phase-2-research`（`feature/production-foundation` の上）。

## 実装したもの

- 評価の6分類と2つの評価軸。評価器ごとの判定を独立に表す統一モデル `EvaluationRecord`。
- 複合評価 `composite-v1`（集約ロジックの版つき、多数決なし）。
- 人のレビュー（承認・修正・却下、追記のみの履歴）。
- Judge v2（解釈の争い・証拠不足を区別。v1 の記録も読める）、評価の実行ごとの評価モデルの指定（独立評価）、証拠の順序の指定。
- 外部ラベルのデータセット（版・固定・用途）。指標は次のとおりです。
  - 混同行列、クラス別 P/R/F1、マクロ F1・重み付き F1、κ（区間）、FPR / FNR
  - 不確実性ごとの正解率、未測定の表示、警告
- バイアスの検証（自己評価・モデル・プロンプト・順序・曖昧さ・専門家間）。
- 逸脱の検出の拡張: 外れ値・評価の不一致・評価不能。確信度（重大度とは別）、評価器・評価の版、再現情報（シード・frozenHash・トレースの有無）も記録します。
- 原因仮説の拡張: 原因候補の分類、反証条件、必要な比較実験、検証結果（研究 ID と関連付け）。
- 例外規定のミニマルペアの雛形。
- Failure Library の絞り込み（規則・業界・分類・原因・モデル・重大度・修正状況・検証結果・キーワード）。
- トレースに、エージェント ID・プロンプトの版・アクセス権限・ツール（なし）・費用の根拠を追加しました。
- 画面:
  - 評価の統合 `/research/studies/[id]/evaluations`
  - 評価器の検証 `/research/evaluation/validation`
  - Failure Library の検索
  - 仮説の検証計画

## DB の変更（マイグレーション `2026-11-04-001-evaluation-validation`、追加のみ）

| テーブル | 内容 |
|---|---|
| `rc_evaluation_reviews` | 追記のみ。CHECK: 修正の場合は修正後のカテゴリが必須 |
| `rc_label_sets` | 名前・版・用途・固定 |
| `rc_labels` | 固定したセットの変更をトリガーで拒否 |

Failure・仮説・注釈の新しい項目は jsonb の任意項目のため、以前の記録はそのまま読めます。

## API

| メソッド | パス |
|---|---|
| GET | `/api/research/studies/[id]/evaluations?disagreements=1&limit=` |
| POST | `/api/research/studies/[id]/evaluations/review` |
| GET / POST | `/api/research/label-sets` |
| GET | `/api/research/label-sets/[id]` |
| POST | `/api/research/label-sets/[id]/labels`（JSON の配列、または CSV） |
| POST | `/api/research/label-sets/[id]/actions`（freeze / new_version） |
| GET | `/api/research/failures?q=&ruleKey=&industry=&category=&cause=&model=&severity=&fixStatus=&verification=` |
| POST | `/api/research/studies/[id]/evaluation/runs`（追加の入力: `providerId`・`model`・`evidenceOrder`） |

## Phase 3 で使うデータ構造（契約）

| 型 | 場所 | 用途 |
|---|---|---|
| `Failure`（`category`・`severity`・`confidence`・`evaluators`・`evaluationVersion`・`replay`・`fingerprint`） | `lib/research/failure-types.ts` | 修正案の対象。確信度が low のものは、修正の前に人の確認を求める |
| `Hypothesis`（`cause`・`falsification`・`requiredExperiment`・`verification`・`intervention`） | 同上 | 修正案の根拠。`verification.result === 'supported'` でも一般的な因果の立証ではない |
| `EvaluationRecord` / `CompositeEvaluation`（`aggregationVersion`） | `lib/research/evaluation-model.ts` | 修正前後の比較では、同じ集約の版で比べる |
| `ValidationMetrics` | 同上 | 修正の検証に使う評価器の精度。`not_measured` の評価器による改善は、精度が未検証であることを表示する |
| `LabelSet`（`purpose`） | 同上 | 回帰テストの正解。`evaluation_test` と `external_gold` を区別する |

## Phase 3 への注意

- 修正前後の比較には、同じ評価器の版・同じ集約の版・同じシードを使ってください（`frozenHash` で確認できます）。
- 規則を変える修正では判定基準も変わります。行動の変化と判定の変化を分けて表示してください（既存の注意を継続）。
- テスト用のデータ: `tests/phase2.test.ts` の合成のシナリオとラベル（用途 `evaluation_test`）。研究結果ではありません。

## 未解決

- 実 LLM での実験・評価・外部ラベルとの比較（承認待ち）。
- 評価者ごとのアカウント。
- ツール・RAG・アクセス制御を持つ評価環境（Intent Phase 1 の Domain Adapter で対応予定）。
