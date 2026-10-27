'use client';

import { Field, inputClass } from './ui';

export type MarketForm = { steps: string; initialCash: string; maxOrderQuantity: string; maxPosition: string; allowShortSelling: boolean; seed: string; judgeEnabled: boolean };

export const defaultMarketForm: MarketForm = { steps: '5', initialCash: '100000', maxOrderQuantity: '100', maxPosition: '500', allowShortSelling: false, seed: '', judgeEnabled: false };

export function validateMarket(f: MarketForm): string | null {
  const ok = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
  if (!ok(f.steps, 1, 50)) return 'ステップ数は1〜50の整数で入力してください';
  if (!ok(f.initialCash, 1000, 100_000_000)) return '初期資金は1,000〜100,000,000の整数で入力してください';
  if (!ok(f.maxOrderQuantity, 1, 100_000)) return '注文数量の上限は1〜100,000の整数で入力してください';
  if (!ok(f.maxPosition, 1, 1_000_000)) return '保有上限は1〜1,000,000の整数で入力してください';
  if (f.seed !== '' && !ok(f.seed, 0, 2 ** 31 - 1)) return '乱数シードは0以上の整数で入力してください';
  return null;
}

export function marketPayload(f: MarketForm) {
  return {
    steps: Number(f.steps),
    initialCash: Number(f.initialCash),
    maxOrderQuantity: Number(f.maxOrderQuantity),
    maxPosition: Number(f.maxPosition),
    allowShortSelling: f.allowShortSelling,
    seed: f.seed === '' ? undefined : Number(f.seed),
    judgeEnabled: f.judgeEnabled,
  };
}

export default function MarketFields({ form, onChange }: { form: MarketForm; onChange: (f: MarketForm) => void }) {
  const set = (k: keyof MarketForm, v: string | boolean) => onChange({ ...form, [k]: v });
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label="ステップ数（1エピソードの取引回数）">
        <input className={inputClass} inputMode="numeric" value={form.steps} onChange={(e) => set('steps', e.target.value)} />
      </Field>
      <Field label="初期資金">
        <input className={inputClass} inputMode="numeric" value={form.initialCash} onChange={(e) => set('initialCash', e.target.value)} />
      </Field>
      <Field label="乱数シード" hint="空欄は自動。同じシードで同じ市場を再現します">
        <input className={inputClass} inputMode="numeric" value={form.seed} onChange={(e) => set('seed', e.target.value)} />
      </Field>
      <Field label="規則: 注文数量の上限">
        <input className={inputClass} inputMode="numeric" value={form.maxOrderQuantity} onChange={(e) => set('maxOrderQuantity', e.target.value)} />
      </Field>
      <Field label="規則: 保有上限">
        <input className={inputClass} inputMode="numeric" value={form.maxPosition} onChange={(e) => set('maxPosition', e.target.value)} />
      </Field>
      <div className="flex flex-col justify-end gap-2 pb-1">
        <label className="flex items-center gap-2 text-sm text-ink-100">
          <input type="checkbox" checked={form.allowShortSelling} onChange={(e) => set('allowShortSelling', e.target.checked)} />
          空売りを認める
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-100">
          <input type="checkbox" checked={form.judgeEnabled} onChange={(e) => set('judgeEnabled', e.target.checked)} />
          LLM Judge で各エピソードを評価する
        </label>
      </div>
    </div>
  );
}
