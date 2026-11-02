import { episodeSeed, METRICS, type ConditionEpisodes, type ExperimentConfig } from './experiment';

// エクスポート（CSV / JSON）。結果は決定論的なシミュレーションの出力であることを必ず記録する。

export type ExportableExperiment = { id: string; version: number; hash: string; snapshot: ExperimentConfig; data: ConditionEpisodes; status: string; kind: string };

export function experimentCsv(exp: ExportableExperiment): string {
  const head = ['experiment_id', 'version', 'config_hash', 'output_kind', 'condition', 'episode', 'seed', 'orders', 'short_sales', 'formal_violations', 'intent_candidates', 'benign_orders', 'benign_rejected', 'boundary_orders', 'amends', 'cancels', 'pnl', ...Object.keys(METRICS)];
  const rows = [head.join(',')];
  for (const c of exp.snapshot.conditions) {
    (exp.data[c] ?? []).forEach((m, e) => {
      rows.push(
        [exp.id, exp.version, exp.hash, exp.kind, c, e, episodeSeed(exp.snapshot.baseSeed, e), m.orders, m.shortSales, m.formalViolations, m.intentCandidates, m.benignOrders, m.benignRejected, m.boundaryOrders, m.amends, m.cancels, m.pnl, ...Object.values(METRICS).map((x) => x.of(m) ?? '')].join(','),
      );
    });
  }
  return rows.join('\n');
}
