import type { DecisionRecord, Study, StudySession } from '@/lib/research/study-types';
import { contentHash } from '../../util/canonical';
import type { LogisticResult } from './regression';
import { hasRuleViolation, type StudyStats } from './stats';

// 研究結果のエクスポート（CSV / JSON / Markdown）。
// APIキーや接続情報は含めない（凍結設定にも保存していない）。

/** CSV の1セル。数式として解釈される先頭文字（= + - @ タブ CR）は ' を付けて無害化する */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (header: string[], rows: unknown[][]) => '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export function decisionsCsv(decisions: DecisionRecord[]): string {
  const header = [
    'condition_id', 'replicate', 'step', 'is_mock', 'category',
    'price', 'last_trade_price', 'cash_before', 'position_before', 'open_orders_before',
    'action', 'order_type', 'quantity', 'limit_price', 'cancel_order_id', 'parse', 'parse_error',
    'verdict', 'rule_violation', 'violation_codes', 'intent_deviation_codes', 'filled_quantity', 'fill_price', 'cash_after', 'position_after',
    'self_assessed_compliance', 'reasoning_action_discrepancy', 'cited_rules', 'rationale',
    'monitor', 'input_tokens', 'output_tokens', 'cost_usd',
  ];
  const rows = decisions.map((d) => [
    d.conditionId, d.replicate, d.step, d.isMock, d.category,
    d.context.price, d.context.lastTradePrice, d.context.cash, d.context.position, d.context.openOrders.length,
    d.attempted.action, d.attempted.orderType, d.attempted.quantity, d.attempted.limitPrice, d.attempted.cancelOrderId, d.attempted.parse, d.attempted.parseError,
    d.enforcement.verdict, hasRuleViolation(d), d.enforcement.violations.map((v) => v.code).join('|'), d.enforcement.intentDeviations.map((v) => v.code).join('|'),
    d.enforcement.filledQuantity, d.enforcement.fillPrice, d.enforcement.after.cash, d.enforcement.after.position,
    d.reasoning.selfAssessedCompliance, d.reasoningActionDiscrepancy, d.reasoning.citedRules.join('|'), d.reasoning.rationale,
    d.monitor ? d.monitor.judgement : '', d.usage?.inputTokens ?? '', d.usage?.outputTokens ?? '', d.usage?.costUsd ?? '',
  ]);
  return toCsv(header, rows);
}

export function sessionsCsv(sessions: StudySession[]): string {
  return toCsv(
    ['condition_id', 'replicate', 'seed', 'status', 'attempts', 'final_value', 'pnl', 'error', 'started_at', 'finished_at'],
    sessions.map((s) => [s.conditionId, s.replicate, s.seed, s.status, s.attempts, s.finalValue, s.pnl, s.error, s.startedAt, s.finishedAt]),
  );
}

export function summaryJson(study: Study, sessions: StudySession[], stats: StudyStats) {
  return {
    schema: 'kisei.study-summary/v1',
    generatedAt: new Date().toISOString(),
    studyId: study.id,
    title: study.design.title,
    status: study.status,
    isMock: study.isMock,
    dataLabel: study.isMock ? 'モックデータ（AIの判断ではありません）' : '実験データ',
    frozenHash: study.frozenHash,
    codeVersion: study.frozen?.codeVersion ?? null,
    sessionCounts: sessions.reduce<Record<string, number>>((acc, s) => ((acc[s.status] = (acc[s.status] ?? 0) + 1), acc), {}),
    stats,
    disclaimer: LEGAL_DISCLAIMER,
  };
}

export const LEGAL_DISCLAIMER =
  '本結果は閉じた合成市場における研究用の実験結果であり、法令の解釈・適法性についての判断や法的助言ではありません。規則エンジンの判定は研究者が定義した判定ロジックに基づくもので、法的効果を持ちません。';

const pct = (p: number | null) => (p === null ? '—' : `${(p * 100).toFixed(1)}%`);
const ci = (c: [number, number] | null, scale = 100) => (c ? `[${(c[0] * scale).toFixed(1)}, ${(c[1] * scale).toFixed(1)}]` : '—');
const fmt = (x: number | null, d = 3) => (x === null || !Number.isFinite(x) ? '—' : x.toFixed(d));
const pval = (p: number | null) => (p === null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
const md = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function markdownReport(study: Study, sessions: StudySession[], stats: StudyStats, regression?: LogisticResult | null): string {
  const d = study.frozen?.design ?? study.design;
  const rules = study.frozen?.rules ?? [];
  const label = (id: string) => d.conditions.find((c) => c.id === id)?.label ?? id;
  const lines: string[] = [];
  lines.push(`# ${d.title}`);
  lines.push('');
  if (study.isMock) {
    lines.push('> **【モックデータ】** この研究は決定論的なモックエージェントで実行されました。AIの判断ではなく、研究フローの検証用データです。研究結果として引用しないでください。');
    lines.push('');
  }
  lines.push(`- 研究ID: ${study.id}`);
  lines.push(`- 状態: ${study.status}${study.statusReason ? `（${study.statusReason}）` : ''}`);
  lines.push(`- 凍結設定のハッシュ (SHA-256): \`${study.frozenHash ?? '未凍結'}\``);
  lines.push(`- コードのバージョン: ${study.frozen?.codeVersion ?? '—'}`);
  lines.push(`- 開始: ${study.startedAt ?? '—'} / 終了: ${study.finishedAt ?? '—'}`);
  lines.push(`- エージェント: ${study.frozen?.agentRole ? `${study.frozen.agentRole.providerName} / ${study.frozen.agentRole.model}` : 'モック（決定論的）'}`);
  lines.push('');
  lines.push('## 研究デザイン');
  lines.push('');
  for (const [k, v] of [
    ['研究課題', d.question],
    ['帰無仮説', d.nullHypothesis],
    ['対立仮説', d.alternativeHypothesis],
    ['独立変数', d.independentVariables],
    ['従属変数', d.dependentVariables],
    ['統制変数', d.controlVariables],
    ['分析計画（事前登録）', d.analysisPlan],
  ]) {
    lines.push(`- **${k}**: ${v || '（未記入）'}`);
  }
  lines.push('');
  lines.push(`市場: 外生価格＋単純約定（${d.market.steps}ステップ、初期価格 ${d.market.initialPrice}、初期現金 ${d.market.initialCash}、ボラティリティ ${d.market.volatility}）。反復 ${d.replicates} 回、基準シード ${d.baseSeed}（反復 r はシード ${d.baseSeed}+r を全条件で共通に使用）。`);
  lines.push('');
  lines.push('## 条件');
  lines.push('');
  lines.push('| 条件ID | 名称 | 規則 | 条文の提示 | 趣旨の提示 | 目標 | ペルソナ |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const c of d.conditions) {
    const rs = c.ruleVersionIds.map((id) => rules.find((r) => r.id === id)).map((r) => (r ? `${r.ruleKey} v${r.version}` : '?')).join(', ') || 'なし';
    lines.push(`| ${md(c.id)} | ${md(c.label)} | ${md(rs)} | ${c.presentRules ? 'あり' : 'なし'} | ${c.includePurpose ? 'あり' : 'なし'} | ${c.objective} | ${c.persona} |`);
  }
  lines.push('');
  if (rules.length) {
    lines.push('## 使用した規則（凍結時点の版）');
    lines.push('');
    for (const r of rules) {
      lines.push(`### ${r.ruleKey} v${r.version}: ${r.name}`);
      lines.push('');
      lines.push(`> ${r.text.replace(/\n/g, '\n> ')}`);
      lines.push('');
      lines.push(`判定ロジックのハッシュ: \`${r.logicHash}\``);
      lines.push('');
    }
  }
  lines.push('## 結果');
  lines.push('');
  lines.push('| 条件 | 完了/失敗/未実行 | 判断数 | 試行数 | 規則違反率 [95% CI] | 拒否率 | 趣旨逸脱率（受理中） | 解釈不能率 | 説明と判定の不一致（拒否中） | 損益の平均 (SD) |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const s of stats.conditions) {
    lines.push(
      `| ${md(s.label)} | ${s.sessions.completed}/${s.sessions.failed}/${s.sessions.pending + s.sessions.running} | ${s.decisions} | ${s.orderAttempts} | ${pct(s.ruleViolationRate.p)} ${ci(s.ruleViolationRate.ci)} | ${pct(s.engineRejectRate.p)} | ${pct(s.intentDeviationRate.p)} | ${pct(s.undecidableRate.p)} | ${pct(s.discrepancyRate.p)} | ${fmt(s.pnl.mean, 0)} (${fmt(s.pnl.sd, 0)}) |`,
    );
  }
  lines.push('');
  if (stats.comparisons.length) {
    lines.push('## 条件間の比較（規則違反率）');
    lines.push('');
    lines.push('| 比較 | 差（プール） | 反復単位ブートストラップ 95% CI | 対応のある反復数 | 並べ替え検定 p | Holm 補正 p | Cohen h | オッズ比 | χ² p（参考） | Fisher p（参考） |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const c of stats.comparisons) {
      lines.push(
        `| ${c.primary ? '**主要** ' : ''}${md(label(c.treatment))} − ${md(label(c.control))} | ${c.pooledDiff === null ? '—' : `${(c.pooledDiff * 100).toFixed(1)} pt`} | ${ci(c.bootstrapCi)} pt | ${c.pairedReplicates} | ${pval(c.permutationP)}${c.permutationExact ? '' : '（近似）'} | ${pval(c.holmP)} | ${fmt(c.cohensH)} | ${fmt(c.oddsRatio, 2)} | ${pval(c.chiSquare?.p ?? null)} | ${pval(c.fisherP)} |`,
      );
    }
    lines.push('');
  }
  if (regression) {
    lines.push('## 要因の効果（ロジスティック回帰）');
    lines.push('');
    if (!regression.ok) {
      lines.push(`推定できませんでした: ${regression.reason}`);
    } else {
      lines.push(`目的変数: 発注・取消の試行が規則違反を含むか。試行 ${regression.n} 件（違反 ${regression.events} 件）、セッション ${regression.clusters} 個。標準誤差はセッション単位のクラスター頑健推定。`);
      lines.push('');
      lines.push('| 項 | 係数 | SE | オッズ比 | 95% 区間 | p |');
      lines.push('|---|---|---|---|---|---|');
      for (const c of regression.coefficients) {
        lines.push(`| ${md(c.label)} | ${c.estimate.toFixed(3)} | ${c.se.toFixed(3)} | ${c.oddsRatio.toFixed(3)} | [${c.ci[0].toFixed(3)}, ${c.ci[1].toFixed(3)}] | ${pval(c.p)} |`);
      }
      for (const n of regression.notes) lines.push(`- ${n}`);
    }
    lines.push('');
  }
  lines.push('## 方法と注意事項');
  lines.push('');
  for (const n of stats.notes) lines.push(`- ${n}`);
  lines.push('- 意思決定ログは「表明された説明」「提案された行動」「規則エンジンの判定」「監視AIの評価」を分けて記録しています。規則エンジンはAIの適法性の主張を参照しません。');
  lines.push('- 監視AIの評価（Monitor Evidence）は本バージョンでは未実装のため、記録されていません。規制趣旨の評価（LLM Judge・人の評価）と評価器の一致率（κ など）は「多層評価」の画面・出力を参照してください。');
  lines.push('- 因果的な解釈: 条件は研究者が割り当て、同じ反復では全条件で同じ外生価格系列を使っています。ただし LLM の応答は確率的で、同じシードでも行動は一致しません。');
  lines.push(`- 失敗したセッション: ${sessions.filter((s) => s.status === 'failed').length} 件 / 未実行: ${sessions.filter((s) => s.status === 'pending' || s.status === 'running').length} 件`);
  lines.push('');
  lines.push('## 免責');
  lines.push('');
  lines.push(LEGAL_DISCLAIMER);
  lines.push('');
  return lines.join('\n');
}

export const SIMULATOR_VERSION = 'exogenous_simple@1';
export const ENGINE_VERSION = 'rule-dsl@1';

/**
 * 再現性のためのマニフェスト。研究条件を構成する要素のハッシュと、完全な再現を妨げる要因を明記する。
 */
export function manifestJson(study: Study, sessions: StudySession[], graders: { name: string; kind: string; promptVersion: string; promptHash: string; model: string | null }[]) {
  const f = study.frozen;
  const completed = sessions.filter((s) => s.status === 'completed').sort((a, b) => a.conditionId.localeCompare(b.conditionId) || a.replicate - b.replicate);
  const limitations = [
    'LLM の応答は確率的なため、同じ設定・同じシードでも行動が一致するとは限りません（モックエージェントは完全に再現されます）。',
    'モデル提供者がモデルを更新した場合、同じモデル ID でも挙動が変わる可能性があります（提供者がバージョンを返さない場合は記録できません）。',
    'コードのバージョンは Vercel のコミット SHA から取得します。ローカル実行では "local" と記録され、コードの版を特定できません。',
  ];
  return {
    schema: 'kisei.experiment-manifest/v1',
    studyId: study.id,
    title: (f?.design ?? study.design).title,
    isMock: study.isMock,
    frozenHash: study.frozenHash,
    frozenAt: f?.frozenAt ?? null,
    gitCommitSha: f?.codeVersion ?? null,
    simulatorVersion: SIMULATOR_VERSION,
    engineVersion: ENGINE_VERSION,
    agent: f?.agentRole ? { providerType: f.agentRole.providerType, baseUrl: f.agentRole.baseUrl, model: f.agentRole.model, reasoning: f.agentRole.reasoning, maxOutputTokens: f.agentRole.maxOutputTokens } : { kind: 'mock' },
    prompt: f ? { name: f.promptSet.name, version: f.promptSet.version, hash: contentHash(f.promptSet).slice(0, 16) } : null,
    rules: (f?.rules ?? []).map((r) => ({ id: r.id, ruleKey: r.ruleKey, version: r.version, logicHash: r.logicHash, textHash: contentHash(r.text).slice(0, 16) })),
    seeds: { baseSeed: (f?.design ?? study.design).baseSeed, replicates: (f?.design ?? study.design).replicates, rule: 'seed(r) = baseSeed + r（全条件で共通）' },
    graders,
    dataset: { completedSessions: completed.length, fingerprint: contentHash(completed.map((s) => [s.conditionId, s.replicate, s.seed, s.finalValue])).slice(0, 16) },
    reproducibility: study.isMock ? 'deterministic' : 'stochastic',
    limitations,
  };
}
