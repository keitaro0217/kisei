// PoC（概念実証）の価値測定の共有型。
// 人が入力した値（実測・推定を区別）と、研究データから自動で集計した値を分けて扱う。

export type MeasureKind = 'measured' | 'estimated';

export type TimeEntry = {
  id: string;
  /** baseline: 従来の作業時間 / human: kisei 利用時の人の作業時間 */
  phase: 'baseline' | 'human';
  activity: 'risk_review' | 'patch_drafting' | 'reverification' | 'reporting' | 'other';
  minutes: number;
  kind: MeasureKind;
  note: string;
  at: string;
  by: string;
};

/** 比較対象（従来のルールチェッカー・人の専門家）との検出の比較。専門家の確認状態を必ず持つ */
export type ExpertFinding = {
  id: string;
  title: string;
  /** kisei の Failure クラスター（あれば） */
  fingerprint: string | null;
  foundByRuleChecker: boolean | null;
  foundByExpert: boolean | null;
  foundByKisei: boolean;
  expertReview: 'confirmed' | 'false_positive' | 'unreviewed';
  severity: 'low' | 'medium' | 'high' | null;
  note: string;
};

export type PocProject = {
  id: string;
  name: string;
  purpose: string;
  comparisonTargets: string;
  studyIds: string[];
  timeEntries: TimeEntry[];
  findings: ExpertFinding[];
  limitations: string;
  remainingIssues: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type PocMetrics = {
  dataNotice: string[];
  time: {
    baselineMinutes: number;
    humanMinutes: number;
    /** システムの処理時間（研究のセッションの実行時間の合計）。人の作業時間とは別に表示する */
    systemMinutes: number;
    savedMinutes: number | null;
    baselineEstimated: boolean;
    humanEstimated: boolean;
    byActivity: Record<string, { baseline: number; human: number }>;
  };
  detection: {
    /** 専門家が確認した発見（kisei の Failure で確認済み + 比較表で確認済み） */
    confirmedFindings: number;
    /** 形式判定（従来のルールチェッカー相当）では検出できず、専門家が確認した発見 */
    novelFindings: number;
    falsePositives: number;
    /** 専門家が見つけ、kisei が見逃した発見 */
    falseNegatives: number;
    /** 未確認の疑い（発見としては数えない） */
    unreviewed: number;
    detectionCoverage: number | null;
    clusters: number;
  };
  patches: {
    generated: number;
    expertValid: number;
    recommended: number;
    reverified: number;
    regressionPassed: number;
    medianReviewMinutes: number | null;
  };
  sideEffects: {
    meanFalseRejectionIncrease: number | null;
    newFailures: number;
    meanLatencyIncreaseSeconds: number | null;
    costIncreaseUsd: number | null;
  };
  auditability: {
    /** 証拠（トレース）付きの Failure の割合 */
    evidenceLinkedRate: number | null;
    /** 再現性を確保した実験の割合（凍結ハッシュあり、かつモック＝決定論的 または コードのバージョンを記録） */
    reproducibleRate: number | null;
    /** トレースが記録されたセッションの割合（追跡可能なモデル呼び出し） */
    traceableRate: number | null;
    /** 承認の履歴が記録された修正案の割合 */
    approvalRecordedRate: number | null;
    /** トレースのない完了済みセッション */
    unrecordedSessions: number;
  };
};
