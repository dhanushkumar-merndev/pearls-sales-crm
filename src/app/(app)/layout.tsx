import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { OperationalLiveSync } from "@/components/layout/operational-live-sync";
import { PageTitleProvider } from "@/components/layout/page-title";
import { getCurrentProfile } from "@/lib/auth/dal";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await getCurrentProfile();
  return (
    <SidebarProvider className="h-svh min-h-0 overflow-hidden" data-app-viewport>
      <PageTitleProvider>
      <OperationalLiveSync role={profile.role} />
      <AppSidebar profile={profile} />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <AppHeader />
        <div
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-5 lg:p-6"
          data-app-workspace
        >
          {/* Any page content that would otherwise force the whole shell wider
              on a narrow phone (an un-wrapped button row, a table) clips here
              instead -- individual pages scope their own horizontal scroll
              (e.g. a table's own overflow-x-auto wrapper) where content is
              genuinely meant to scroll sideways. */}
          {children}
        </div>
      </SidebarInset>
      </PageTitleProvider>
    </SidebarProvider>
  );
}
