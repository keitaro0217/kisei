import { json, readJson, withAuth } from '@/lib/server/api';
import { parseMarketConfig } from '@/lib/server/research/experiments';
import { runEpisode } from '@/lib/server/research/sim/episode';
import { buildSnapshot } from '@/lib/server/research/snapshot';
import { assertPricedWhenBudgeted } from '@/lib/server/research/usage';

// 現在のモデル割り当てで1エピソードだけ試行する（実験としては記録しないが、API使用量は記録する）
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async () => {
    const body = await readJson(request);
    const market = parseMarketConfig(body);
    const judgeEnabled = body.judgeEnabled === true;
    const snapshot = await buildSnapshot(market, judgeEnabled);
    await assertPricedWhenBudgeted(snapshot.roles.trading_agent.providerId, snapshot.roles.trading_agent.model);
    if (snapshot.roles.llm_judge) await assertPricedWhenBudgeted(snapshot.roles.llm_judge.providerId, snapshot.roles.llm_judge.model);
    const seed = Number.isInteger(Number(body.seed)) ? Number(body.seed) : Math.floor(Math.random() * 1_000_000);
    const result = await runEpisode({ snapshot, seed, index: 0, experimentId: null, judgeEnabled, preview: true });
    return json({ result, ruleDocument: snapshot.ruleDocument, model: snapshot.roles.trading_agent.model });
  });
}
