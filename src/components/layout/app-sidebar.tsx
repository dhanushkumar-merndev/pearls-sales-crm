"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { LogOut } from "lucide-react";
import { HospitalLogo } from "@/components/shared/hospital-logo";
import { signOut } from "@/app/(auth)/login/actions";
import { getActiveNavigationHref, groupNavigation, ROLE_NAVIGATION } from "./navigation";
import type { Profile } from "@/types/hospital";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

function NavIcon({ name }: { name: string }) {
  const key = name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("") as keyof typeof Icons;
  const Icon = Icons[key] as React.ComponentType<{ className?: string }> | undefined;
  return Icon ? <Icon className="size-4" /> : <Icons.Circle className="size-4" />;
}

export function AppSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();
  const items = ROLE_NAVIGATION[profile.role];
  const activeHref = getActiveNavigationHref(items, pathname);
  const groups = groupNavigation(
    items,
    profile.role === "admin" ? "Hospital" : "Workspace",
  );
  return (
    <Sidebar collapsible="icon" className="min-h-0" data-app-shell>
      <SidebarHeader className="border-b border-sidebar-border p-3 group-data-[collapsible=icon]:p-2">
        <Link
          className="flex min-h-10 items-center gap-3 overflow-hidden group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:justify-center"
          href="/dashboard"
          onClick={() => isMobile && setOpenMobile(false)}
        >
          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full transition-[width,height] duration-200 ease-linear group-data-[collapsible=icon]:size-9">
            <HospitalLogo size={48} className="size-full" />
          </span>
          {/* Opacity fade — w-0 removes layout space in collapsed state */}
          <span className="min-w-0 w-full overflow-hidden transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
            <span className="block truncate font-display text-lg leading-tight font-semibold tracking-wide">Pearl</span>
            <span className="block truncate text-xs text-sidebar-foreground/65">Aesthetic &amp; Wellness Clinic</span>
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent
        className="overscroll-contain group-data-[collapsible=icon]:overflow-y-auto!"
        onClick={() => isMobile && setOpenMobile(false)}
      >
        {groups.map((group) => <SidebarGroup className="group-data-[collapsible=icon]:px-2" key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    className="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                    render={<Link href={item.href} />}
                    isActive={activeHref === item.href}
                    tooltip={{ children: item.title, sideOffset: 10 }}
                  >
                    <NavIcon name={item.icon} />
                    {/* Fade + collapse layout so icon is centered in hover box */}
                    <span className="overflow-hidden transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
                      {item.title}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>)}
      </SidebarContent>
      <SidebarFooter className="shrink-0 border-t border-sidebar-border bg-sidebar p-2">
        <div className="flex items-center gap-2 p-1 group-data-[collapsible=icon]:justify-center">
          <Avatar className="size-8">
            <AvatarFallback>
              {profile.fullName
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 overflow-hidden transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
            <p className="truncate text-sm font-medium">{profile.fullName}</p>
            <Badge data-testid="current-role" variant="secondary" className="mt-0.5 capitalize">
              {profile.role}
            </Badge>
          </div>
          <form
            action={signOut}
            className="overflow-hidden transition-opacity duration-200 ease-linear group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0"
          >
            <button
              aria-label="Sign out"
              className="rounded-md p-2 hover:bg-sidebar-accent"
              type="submit"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
