import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { DemoProvider } from '@/components/demo/DemoStore';
import Shell from '@/components/demo/Shell';

export const metadata: Metadata = {
  title: 'Kisei Research Lab — Regulatory Intent & Autonomous Agent Behavior',
  description: '自律型金融取引エージェントの規制趣旨からの逸脱を、合成規制サンドボックスで体験・検証する研究デモ',
};

export default function DemoLayout({ children }: { children: ReactNode }) {
  return (
    <DemoProvider>
      <Shell>{children}</Shell>
    </DemoProvider>
  );
}
