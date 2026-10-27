// サーバー専用: 環境変数の読み取りと検証。
// 値（パスワード・暗号化キー）はログやエラーメッセージに含めない。

export const isProduction = () => process.env.NODE_ENV === 'production';

/** Basic認証はパスワードのみで照合する（ユーザー名は使わない） */
export type BasicAuthConfig = { password: string };

export function getBasicAuthConfig(): BasicAuthConfig | null {
  const password = process.env.BASIC_AUTH_PASSWORD;
  if (!password) return null;
  return { password };
}

/** AES-256-GCM 用の32バイト鍵。base64 または 64文字の16進数で指定する。 */
export function getEncryptionKey(): Buffer | null {
  const raw = process.env.API_KEY_ENCRYPTION_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, 'hex');
  } else {
    key = Buffer.from(trimmed, 'base64');
  }
  return key.length === 32 ? key : null;
}

export function getDataDir(): string {
  return process.env.RESEARCH_DATA_DIR || '.data/research';
}

/**
 * PostgreSQL の接続文字列。Vercel の Neon 連携などが設定する DATABASE_URL / POSTGRES_URL を使う。
 * 未設定ならローカル用の組み込み Postgres（PGlite）を使う。
 */
export function getDatabaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

/** Vercel 上で動作しているか（ファイルシステムが永続化されず、処理はリクエスト単位で終了する） */
export const isVercel = () => process.env.VERCEL === '1';

/** 実験ワーカー（Vercel Cron・自己呼び出し）を認証するための共有シークレット */
export function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}

/**
 * プライベートネットワーク上でも接続を許可するホスト（host または host:port）。
 * ローカルLLM（Ollama）や社内ゲートウェイ用。既定は空（すべて拒否）。
 */
export function getAllowedPrivateHosts(): string[] {
  return (process.env.LLM_ALLOWED_PRIVATE_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** 外部APIへの通信に使うHTTP CONNECTプロキシ（任意）。 */
export function getEgressProxyUrl(): URL | null {
  const raw = process.env.LLM_EGRESS_PROXY_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export type EnvProblem = { variable: string; problem: string };

/** 本番環境で必須の環境変数を検証する。値そのものは返さない。 */
export function validateRequiredEnv(): EnvProblem[] {
  const problems: EnvProblem[] = [];
  if (!process.env.BASIC_AUTH_PASSWORD) {
    problems.push({ variable: 'BASIC_AUTH_PASSWORD', problem: '未設定です' });
  } else if (process.env.BASIC_AUTH_PASSWORD.length < 12) {
    problems.push({ variable: 'BASIC_AUTH_PASSWORD', problem: '12文字以上にしてください' });
  }
  if (!process.env.API_KEY_ENCRYPTION_KEY) {
    problems.push({ variable: 'API_KEY_ENCRYPTION_KEY', problem: '未設定です' });
  } else if (!getEncryptionKey()) {
    problems.push({ variable: 'API_KEY_ENCRYPTION_KEY', problem: '32バイト（base64 または 16進数64文字）で指定してください' });
  }
  if (isVercel()) {
    // Vercel ではローカルファイルが永続化されないため、データベースと実験ワーカー用のシークレットが必須
    if (!getDatabaseUrl()) problems.push({ variable: 'DATABASE_URL', problem: 'Vercel では PostgreSQL の接続文字列が必須です' });
    if (!getCronSecret()) problems.push({ variable: 'CRON_SECRET', problem: 'Vercel では16文字以上のランダムな値が必須です' });
  } else if (process.env.CRON_SECRET && !getCronSecret()) {
    problems.push({ variable: 'CRON_SECRET', problem: '16文字以上にしてください' });
  }
  if (process.env.LLM_EGRESS_PROXY_URL && !getEgressProxyUrl()) {
    problems.push({ variable: 'LLM_EGRESS_PROXY_URL', problem: 'http(s):// で始まるURLを指定してください' });
  }
  return problems;
}
