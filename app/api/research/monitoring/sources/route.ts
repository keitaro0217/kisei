import { json, readJson, withAuth } from '@/lib/server/api';
import { createSource } from '@/lib/server/research/monitor/monitor';

/** 接続元の作成。トークンはこの応答でだけ返す（保存するのはハッシュのみ） */
export async function POST(request: Request) {
  return withAuth(request, 'settings:write', async (principal) => json(await createSource(await readJson(request), principal), 201));
}
