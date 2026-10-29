import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { authenticateHeaders } from '@/lib/server/auth';
import { computePocMetrics, getPoc, pocMarkdown } from '@/lib/server/research/poc/poc';
import { getStudy } from '@/lib/server/storage/studyStore';
import PrintButton from './PrintButton';

// PoC レポートの印刷用ページ（ブラウザの印刷機能で PDF として保存する）。研究コンソールの外枠を使わず、白地で表示する。

function renderMarkdown(md: string) {
  return md.split('\n').map((line, i) => {
    if (line.startsWith('# ')) return <h1 key={i} style={{ fontSize: 22, margin: '0 0 12px' }}>{line.slice(2)}</h1>;
    if (line.startsWith('## ')) return <h2 key={i} style={{ fontSize: 16, margin: '20px 0 6px', borderBottom: '1px solid #ddd', paddingBottom: 4 }}>{line.slice(3)}</h2>;
    if (line.startsWith('> ')) return <p key={i} style={{ background: '#fff4e5', padding: '6px 10px', margin: '6px 0', fontSize: 13 }}>{line.slice(2)}</p>;
    if (line.startsWith('- ')) return <li key={i} style={{ marginLeft: 18, fontSize: 13 }}>{line.slice(2).replace(/`/g, '')}</li>;
    if (line === '---') return <hr key={i} />;
    if (!line.trim()) return null;
    return <p key={i} style={{ fontSize: 13, margin: '4px 0' }}>{line}</p>;
  });
}

export default async function PocPrintPage({ params }: { params: Promise<{ id: string }> }) {
  if (!authenticateHeaders(await headers()).ok) redirect('/login');
  const { id } = await params;
  const poc = await getPoc(id);
  if (!poc) notFound();
  const metrics = await computePocMetrics(poc);
  const studies = [];
  for (const sid of poc.studyIds) {
    const s = await getStudy(sid);
    if (s) studies.push({ id: s.id, title: s.design.title, isMock: s.isMock, frozenHash: s.frozenHash });
  }
  return (
    <main style={{ background: '#fff', color: '#111', minHeight: '100vh', padding: '32px 40px', fontFamily: "'Hiragino Sans','Noto Sans JP',system-ui,sans-serif", lineHeight: 1.7 }}>
      <PrintButton />
      <article style={{ maxWidth: 800 }}>{renderMarkdown(pocMarkdown(poc, metrics, studies))}</article>
    </main>
  );
}
