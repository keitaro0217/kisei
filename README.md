# hounonukeana

規制解釈AIの研究コンソールです。仮想金融市場で取引エージェントを大量エピソード実行し、
複数のAIプロバイダー（OpenAI / Anthropic / Gemini / OpenAI互換 / Ollama）との連携・費用・監査を管理します。

## セットアップ

```bash
npm ci
cp .env.local.example .env.local   # BASIC_AUTH_USERNAME / BASIC_AUTH_PASSWORD / API_KEY_ENCRYPTION_KEY を設定
npm run dev                        # http://localhost:3000/research
npm test
```

Next.js 16 を使用しています。`middleware` は `proxy.ts` に名称変更されています。

## Basic認証

アプリ全体（研究コンソールの画面・すべての `/api`）に HTTP Basic 認証をかけています。

- `proxy.ts` で全リクエストを検証し、さらに各 API Route Handler と研究コンソールのレイアウトでも再検証します（多層防御）。
- 照合は SHA-256 ダイジェスト同士の `timingSafeEqual` による定数時間比較です。
- 失敗時は `401` と `WWW-Authenticate: Basic realm="Research Console"` を返します。
- 本番環境（`NODE_ENV=production`）では HTTPS 以外のアクセスをリダイレクト（GET/HEAD）または `403` で拒否し、HSTS を付与します。
- パスワードや Authorization ヘッダーはログ・監査ログに記録しません。

| 変数 | 説明 |
|---|---|
| `BASIC_AUTH_USERNAME` | ユーザー名（必須） |
| `BASIC_AUTH_PASSWORD` | パスワード（必須・12文字以上） |
| `API_KEY_ENCRYPTION_KEY` | APIキー暗号化用の32バイト鍵（必須） |

本番環境でこれらが未設定・不正な場合、`instrumentation.ts` がサーバーの起動を中止します（値は出力しません）。
開発環境で未設定の場合のみ認証なしで動作し、セキュリティ画面に警告を表示します。
`.env.local.example` を参考に `.env.local`（Git管理外）またはホスティング環境の環境変数に設定してください。

認証は `lib/server/auth` の `AuthProvider` / `Principal` / `Permission` で抽象化しており、将来の個別アカウント・権限管理・多要素認証へ差し替えられます。

## 研究コンソール（`/research`）

規制解釈AIの研究実験とAPI連携を管理する画面です。

- **ダッシュボード**: 接続状態・実行中の実験・今月の費用。未設定時は設定手順を案内します。
- **研究実験**: 仮想金融市場で取引エージェントを大量エピソード実行（最大100,000、並列実行・一時停止・再開・停止）。
- **シミュレーション**: 現在の設定で1エピソードを試行。
- **設定**: 基本設定 / API連携 / モデル割り当て / 実行設定 / 費用管理 / セキュリティ。

### API連携

- 対応: OpenAI API、Anthropic Claude API、Google Gemini API、OpenAI互換API、ローカルLLM（Ollama）。
- モデル一覧は各プロバイダーのAPIから取得します（モデル名・料金は固定値で持ちません）。
- APIキーはサーバー側で AES-256-GCM（Node.js 標準の OpenSSL 実装、プロバイダーIDをAADに使用）で暗号化して保存し、フロントエンドにはマスク値のみ返します。ブラウザのストレージには保存しません。
- API呼び出しはすべてバックエンド経由（`lib/server/llm/client.ts`）で、予算確認・同時実行数制御・再試行・使用量記録を行います。
- SSRF対策: https のみ許可、プライベート/ループバック/リンクローカル/メタデータアドレスを接続直前のDNS解決結果で拒否、リダイレクト非追跡。ローカルLLMなどは `LLM_ALLOWED_PRIVATE_HOSTS` で明示的に許可したホストのみ接続できます。
- 接続テストは「APIキー → 通信 → モデル → 最小限の推論」の4段階で、すべて成功した場合のみ「接続済み」になります。エラーは認証・モデル未対応・利用上限・通信障害などに分類して表示します。

### 研究条件の固定

実験開始時に、取引エージェント / LLM Judge のモデル・推論設定・最大出力トークン・プロンプト・ツール構成・市場条件をスナップショットとして保存し、研究条件のハッシュで実験バージョン（v1, v2…）を付番します。
設定画面で割り当てを変更しても実行中の実験には影響しません。APIキーの更新は実行中の実験にも反映されますが、接続先（種類・Base URL）が変わった場合は実験を一時停止します。

### 費用管理

入力・出力・キャッシュ・推論トークン、呼び出し回数、エピソード/実験/月ごとの費用、予算残額を記録します。
各プロバイダーは料金表APIを提供していないため、費用は管理者が出典つきで登録した単価でのみ計算し、単価未設定の呼び出しは「料金未設定」として件数のみ表示します。
月間予算（プロバイダー別・全体）に達すると、研究条件を保持したまま実験を一時停止します。モデルの自動変更や実験回数の削減は行いません。

### データ保存

`RESEARCH_DATA_DIR`（既定 `.data/research`、Git管理外）に JSON / JSONL で保存します。単一サーバーでの運用を前提としており、Vercel のようなファイルシステムが永続化されない環境では、`lib/server/storage/store.ts` をデータベース実装に差し替えてください。

### テスト

```bash
npm test                       # 単体・結合テスト（モックLLMサーバーを使用）
REAL_API_TEST=1 npm test       # 実際のAPIへの疎通確認（ANTHROPIC_TEST_KEY 等を設定すると実キーで確認）
```
