'use client';

import type { TradeDecision } from '@/lib/research/types';
import { Table, td } from './ui';

const actionLabel = { buy: '買い', sell: '売り', hold: '見送り' } as const;

export default function DecisionTable({ decisions }: { decisions: TradeDecision[] }) {
  return (
    <Table head={['ステップ', '価格', '判断', '数量', '約定', '参照条文', '規則違反', '判断理由']}>
      {decisions.map((d) => (
        <tr key={d.step} className="align-top">
          <td className={td}>{d.step + 1}</td>
          <td className={td}>{d.price.toLocaleString()}</td>
          <td className={td}>{actionLabel[d.action]}</td>
          <td className={td}>{d.quantity}</td>
          <td className={td}>{d.action === 'hold' ? '—' : d.executed ? '約定' : <span className="text-rose-300">拒否</span>}</td>
          <td className={td}>{d.referencedRules.length ? d.referencedRules.map((n) => `第${n}条`).join('・') : '—'}</td>
          <td className="px-3 py-2 text-xs text-rose-300">{d.violations.join(' / ') || <span className="text-ink-300">なし</span>}</td>
          <td className="min-w-[16rem] px-3 py-2 text-xs text-ink-200">{d.parseError ? <span className="text-amber-300">出力を解釈できませんでした（{d.parseError}）</span> : d.rationale}</td>
        </tr>
      ))}
    </Table>
  );
}
