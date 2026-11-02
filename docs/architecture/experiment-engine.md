# 実験エンジン

## 流れと参照整合性

| # | 処理 | 実装 |
|---|---|---|
| 1 | UI で実験条件を設定 | `/research/studies/new` |
| 2 | API で入力を検証 | `parseDesign`。範囲・重複・モデルの両方指定・費用の上限を検証 |
| 3 | DB に実験バージョンを保存 | 開始時に凍結設定と `frozenHash` を保存（`rc_studies`）。セッション（条件 × 反復 × シード）を作成（`rc_study_sessions`） |
| 4 | ワーカーが実行 | `runStudySlice`。PostgreSQL のリース（`FOR UPDATE SKIP LOCKED`）、Vercel の `after()` と Cron、Phase 1 のジョブキュー |
| 5 | トレースを保存 | `rc_traces`。Span の親子関係と順序、OpenTelemetry 形式の ID |
| 6〜7 | 評価器が判定を生成・保存 | 規則エンジン・事前基準（判断の記録）、Judge（`rc_judgements`）、人（`rc_annotations`） |
| 8 | UI でトレースと評価を表示 | `/research/traces`、`/research/studies/[id]/evaluations` |
| 9 | Human Review を保存 | `rc_evaluation_reviews`（追記のみ） |
| 10 | 原因仮説を生成 | `generateHypotheses`（`rc_hypotheses`） |
| 11 | 比較実験を作成 | `scheduleExperiment`。新しい研究として作成し、仮説の `experimentStudyId` に関連付け |
| 12 | 因果分析の結果を保存 | `evaluateHypothesis`。`effect` と `verification` |
| 13 | Failure Library へ関連付け | 指紋（`fingerprint`）で Failure・仮説・テストケース・修正案を関連付け |

### ID と参照整合性

| ID | 内容 |
|---|---|
| 研究 ID | `rc_studies.id` |
| Episode ID | `研究ID/条件ID/反復` |
| 判断 | Episode ID + `/ステップ` |
| Trace ID | 32桁の16進数、セッションごとに一意 |
| Finding ID | `rc_failures.id`。判断ごとに一意（UNIQUE） |
| Hypothesis ID | `rc_hypotheses.id` |

主な関連は外部キー（`ON DELETE CASCADE / RESTRICT`）で保証しています。

## 状態遷移

| 対象 | 遷移 |
|---|---|
| 研究 | draft → running ⇄ paused → completed / stopped |
| セッション | pending → running → completed / failed（running → pending はやり直し） |
| ジョブ | queued → running → succeeded / failed / cancelled |

- いずれも DB の CHECK 制約で、定義にない状態を拒否します。
- 画面の状態と実際の処理の一致は、セッションのリースと最終更新から判定します（処理中 / 待ち / 停止）。

## 実験設定の対応

| 要求 | 実装 |
|---|---|
| 研究プロジェクト | 研究（`project_id` は既定のプロジェクト） |
| 規則セットとバージョン | 条件ごとの規則の版 |
| AI エージェント・モデル・プロバイダー・パラメータ | モックまたはモデル。研究ごと・用途ごとの割り当てと推論設定、最大出力 |
| プロンプト | プロンプトセットの版 |
| シミュレーション環境 | 外生価格＋単純約定 |
| エピソード数・乱数シード | 反復数・基準シード |
| 目的関数 | 条件の objective / persona |
| 評価器 | 規則エンジン・事前基準（固定）、Judge（評価の実行ごと） |
| 利用できるツール | なし（環境にツールがない） |
| 参照文書・情報アクセス権限 | 条文・趣旨の提示の有無（トレースの `accessPermissions`） |
| 予算上限 | 研究ごとの上限、接続先ごとの月間予算 |
| 成功・停止条件 | 全セッションの完了、または上限・致命的なエラーでの一時停止 |

## 実行

- 複数条件・複数モデルの比較: 条件は研究内で比べ、モデルは研究を複製して比べます。
- 並列実行: セッションの同時実行数で制御します。
- 停止・再開: 一時停止・再開・停止。ワーカーが止まった場合は、リースの期限切れ後に別のワーカーが取り直します。
- 途中の失敗からの復旧: セッション単位でやり直します（完了したセッションの記録は DB で保護）。
- 進捗: 3秒ごとに更新します。
- 費用: 事前の見積もりと、研究ごとの上限を設けています。
- 状態の永続化: すべて PostgreSQL に保存します。

## 未対応

- ツール・RAG・情報のアクセス制御を持つ評価環境（汎用のアダプター）。
- 複数のモデルを1つの研究の条件として比べること（現在は研究を分けて比べる）。
