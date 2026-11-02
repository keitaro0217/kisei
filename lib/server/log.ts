import { redact } from './security/redact';

// アプリケーション自体の運用ログ（構造化ログ: 1行1件の JSON）。
// AI エージェントの実行トレース（研究データ、rc_traces）とは別物で、研究の内容（プロンプト・応答）は出力しない。
// 秘密情報を含みうる項目名の値は出力せず、文字列は伏せ字処理（APIキー・トークンの形式）を通す。

type Level = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

const SENSITIVE_KEY = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|session|private|prompt|completion|content)/i;
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const v = (process.env.LOG_LEVEL ?? '').toLowerCase() as Level;
  return ORDER[v] ?? ORDER.info;
}

/** ログに出してよい形に変換する（深さ・件数・長さに上限を設ける） */
export function sanitizeFields(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const r = redact(value);
    return r.length > 1000 ? `${r.slice(0, 1000)}…` : r;
  }
  if (value instanceof Error) return { name: value.name, message: sanitizeFields(value.message) };
  if (depth >= 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeFields(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : sanitizeFields(v, depth + 1);
    return out;
  }
  return String(value);
}

function emit(level: Level, event: string, fields: LogFields = {}) {
  if (ORDER[level] < minLevel()) return;
  const line = JSON.stringify({ at: new Date().toISOString(), level, event, service: 'kisei', ...(sanitizeFields(fields) as object) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit('debug', event, fields),
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};
