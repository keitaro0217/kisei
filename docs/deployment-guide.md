# 本番環境への適用手順

1. **ローカルでの確認**（実施済み）
   ```bash
   npx tsc --noEmit && npx eslint app components lib proxy.ts e2e
   npx vitest run
   TEST_DATABASE_URL=postgresql://... npx vitest run   # 実 PostgreSQL（本番 DB は使わない）
   npx next build
   BASIC_AUTH_PASSWORD=... RESEARCH_DATA_DIR=/tmp/e2e npx next start -p 3100
   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=... node e2e/study-flow.mjs
   E2E_BASE_URL=http://127.0.0.1:3100 E2E_PASSWORD=... node e2e/risk-flow.mjs
   ```
2. **プルリクエスト**: ブランチ `feature/kisei-risk-intelligence` を push し、Vercel のプレビューのビルドが成功することを確認する。
3. **マージ（承認後）**: main にマージすると Vercel が本番を作り直す。
4. **初回アクセス**: 新しいテーブルが自動で追加される（`rc_schema_migrations` に記録）。既存のデータは変更しない。
5. **確認**: ログイン → 規則・条文 → 雛形 → 研究（モック）→ 実行トレース → 多層評価 → Failure Library → Auto-Patch の順に操作できることを確認する。

## 環境変数

追加はありません（`BASIC_AUTH_PASSWORD`・`DATABASE_URL`・`API_KEY_ENCRYPTION_KEY`・`CRON_SECRET` のまま）。

## 注意

- AI モデルでの研究・LLM Judge・検証実験・再実験は API の費用が発生します（開始時に確認ダイアログを表示）。費用管理で予算の上限を設定してください。
- `CRON_SECRET` が未設定の場合、長い処理の引き継ぎは画面を開いている間と1日1回の Cron に限られます。
- 監視（試験版）は外部企業の本番データには使わないでください。
- 問題があった場合は、Vercel で直前のデプロイに戻せます（追加したテーブルは残りますが、以前のコードからは参照されません）。
