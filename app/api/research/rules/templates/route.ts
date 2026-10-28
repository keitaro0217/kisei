import { json, readJson, withAuth } from '@/lib/server/api';
import { createPairFromTemplate } from '@/lib/server/research/study/rules';

/** 雛形から条文A・Bの版とミニマルペアを作成する */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => {
    const { templateId } = await readJson(request);
    return json(await createPairFromTemplate(String(templateId ?? ''), principal), 201);
  });
}
