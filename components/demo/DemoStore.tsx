'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_AGENT, type AgentConfig } from '@/lib/demo/agent';
import { startEpisode, stepEpisode, type EpisodeRunner, type TraceStep } from '@/lib/demo/episode';
import { configHash, defaultExperiment, DEFAULT_MARKET, episodeSeed, runUnit, type ConditionEpisodes, type ExperimentConfig } from '@/lib/demo/experiment';
import type { MarketConfig } from '@/lib/demo/market';
import { DEFAULT_RULES, type ConditionId, type RuleSet } from '@/lib/demo/rules';
import type { PatchStatus, verifyPatch } from '@/lib/demo/patches';

// デモ全体の共通の状態（同じ Run ID・シナリオ・規則の版を各画面で参照する）。
// 保存先はブラウザの localStorage（このブラウザのみ。サーバー・DB には送らない）。読み書きに失敗しても動作する。
// シミュレーションの途中の状態は保存せず、設定・シード・ステップ数から決定論的に再現する。

const KEY = 'kisei-research-demo-v1';

export type JobStatus = 'idle' | 'running' | 'paused' | 'cancelled' | 'completed';
export type ExperimentRun = {
  id: string;
  version: number;
  hash: string;
  snapshot: ExperimentConfig;
  status: JobStatus;
  done: number;
  total: number;
  data: ConditionEpisodes;
  startedAt: string;
  finishedAt: string | null;
  /** このデモの結果は決定論的なシミュレーションの出力（実 LLM の実測ではない） */
  kind: 'deterministic_simulation_output';
};

export type Verification = ReturnType<typeof verifyPatch> & { patchId: string; at: string; conditionBefore: ConditionId; conditionAfter: ConditionId; baseHash: string; patchedHash: string };

type Persisted = {
  rules: RuleSet;
  condition: ConditionId;
  docsAccess: boolean;
  agent: AgentConfig;
  market: MarketConfig;
  seed: number;
  steps: number;
  simStep: number;
  experiment: ExperimentRun | null;
  experimentVersion: number;
  patchStatus: Record<string, PatchStatus>;
  verifications: Verification[];
  advanced: boolean;
  guideStep: number | null;
};

const initial: Persisted = {
  rules: DEFAULT_RULES,
  condition: 'A-C1',
  docsAccess: false,
  agent: DEFAULT_AGENT,
  market: DEFAULT_MARKET,
  seed: 42,
  steps: 60,
  simStep: 0,
  experiment: null,
  experimentVersion: 0,
  patchStatus: {},
  verifications: [],
  advanced: false,
  guideStep: null,
};

type Ctx = Persisted & {
  hydrated: boolean;
  update: (patch: Partial<Persisted>) => void;
  runId: string;
  scenarioId: string;
  ruleVersion: string;
  // シミュレーター
  runner: EpisodeRunner;
  trace: TraceStep[];
  simRunning: boolean;
  speed: number;
  setSpeed: (n: number) => void;
  simStart: () => void;
  simPause: () => void;
  simStepForward: () => void;
  simReset: () => void;
  // 実験
  experimentConfig: ExperimentConfig;
  setExperimentConfig: (patch: Partial<ExperimentConfig>) => void;
  runExperiment: () => void;
  pauseExperiment: () => void;
  resumeExperiment: () => void;
  cancelExperiment: () => void;
  resetAll: () => void;
};

const DemoContext = createContext<Ctx | null>(null);

function load(): Persisted {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return initial;
    const p = JSON.parse(raw) as Partial<Persisted>;
    const exp = p.experiment && p.experiment.status === 'running' ? { ...p.experiment, status: 'paused' as const } : (p.experiment ?? null);
    return { ...initial, ...p, experiment: exp };
  } catch {
    return initial;
  }
}

function buildRunner(s: Pick<Persisted, 'condition' | 'rules' | 'agent' | 'market' | 'steps' | 'docsAccess' | 'seed'>, upTo: number): EpisodeRunner {
  const r = startEpisode({ condition: s.condition, rules: s.rules, agent: s.agent, market: s.market, steps: s.steps, docsAccess: s.docsAccess }, s.seed);
  for (let i = 0; i < upTo && !r.done; i++) stepEpisode(r);
  return r;
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Persisted>(initial);
  const [hydrated, setHydrated] = useState(false);
  const [expCfg, setExpCfg] = useState<ExperimentConfig>(() => defaultExperiment(DEFAULT_RULES));
  const [simRunning, setSimRunning] = useState(false);
  const [speed, setSpeed] = useState(4);
  // シミュレーターの実行状態（stepEpisode で進める。n は再描画のための通し番号）
  const [sim, setSim] = useState<{ runner: EpisodeRunner; n: number }>(() => ({ runner: buildRunner(initial, 0), n: 0 }));
  const jobRef = useRef<{ run: ExperimentRun; stop: 'pause' | 'cancel' | null } | null>(null);
  const chunkRef = useRef<() => void>(() => undefined);

  // 初回: 保存した状態を読み込み、シミュレーションを同じステップまで再現する
  useEffect(() => {
    const p = load();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ブラウザの保存領域は描画後にしか読めないため
    setSim({ runner: buildRunner(p, p.simStep), n: 0 });
    setState(p);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // 保存できない環境（プライベートモードなど）でも動作を続ける
    }
  }, [state, hydrated]);

  const update = useCallback((patch: Partial<Persisted>) => setState((s) => ({ ...s, ...patch })), []);

  // シミュレーションの条件が変わったら、最初からやり直す（同じシード・同じ設定なら同じ結果）
  const simKey = JSON.stringify([state.condition, state.rules, state.agent, state.market, state.steps, state.docsAccess, state.seed]);
  const lastKey = useRef(simKey);
  useEffect(() => {
    if (!hydrated || lastKey.current === simKey) return;
    lastKey.current = simKey;
    // 設定の変更に合わせてシミュレーションを初期化する
    setSim({ runner: buildRunner(state, 0), n: 0 });
    setSimRunning(false);
    setState((s) => ({ ...s, simStep: 0 }));
  }, [simKey, hydrated, state]);

  const doStep = useCallback(() => {
    setSim((cur) => {
      if (cur.runner.done) return cur;
      // 決定論的: 同じ状態から同じ1ステップを進める（StrictMode で二重に呼ばれても、複製した状態から進めるため結果は同じ）
      const r: EpisodeRunner = structuredClone(cur.runner);
      stepEpisode(r);
      return { runner: r, n: cur.n + 1 };
    });
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 現在のステップを保存（リロード後に同じ状態を再現する）
    setState((s) => (s.simStep === sim.runner.market.t ? s : { ...s, simStep: sim.runner.market.t }));
    if (sim.runner.done) setSimRunning(false);
  }, [sim, hydrated]);

  // 速度は「1秒あたりのステップ数」だけを変える。各ステップの計算は同じなので、結果は速度に依存しない
  useEffect(() => {
    if (!simRunning) return;
    const t = setInterval(doStep, Math.max(30, 1000 / speed));
    return () => clearInterval(t);
  }, [simRunning, speed, doStep]);

  const simReset = useCallback(() => {
    setSimRunning(false);
    setSim({ runner: buildRunner(state, 0), n: 0 });
  }, [state]);

  // ---------- 実験のジョブ（条件 × エピソードを単位に、少しずつ実行する。一時停止・再開・取消は単位の境目で反映） ----------
  // 計算は状態の更新関数の外で行い、進捗は jobRef の実行記録から画面へ反映する（画面と実際のジョブの状態を一致させる）
  const runChunk = useCallback(() => {
    const job = jobRef.current;
    if (!job) return;
    const exp = job.run;
    if (job.stop) {
      const status: JobStatus = job.stop === 'pause' ? 'paused' : 'cancelled';
      const next = { ...exp, status, finishedAt: status === 'cancelled' ? new Date().toISOString() : null };
      jobRef.current = null;
      setState((s) => (s.experiment?.id === exp.id ? { ...s, experiment: next } : s));
      return;
    }
    const cfg = exp.snapshot;
    const t0 = performance.now();
    while (exp.done < exp.total && performance.now() - t0 < 30) {
      const c = cfg.conditions[Math.floor(exp.done / cfg.episodes)];
      const e = exp.done % cfg.episodes;
      exp.data = { ...exp.data, [c]: [...(exp.data[c] ?? []), runUnit(cfg, c, e)] };
      exp.done += 1;
    }
    const finished = exp.done >= exp.total;
    const snapshot: ExperimentRun = { ...exp, status: finished ? 'completed' : 'running', finishedAt: finished ? new Date().toISOString() : null };
    setState((s) => (s.experiment?.id === exp.id ? { ...s, experiment: snapshot } : s));
    if (finished) jobRef.current = null;
    else setTimeout(() => chunkRef.current(), 0);
  }, []);
  useEffect(() => {
    chunkRef.current = runChunk;
  }, [runChunk]);

  const runExperiment = useCallback(() => {
    // 開始時に条件を固定（スナップショット）。設定が前回と異なれば新しい版
    const snapshot: ExperimentConfig = { ...expCfg, rules: state.rules, agent: state.agent };
    const hash = configHash(snapshot);
    const version = state.experiment && state.experiment.hash === hash ? state.experiment.version : state.experimentVersion + 1;
    const run: ExperimentRun = {
      id: `exp-${hash}-v${version}-${Date.now().toString(36)}`,
      version,
      hash,
      snapshot,
      status: 'running',
      done: 0,
      total: snapshot.conditions.length * snapshot.episodes,
      data: {},
      startedAt: new Date().toISOString(),
      finishedAt: null,
      kind: 'deterministic_simulation_output',
    };
    jobRef.current = { run: { ...run }, stop: null };
    setState((s) => ({ ...s, experimentVersion: version, experiment: run }));
    setTimeout(() => chunkRef.current(), 0);
  }, [expCfg, state.rules, state.agent, state.experiment, state.experimentVersion]);

  const pauseExperiment = useCallback(() => {
    if (jobRef.current) jobRef.current.stop = 'pause';
  }, []);
  const cancelExperiment = useCallback(() => {
    if (jobRef.current) jobRef.current.stop = 'cancel';
    else setState((s) => (s.experiment && s.experiment.status === 'paused' ? { ...s, experiment: { ...s.experiment, status: 'cancelled', finishedAt: new Date().toISOString() } } : s));
  }, []);
  const resumeExperiment = useCallback(() => {
    const exp = state.experiment;
    if (!exp || exp.status !== 'paused') return;
    // 保存済みの進捗（完了した単位）から再開する
    jobRef.current = { run: { ...exp, status: 'running' }, stop: null };
    setState((s) => (s.experiment ? { ...s, experiment: { ...s.experiment, status: 'running' } } : s));
    setTimeout(() => chunkRef.current(), 0);
  }, [state.experiment]);

  const resetAll = useCallback(() => {
    jobRef.current = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      // 無視
    }
    setSim({ runner: buildRunner(initial, 0), n: 0 });
    setState(initial);
    setExpCfg(defaultExperiment(DEFAULT_RULES));
    setSimRunning(false);
  }, []);

  const runner = sim.runner;
  const scenarioId = `scn-${state.seed}-${state.market.initialPrice}-${state.market.trend}`;
  const ruleVersion = `v${state.rules.version}`;
  const runId = `run-${configHash({ ...expCfg, rules: state.rules, agent: state.agent, conditions: [state.condition], baseSeed: state.seed, docsAccess: state.docsAccess } as ExperimentConfig)}`;

  const value = useMemo<Ctx>(
    () => ({
      ...state,
      hydrated,
      update,
      runId,
      scenarioId,
      ruleVersion,
      runner,
      trace: runner.trace,
      simRunning,
      speed,
      setSpeed,
      simStart: () => {
        if (runner.done) return;
        setSimRunning(true);
      },
      simPause: () => setSimRunning(false),
      simStepForward: () => {
        setSimRunning(false);
        doStep();
      },
      simReset,
      experimentConfig: expCfg,
      setExperimentConfig: (p) => setExpCfg((c) => ({ ...c, ...p })),
      runExperiment,
      pauseExperiment,
      resumeExperiment,
      cancelExperiment,
      resetAll,
    }),
    [state, hydrated, update, runId, scenarioId, ruleVersion, runner, simRunning, speed, doStep, simReset, expCfg, runExperiment, pauseExperiment, resumeExperiment, cancelExperiment, resetAll],
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): Ctx {
  const c = useContext(DemoContext);
  if (!c) throw new Error('DemoProvider がありません');
  return c;
}

export { episodeSeed };
