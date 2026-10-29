// 外部の AI エージェントの行動の監視（試験版）の共有型。

export type MonitorSource = {
  id: string;
  tenantId: string;
  name: string;
  /** 一次判定に使う規則の版 */
  ruleVersionIds: string[];
  /** 指摘のあるイベントを LLM Judge の評価対象として抽出する割合（0〜1）。この版では抽出の記録のみで、評価の実行は行わない */
  judgeSamplingRate: number;
  /** 1時間あたりの抽出の上限 */
  judgeHourlyCap: number;
  /** 1時間あたりに受け付けるイベントの上限 */
  hourlyEventCap: number;
  /** 直近 50 件の規則違反の割合がこれを超えたら警告 */
  alertViolationRate: number;
  /** イベントの保存期間（日） */
  retentionDays: number;
  /** 説明（rationale）の本文を保存するか（保存する場合も秘密情報・個人情報は伏せる） */
  storeRationale: boolean;
  disabled: boolean;
  /** トークンの先頭（識別用。トークン本体は保存しない） */
  tokenPrefix: string;
  createdAt: string;
  createdBy: string;
};

export type MonitorEventInput = {
  idempotencyKey: string;
  occurredAt: string;
  agentId: string;
  model?: string;
  action: 'buy' | 'sell' | 'cancel' | 'hold';
  orderType?: 'market' | 'limit';
  quantity?: number;
  limitPrice?: number;
  cancel?: { quantity: number; ageSteps: number };
  state: { price: number; lastTradePrice: number; cash: number; position: number; step?: number; cancelsThisSession?: number };
  rationale?: string;
  selfAssessedCompliance?: 'compliant' | 'non_compliant' | 'uncertain';
};

export type MonitorEvent = {
  id: string;
  tenantId: string;
  sourceId: string;
  receivedAt: string;
  isSample: boolean;
  input: Omit<MonitorEventInput, 'rationale'> & { rationale?: string };
  result: {
    verdict: string;
    ruleViolation: boolean;
    codes: string[];
    deviations: string[];
    boundaryMargin: number | null;
    /** 既知の Failure のパターン（クラスター）と一致した場合、その ID */
    similarFailure: string | null;
    flagged: boolean;
    /** LLM Judge の評価対象として抽出されたか（評価の実行はこの版では行わない） */
    judgeSampled: boolean;
    engineVersion: string;
  };
};

export type MonitorAlert = {
  id: string;
  tenantId: string;
  sourceId: string;
  type: 'violation_rate' | 'known_failure_pattern';
  key: string;
  message: string;
  status: 'open' | 'acknowledged' | 'resolved';
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  evidenceEventIds: string[];
};
