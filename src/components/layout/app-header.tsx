import { SidebarTrigger } from "@/components/ui/sidebar";
import { HeaderPageTitle } from "./page-title";
import { NotificationMenu } from "./notification-menu";

export function AppHeader() {
  return (
    <header
      data-app-shell
      className="z-20 flex h-14 shrink-0 min-w-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:gap-3 sm:px-5"
    >
      <div className="flex shrink-0 items-center">
        <SidebarTrigger className="size-9" />
      </div>
      {/* The page's own heading sits here on a phone, where the bar is
          otherwise empty and vertical space is scarce. */}
      <HeaderPageTitle />
      <div className="ml-auto shrink-0">
        <NotificationMenu />
      </div>
    </header>
  );
}
