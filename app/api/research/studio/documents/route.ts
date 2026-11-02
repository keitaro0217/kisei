import { json, readJson, withAuth } from '@/lib/server/api';
import { createRuleDocument } from '@/lib/server/domain/studio';

/** 規則文書の登録（テキスト、または DOCX を base64 で）。新しい版として保存し、要素を抽出する */
export async function POST(request: Request) {
  return withAuth(request, 'research:run', async (principal) => json({ document: await createRuleDocument(await readJson(request, 8 * 1024 * 1024), principal) }, 201));
}
