import { json, readJson, withAuth } from '@/lib/server/api';
import { detectFailures } from '@/lib/server/research/failure/failures';

export const maxDuration = 60;

/** 研究の判断から Failure を検出して登録する（同じ判断は重複して登録しない） */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => {
    const { studyId } = await readJson(request);
    return json(await detectFailures(String(studyId ?? ''), principal));
  });
}
