import { json, readJson, withAuth } from '@/lib/server/api';
import { createBusinessProcess } from '@/lib/server/domain/studio';

/** 業務プロセス（AI の業務の目標・行動の範囲・適用する規則）の登録（新しい版） */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ process: await createBusinessProcess(await readJson(request), principal) }, 201));
}
