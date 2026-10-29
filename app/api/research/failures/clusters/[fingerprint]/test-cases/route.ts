import { json, readJson, withAuth } from '@/lib/server/api';
import { generateTestCases } from '@/lib/server/research/failure/failures';

/** クラスターの代表的な Failure からテストケースの候補を作る */
export async function POST(request: Request, ctx: { params: Promise<{ fingerprint: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { fingerprint } = await ctx.params;
    const { max } = await readJson(request);
    const n = Number(max ?? 3);
    return json(await generateTestCases(fingerprint, principal, Number.isInteger(n) && n >= 1 && n <= 20 ? n : 3), 201);
  });
}
