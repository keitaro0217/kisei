// ログ・エラーメッセージ・監査記録に秘密情報が混入しないようにするための処理。

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g, // OpenAI / Anthropic 形式
  /\bAIza[0-9A-Za-z_-]{20,}\b/g, // Google API キー
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(x-api-key|x-goog-api-key|authorization|api[_-]?key|password)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
];

export function redact(text: string, knownSecrets: (string | null | undefined)[] = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[REDACTED]');
  }
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, p1, p2) =>
      typeof p2 === 'string' && typeof p1 === 'string' && /key|authorization|password/i.test(p1) ? `${p1}${p2}[REDACTED]` : '[REDACTED]',
    );
  }
  return out;
}

/** 外部から受け取った文字列を、画面表示・保存できる長さに切り詰めて秘密情報を除去する */
export function safeMessage(text: unknown, knownSecrets: (string | null | undefined)[] = [], max = 300): string {
  const raw = typeof text === 'string' ? text : text instanceof Error ? text.message : JSON.stringify(text ?? '');
  const cleaned = redact(raw, knownSecrets).replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}
