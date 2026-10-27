import type { EpisodeResult, ExperimentSnapshot, JudgeResult, TradeDecision, UsageTotals } from '@/lib/research/types';
import { invokeModel, type InvokeResult } from '../../llm/client';
import { emptyTotals } from '../../storage/store';
import { addToTotals } from '../usage';
import { applyDecision, generatePrices, parseDecision } from './market';
import { judgeUserPrompt, parseJudge, tradingUserPrompt } from './prompts';

export type EpisodeContext = {
  snapshot: ExperimentSnapshot;
  seed: number;
  index: number;
  experimentId: string | null;
  judgeEnabled: boolean;
  /** 実験ではなくシミュレーション画面からの試行 */
  preview?: boolean;
};

function track(totals: UsageTotals, res: InvokeResult) {
  addToTotals(totals, res.usage, res.record.costUsd);
}

/**
 * 1エピソードを実行する。モデル設定は必ずスナップショットから取得し、
 * 実行中に設定画面で変更されても影響を受けない。
 */
export async function runEpisode(ctx: EpisodeContext): Promise<Omit<EpisodeResult, 'attempts' | 'status' | 'error'>> {
  const { snapshot } = ctx;
  const startedAt = new Date().toISOString();
  const prices = generatePrices(snapshot.market, ctx.seed);
  const portfolio = { cash: snapshot.market.initialCash, position: 0 };
  const decisions: TradeDecision[] = [];
  const usage = emptyTotals();
  const agent = snapshot.roles.trading_agent;
  const common = {
    experimentId: ctx.experimentId,
    episodeIndex: ctx.preview ? null : ctx.index,
    timeoutMs: snapshot.operational.timeoutMs,
    maxRetries: snapshot.operational.maxRetries,
  };

  for (let step = 0; step < snapshot.market.steps; step++) {
    const price = prices[step];
    const res = await invokeModel({
      ...common,
      providerId: agent.providerId,
      model: agent.model,
      reasoning: agent.reasoning,
      maxOutputTokens: agent.maxOutputTokens,
      system: snapshot.prompts.tradingAgentSystem,
      user: tradingUserPrompt({
        ruleDocument: snapshot.ruleDocument,
        step,
        totalSteps: snapshot.market.steps,
        price,
        history: prices.slice(Math.max(0, step - 9), step + 1),
        cash: portfolio.cash,
        position: portfolio.position,
      }),
      purpose: ctx.preview ? 'simulation' : 'trading_agent',
      snapshot: agent,
    });
    track(usage, res);
    decisions.push(applyDecision(portfolio, parseDecision(res.text), price, snapshot.market.rules, step));
  }

  const finalPrice = prices[prices.length - 1];
  const finalValue = Math.round((portfolio.cash + portfolio.position * finalPrice) * 100) / 100;
  const pnl = Math.round((finalValue - snapshot.market.initialCash) * 100) / 100;

  let judge: JudgeResult | null = null;
  const judgeRole = snapshot.roles.llm_judge;
  if (ctx.judgeEnabled && judgeRole) {
    const res = await invokeModel({
      // タイムアウト・再試行は Judge 側プロバイダーの設定を使う
      experimentId: common.experimentId,
      episodeIndex: common.episodeIndex,
      providerId: judgeRole.providerId,
      model: judgeRole.model,
      reasoning: judgeRole.reasoning,
      maxOutputTokens: judgeRole.maxOutputTokens,
      system: snapshot.prompts.judgeSystem,
      user: judgeUserPrompt(snapshot.ruleDocument, decisions, pnl),
      purpose: ctx.preview ? 'simulation' : 'llm_judge',
      snapshot: judgeRole,
    });
    track(usage, res);
    judge = parseJudge(res.text);
  }

  return {
    index: ctx.index,
    seed: ctx.seed,
    finalValue,
    pnl,
    violationCount: decisions.reduce((n, d) => n + d.violations.length, 0),
    decisions,
    judge,
    usage,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}
