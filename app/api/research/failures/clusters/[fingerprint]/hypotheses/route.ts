import { json, withAuth } from '@/lib/server/api';
import { generateHypotheses } from '@/lib/server/research/failure/rootCause';

/** クラスターの原因候補（仮説）を生成する */
export async function POST(request: Request, ctx: { params: Promise<{ fingerprint: string }> }) {
  return withAuth(request, 'research:run', async (principal) => {
    const { fingerprint } = await ctx.params;
    return json({ hypotheses: await generateHypotheses(fingerprint, principal) }, 201);
  });
}
