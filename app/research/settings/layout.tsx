import { SettingsTabs } from '@/components/research/ResearchShell';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SettingsTabs />
      {children}
    </>
  );
}
