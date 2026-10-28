import { RULE_VARIABLES } from '@/lib/research/study-types';
import { json, readJson, withAuth } from '@/lib/server/api';
import { listRules, RULE_TEMPLATES, saveRuleVersion } from '@/lib/server/research/study/rules';

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json({ rules: await listRules(), variables: RULE_VARIABLES, templates: RULE_TEMPLATES }));
}

/** 規則の新しい版を保存する（既存の版は変更しない） */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ rule: await saveRuleVersion(await readJson(request, 256 * 1024), principal) }, 201));
}
