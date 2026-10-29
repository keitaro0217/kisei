# テスト結果と実装状況（Step 10）

実行日: 2026-10-29（ブランチ `feature/kisei-risk-intelligence`、ローカル環境）。外部の LLM API は使っていません（モックの LLM サーバーとモックエージェントのみ）。本番のデータベースは使っていません。

## 実行結果

| 確認 | 結果 |
|---|---|
| 型チェック（`tsc --noEmit`） | 成功 |
| ESLint | 成功（警告なし） |
| Vitest（組み込み Postgres / PGlite） | 74 件成功・4 件スキップ（実 API のテスト 3 件と、実 PostgreSQL 専用の 1 件） |
| Vitest（実 PostgreSQL 16、テスト用に作成したデータベース） | 75 件成功・3 件スキップ（実 API のテスト） |
| 本番ビルド（`next build`） | 成功 |
| ブラウザ E2E `e2e/study-flow.mjs` | 成功（ログイン → 条文A/B → 研究 → 統計 → 4要素のログ → 出力 → ログアウト） |
| ブラウザ E2E `e2e/risk-flow.mjs` | 成功（下記の 10 手順） |

`e2e/risk-flow.mjs` で確認した一連の流れ（合成規則・仮想金融市場・モックエージェント）:

1. 仮想環境でエージェントを実行（2×2 計画、ロジスティック回帰の交互作用を表示）
2. 行動と規則の提示をトレースに記録（ツリー・Span の詳細）
3. 逸脱の疑いを検出（モック Judge による評価・人による評価）
4. 逸脱の根拠を表示（Failure のクラスターの詳細）
5. 原因の候補を抽出
6. 条件操作による統制実験（効果の推定と状態の更新）
7. 修正候補の生成（テストケースの作成と承認）
8. 同じシナリオで再検証（回帰テスト・再実験）
9. 改善と副作用の比較
10. PoC レポートの出力、監視（サンプル送信と一次判定）

## テストの内訳（主なもの）

| ファイル | 内容 |
|---|---|
| `trace.test.ts` | 親子関係・時系列・ID の一意性・Span の構成・検索条件・本文の伏せ字とメタデータのみ・OTLP 変換・失敗時のエラー Span・保存期間・マイグレーション履歴 |
| `evaluation.test.ts` | Judge の JSON 不正・項目不正・存在しない証拠 ID・区切りタグの除去・最終表示の全分岐・κ / Precision / Recall / F1 の既知値・閾値付近の度合い・標本の再現性・人の評価（必須項目・修正理由・履歴）・一致率・LLM Judge の失敗と一時停止 |
| `comparison.test.ts` | 逆行列・模擬データからの係数の回復・完全分離の検出・2×2 ＋統制群の回帰・マニフェスト |
| `failure.test.ts` | 検出・重複排除・分類・テストケース化（上限・重複なし）・承認の必須項目・正常ケース・仮説の生成と重複防止・統制実験・状態遷移（トレースだけでは効果を支持しない）・判断保留・証拠グラフ |
| `patch.test.ts` | ゲート（件数不足・区間・要確認・FAIL）・パレート・修正案の生成と重複防止・承認の流れ・実験用の規則の分離（元の規則は不変）・回帰テストの決定論的な結果・再実験 |
| `business.test.ts` | PoC（未確認は数えない・推定の明示・見逃し・網羅率・レポートの項目）、監視（トークン・入力の検証・冪等・一次判定・警告の重複防止・上限・サンプル・監査レポート・テナントの分離・取り込み API の 401/202/400） |
| 既存（`security`・`guards`・`db`・`research`・`worker`・`adapters`・`study`） | 認証・CSRF・総当たり対策・API 連携・実験ワーカー・研究の流れ（既存機能の回帰） |

## 実装状況

### Phase 1: Research & Observability Foundation

| 機能 | 状態 |
|---|---|
| AI Execution Tracing（記録・検索・閲覧・OTLP 出力・本文の記録設定・保存期間） | COMPLETE |
| 文書検索・ツール呼び出しの Span | NOT IMPLEMENTED（RAG・ツールが未実装） |
| Multi-Layer Evaluation（5 層・最終表示） | COMPLETE |
| LLM Judge（版管理・スキーマ検証・証拠 ID・複数 Judge の比較） | COMPLETE |
| Human Review・ゴールドデータ・評価者間一致 | COMPLETE（評価者は名前で区別） |
| Experiment Comparison（2×2・効果量・区間・ロジスティック回帰・交互作用・フォレストプロット） | COMPLETE |
| 再現性マニフェスト | COMPLETE |
| 研究どうしの比較 | PARTIAL（記述的な比較のみ） |

### Phase 2: Failure Intelligence

| 機能 | 状態 |
|---|---|
| Failure-to-Test（検出・重複排除・分類・テストケース化・人の承認） | COMPLETE |
| 埋め込みによる分類・時系列パターン | NOT IMPLEMENTED |
| Root Cause（候補・統制実験・効果・状態遷移） | COMPLETE |
| 反実仮想シナリオ・文書アブレーション | PARTIAL（要因を1つ変えた統制実験のみ。文書アブレーションは RAG が未実装のため不可） |
| Evidence Graph | COMPLETE |

### Phase 3: Auto-Patch & Regression

| 機能 | 状態 |
|---|---|
| 修正候補（テンプレート）・差分・承認の流れ・本番への非適用 | COMPLETE |
| LLM による修正案の生成 | NOT IMPLEMENTED |
| Regression Testing・ゲート・副作用・パレート | COMPLETE |
| 変更を検知した自動の再テスト | NOT IMPLEMENTED（手動と CI のみ） |
| PoC の価値測定・レポート | COMPLETE（PDF はブラウザの印刷で保存＝PARTIAL） |

### Phase 4: Enterprise Monitoring

| 機能 | 状態 |
|---|---|
| 外部イベントの取り込み（認証・検証・冪等・上限） | PARTIAL（試験版。REST のみ。Webhook・SDK・OTLP の取り込みは未実装） |
| サンプリング率の設定・Judge への抽出 | PARTIAL（抽出の記録のみ。評価の実行は未実装） |
| 異常イベントの検出・警告 | COMPLETE（規則違反率・既知の Failure との類似） |
| 企業データの分離 | PARTIAL（監視のテーブルはテナントで分離。他の機能は単一テナント） |
| 監査レポート | COMPLETE（監視・研究・PoC） |
| RBAC・個別ユーザー・セッション管理 | BLOCKED（共有パスワードの認証のみ。個別アカウントの基盤（ユーザー管理・パスワードのリセットなど）の設計と、運用者の判断が必要） |

### その他

| 項目 | 状態 |
|---|---|
| GitHub Actions（型・ESLint・テスト（PGlite / PostgreSQL）・ビルド） | COMPLETE（ワークフローを追加。初回の実行は push 後に確認が必要） |
| E2E の CI での実行 | NOT IMPLEMENTED（Playwright を依存関係に加えないため、ローカルで実行） |
| 英語表示（i18n） | NOT IMPLEMENTED |
| 注文板（LOB）・内生市場・複数エージェント | NOT IMPLEMENTED |
