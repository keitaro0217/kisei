import { json, readJson, withAuth } from '@/lib/server/api';
import { createRulesFromTemplate } from '@/lib/server/domain/studio';

/** ドメインの雛形から規則の版を作る（規則文書・承認済みの目的に関連付け） */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json(await createRulesFromTemplate(await readJson(request), principal), 201));
}
