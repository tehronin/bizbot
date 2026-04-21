import type { ReactNode } from "react";
import { DashboardShellStateProvider } from "@/components/layout/DashboardShellStateProvider";
import Sidebar from "@/components/layout/Sidebar";
import Header from "@/components/layout/Header";
import SidecarHost from "@/components/layout/SidecarHost";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardShellStateProvider>
      <div className="min-h-screen flex bg-base text-primary">
        <Sidebar />
        <div className="flex-1 min-w-0 flex flex-col">
          <Header />
          <main className="flex-1 px-5 py-4 overflow-auto">{children}</main>
          <SidecarHost />
        </div>
      </div>
    </DashboardShellStateProvider>
  );
}
