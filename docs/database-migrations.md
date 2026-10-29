# データベースのマイグレーション

## 方針

- 既存のテーブルは変更・削除しない。追加は新しいテーブルのみ（追加型）。
- 起動時に冪等に適用する（`CREATE TABLE IF NOT EXISTS`）。複数のインスタンスが同時に起動しても advisory lock で直列化する。
- 適用履歴を `rc_schema_migrations`（id・説明・適用日時）に記録する。公開した ID の内容は変更せず、変更が必要な場合は新しい ID を追加する。
- PostgreSQL（Neon）と PGlite の両方で同じ SQL が動くことをテストで確認する（`TEST_DATABASE_URL` を指定すると実 PostgreSQL で実行）。

## 今回追加したテーブル（`2026-10-29-001-risk-intelligence`）

| テーブル | 内容 | 主な制約 |
|---|---|---|
| `rc_traces` | セッションごとのトレース（Span は jsonb） | PK(研究・条件・反復)、trace_id 一意、開始日時の索引 |
| `rc_eval_runs` / `rc_judgements` | Judge の評価の実行と判断ごとの評価 | PK(実行・条件・反復・ステップ) で重複なし |
| `rc_annotations` | 人の評価（評価者ごと、履歴は jsonb） | PK(判断・評価者) |
| `rc_failures` | Failure（判断ごとに1件） | 一意(研究・条件・反復・ステップ)、fingerprint の索引 |
| `rc_test_cases` | 回帰テストのケース | source_key 一意（同じ元から重複して作らない） |
| `rc_hypotheses` / `rc_patches` / `rc_regression_runs` | 原因の候補・修正案・回帰テスト | 外部キー（回帰テスト → 修正案） |
| `rc_poc` | PoC の記録 | |
| `rc_monitor_sources` / `rc_monitor_events` / `rc_monitor_alerts` | 監視（試験版） | tenant_id 列、token_hash 一意、一意(接続元・冪等キー) |

前回までに追加したテーブル（`rc_rules`・`rc_rule_pairs`・`rc_prompt_sets`・`rc_studies`・`rc_study_sessions`・`rc_decisions`）は変更していません。設定（`rc_config`）には `settings.observability`（トレースの記録モード・保存期間）を既定値つきで追加しました（保存済みの設定に既定値を補うだけで、既存の値は変わりません）。

## 容量

- トレースはセッション単位で1行にまとめ、本文は1件 4,000 文字・Span は 1 トレース 5,000 件までに制限しています。保存期間（既定 90 日）を過ぎたトレースはワーカーが削除します。
- 監視イベントは接続元ごとの保存期間（既定 30 日）で削除します。
- 大容量の本文をオブジェクトストレージへ分ける構成は未実装です（現状の上限で PostgreSQL に収まる想定）。

## 復元

追加したテーブルは既存のテーブルから参照されていないため、問題があった場合は新しいテーブルだけを削除すれば以前の状態に戻ります（研究・API 連携・費用のデータには影響しません）。本番のデータベースに対して自動で削除・変更を行う処理はありません。
