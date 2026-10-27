import SyncBanner from '@/components/SyncBanner';
import TabBar from '@/components/TabBar';
import { PortalProvider } from '@/store/portalStore';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalProvider>
      <div className="min-h-screen bg-[#F8F9FA]">
        <SyncBanner />
        <main className="max-w-md mx-auto pb-24">{children}</main>
        <TabBar />
      </div>
    </PortalProvider>
  );
}
