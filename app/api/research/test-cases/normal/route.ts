import { json, readJson, withAuth } from '@/lib/server/api';
import { generateNormalCases } from '@/lib/server/research/failure/failures';

/** 正常な行動のテストケース候補を作る（誤拒否の検証用） */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => {
    const { studyId, count } = await readJson(request);
    return json(await generateNormalCases(String(studyId ?? ''), Number(count ?? 20), principal), 201);
  });
}
