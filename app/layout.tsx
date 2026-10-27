import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '規制解釈AI 研究コンソール',
  description: '規制解釈AIの研究実験・API連携管理',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
