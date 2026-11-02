import { json, readJson, withAuth } from '@/lib/server/api';
import { createLabelSet, listLabelSets } from '@/lib/server/research/eval/validationService';

/** 外部ラベル付きデータセット */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json({ sets: await listLabelSets() }));
}

export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ set: await createLabelSet(await readJson(request), principal) }, 201));
}
