// 条文の差分（文字単位の最長共通部分列）。条文A/Bのどこが異なるかを強調表示するために使う。
// 計算量は O(n×m) のため、長すぎる場合は行単位に切り替える。

export type DiffPart = { kind: 'same' | 'removed' | 'added'; text: string };

const MAX_CELLS = 2_000_000;

function lcsDiff(a: string[], b: string[]): DiffPart[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('removed', a[i++]);
    } else {
      push('added', b[j++]);
    }
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);
  return out;
}

export function diffText(a: string, b: string): DiffPart[] {
  const ca = Array.from(a);
  const cb = Array.from(b);
  if (ca.length * cb.length <= MAX_CELLS) return lcsDiff(ca, cb);
  const la = a.split(/(?<=\n)/);
  const lb = b.split(/(?<=\n)/);
  return la.length * lb.length <= MAX_CELLS ? lcsDiff(la, lb) : [{ kind: 'removed', text: a }, { kind: 'added', text: b }];
}
