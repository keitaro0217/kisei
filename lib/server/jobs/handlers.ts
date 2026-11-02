import { getDb } from '../db';
import { log } from '../log';
import { detectFailures } from '../research/failure/failures';
import { getSettings } from '../research/settings';
import { purgeTracesOlderThan } from '../storage/traceStore';
import { registerJobHandler } from './queue';
import type { Principal } from '../auth/types';

// ジョブの種類と処理。処理は冪等にする（同じジョブが再試行・二重実行されても結果が変わらない）。

/** システムが自動で行う処理の実行者（監査ログに記録する） */
export const SYSTEM_ACTOR: Principal = { id: 'system:jobs', displayName: '自動処理', tenantId: 'default', permissions: [], authMethod: 'development' };

/** 保存期間と削除ポリシー: トレース（設定の日数）、終了したジョブ（30日）、ログイン試行の記録（1日） */
export const RETENTION = { finishedJobsDays: 30, authAttemptsDays: 1 } as const;

let registered = false;
export function registerJobHandlers() {
  if (registered) return;
  registered = true;

  registerJobHandler('maintenance.retention', async () => {
    const { traceRetentionDays } = (await getSettings()).observability;
    const traces = await purgeTracesOlderThan(traceRetentionDays);
    const db = await getDb();
    const jobs = (await db.query(`DELETE FROM rc_jobs WHERE finished_at < now() - ($1::int * interval '1 day') RETURNING 1`, [RETENTION.finishedJobsDays])).length;
    const attempts = (
      await db.query(`DELETE FROM rc_auth_attempts WHERE window_start < now() - ($1::int * interval '1 day') AND (locked_until IS NULL OR locked_until < now()) RETURNING 1`, [RETENTION.authAttemptsDays])
    ).length;
    if (traces || jobs || attempts) log.info('retention.purged', { traces, jobs, authAttempts: attempts, traceRetentionDays });
    return { traces, jobs, authAttempts: attempts };
  });

  // 研究の完了後に Failure（規則違反・趣旨からの逸脱など）を自動で検出する（同じ判断は重複して登録されない）
  registerJobHandler('study.detect_failures', async (job) => {
    const studyId = String(job.payload.studyId ?? '');
    return detectFailures(studyId, SYSTEM_ACTOR);
  });
}
