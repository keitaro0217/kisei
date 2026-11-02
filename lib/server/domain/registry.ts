import type { DomainId } from '@/lib/domain/model';
import type { DomainAdapter } from './adapter';
import { financialMarketAdapter } from './financial';
import { tradingCompanyAdapter } from './tradingCompany';

// ドメインアダプターの登録。業種を追加する場合は、アダプターを実装してここに登録する。
const ADAPTERS: Record<DomainId, DomainAdapter<unknown>> = {
  financial_market: financialMarketAdapter as DomainAdapter<unknown>,
  trading_company: tradingCompanyAdapter as DomainAdapter<unknown>,
};

export function getAdapter(domain: DomainId): DomainAdapter<unknown> {
  return ADAPTERS[domain];
}
