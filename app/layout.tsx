import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UniPortal',
  description: '大学ポータル連携アプリ',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
