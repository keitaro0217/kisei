# Phase 1 の引き継ぎ（本番運用の基盤）

> この文書は Phase 2 の開始時に、Phase 1 で実装した内容（ブランチ `feature/production-foundation`、PR #15）から作成しました（Phase 1 の作業時には作成していませんでした）。

## 実装したもの

### DB（マイグレーション `2026-11-03-001-production-foundation`、追加のみ）

- 組織・プロジェクト・利用者・所属のテーブルを追加し、主要なテーブルに `project_id` を付けました（既定 `default`）。
- ジョブキュー `rc_jobs` を追加しました（リース・冪等キー・バックオフ・CHECK 制約）。
- 監査ログを、連番と SHA-256 のハッシュ連鎖で記録するようにしました。UPDATE / DELETE はトリガーで拒否します。
- 判断の記録は追記のみです。完了したセッションの記録は削除できません。
- 状態の CHECK 制約（NOT VALID）、大量データ向けの索引を追加しました。適用済みのマイグレーションは再実行しません。

### 運用

- ヘルスチェック `/api/health`
- 運用状況の画面
- 構造化ログ
- 処理の停止の検知
- 研究の複製、費用の見積もり、研究ごとの費用の上限
- 問題の全履歴（lineage）
- バックアップの検証スクリプト、負荷試験

詳細は `docs/production-readiness.md` を参照してください。

## Phase 2 で使った契約

- `rc_reject_change()`（追記のみのテーブル用のトリガー関数）
- `rc_projects` / `project_id`（ラベルセットで使用）
- `enqueueJob` / `registerJobHandler`
- `studyLiveness`
- 監査ログ `audit()`

## 未完了（Phase 1 時点）

- チームモード・企業モード（利用者ごとのログイン・権限）、組織間の分離のテスト
- オブジェクトストレージ、Sentry / OTel
- 実 LLM での実験
