import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEncryptionKey } from '../env';

// APIキーを AES-256-GCM（認証付き暗号）で暗号化する。Node.js 組み込みの OpenSSL 実装を利用。
// 保存形式: v1:<iv base64>:<authTag base64>:<ciphertext base64>
// AAD にプロバイダーIDを含め、暗号文を別のプロバイダーへ付け替えても復号できないようにする。

const VERSION = 'v1';
const IV_LENGTH = 12;

export class EncryptionUnavailableError extends Error {
  constructor() {
    super('APIキー暗号化用の鍵（API_KEY_ENCRYPTION_KEY）が設定されていません。');
    this.name = 'EncryptionUnavailableError';
  }
}

function requireKey(): Buffer {
  const key = getEncryptionKey();
  if (!key) throw new EncryptionUnavailableError();
  return key;
}

export function isEncryptionConfigured(): boolean {
  return getEncryptionKey() !== null;
}

export function encryptSecret(plaintext: string, associatedData: string): string {
  const key = requireKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(associatedData, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(payload: string, associatedData: string): string {
  const key = requireKey();
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error('暗号化データの形式が不正です。');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  try {
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    // 鍵の不一致や改ざん。詳細（鍵や暗号文）はメッセージに含めない
    throw new Error('APIキーを復号できませんでした。暗号化キーが変更された可能性があります。');
  }
}

/** 画面表示用のマスク。先頭数文字と末尾4文字のみを残す。 */
export function maskSecret(secret: string): string {
  const trimmed = secret.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefixMatch = /^[A-Za-z]+[-_]/.exec(trimmed);
  const prefix = prefixMatch ? prefixMatch[0].slice(0, 7) : '';
  return `${prefix}••••••••${trimmed.slice(-4)}`;
}
