import { json, readJson, withAuth } from '@/lib/server/api';
import { listPrompts, savePromptVersion } from '@/lib/server/research/study/rules';

export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json({ prompts: await listPrompts() }));
}

/** プロンプトの新しい版を保存する */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ prompt: await savePromptVersion(await readJson(request, 128 * 1024), principal) }, 201));
}
