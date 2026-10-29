'use client';

export default function PrintButton() {
  return (
    <div className="print:hidden" style={{ marginBottom: 16 }}>
      <button type="button" onClick={() => window.print()} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #999', background: '#f5f5f5', cursor: 'pointer' }}>
        印刷 / PDF として保存
      </button>
      <span style={{ marginLeft: 12, fontSize: 12, color: '#555' }}>ブラウザの印刷画面で「PDF に保存」を選んでください。</span>
    </div>
  );
}
