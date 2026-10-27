import { json, withAuth } from '@/lib/server/api';
import { fetchModels, getProviderRecord, toDTO } from '@/lib/server/research/providers';

// プロバイダーのAPIから利用可能なモデル一覧を取得する（固定値は使わない）
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withAuth(request, 'settings:write', async () => {
    const { id } = await ctx.params;
    const models = await fetchModels(id);
    const record = await getProviderRecord(id);
    return json({ models, provider: record ? toDTO(record) : null });
  });
}
