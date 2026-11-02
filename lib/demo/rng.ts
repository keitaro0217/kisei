// 決定論的な乱数（同じシードなら同じ列）。デモのシミュレーションはすべてこの乱数だけを使う。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2つの整数から派生シードを作る（エピソード・ステップごとに独立した列を得る） */
export const deriveSeed = (a: number, b: number) => (Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x85ebca6b, 2246822519)) >>> 0;
