import { json, withAuth } from '@/lib/server/api';
import { listBusinessProcesses, listPolicyIntents, listRuleDocuments, studioCatalog } from '@/lib/server/domain/studio';

/** Rule & Intent Studio の一覧（評価環境・雛形・規則文書・業務プロセス・規則の目的） */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () =>
    json({ ...studioCatalog(), documents: await listRuleDocuments(), processes: await listBusinessProcesses(), intents: await listPolicyIntents() }),
  );
}
