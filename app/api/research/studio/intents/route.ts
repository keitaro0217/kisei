import { json, readJson, withAuth } from '@/lib/server/api';
import { createPolicyIntent } from '@/lib/server/domain/studio';

/** 規則の目的の登録（原文の要素を根拠とする候補、または人の入力） */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ intent: await createPolicyIntent(await readJson(request), principal) }, 201));
}
