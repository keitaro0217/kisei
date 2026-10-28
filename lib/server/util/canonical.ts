import { createHash } from 'node:crypto';

/** キーを並べ替えた決定的な JSON 文字列（ハッシュ計算用） */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 内容のハッシュ（JSON のキー順に左右されない） */
export const contentHash = (value: unknown) => sha256Hex(canonical(value));
