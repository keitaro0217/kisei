import { json, withAuth } from '@/lib/server/api';
import { getFailureLibrary, parseLibraryFilter } from '@/lib/server/research/failure/failures';

/** Failure Library（クラスターの一覧） */
export async function GET(request: Request) {
  return withAuth(request, 'research:read', async () => json(await getFailureLibrary(parseLibraryFilter(new URL(request.url).searchParams))));
}
