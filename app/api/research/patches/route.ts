import { json, readJson, withAuth } from '@/lib/server/api';
import { generatePatches } from '@/lib/server/research/patch/patches';
import { patchOverview } from '@/lib/server/research/patch/regression';

/** 修正案の一覧（最新の回帰テストとパレート最適かどうか） */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json({ items: await patchOverview() }));
}

/** Failure のクラスター、または原因の候補から修正案を作る */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ patches: await generatePatches(await readJson(request), principal) }, 201));
}
