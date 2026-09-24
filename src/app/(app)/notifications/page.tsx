"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CheckCheck,
  CircleAlert,
  Clock3,
  LoaderCircle,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { NotificationResponse } from "@/types/notifications";

const notificationQueryKey = ["hospital-notifications"] as const;
const pageSize = 10;

async function markNotificationsRead(ids: string[]) {
  const response = await fetch("/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) throw new Error("Notifications could not be updated");
}

function pageHref(page: number) {
  return `/notifications?page=${page}`;
}

export default function NotificationsPage() {
  const searchParams = useSearchParams();
  const parsedPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const queryClient = useQueryClient();
  const pageQueryKey = [...notificationQueryKey, "all", requestedPage] as const;
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: pageQueryKey,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        `/api/notifications?scope=all&page=${requestedPage}&pageSize=${pageSize}`,
        { signal, cache: "no-store" },
      );
      if (!response.ok) throw new Error("Notifications unavailable");
      return (await response.json()) as NotificationResponse;
    },
  });

  const markRead = useMutation({
    mutationFn: markNotificationsRead,
    onMutate: (ids) => {
      const selected = new Set(ids);
      queryClient.setQueryData<NotificationResponse>(pageQueryKey, (current) => {
        if (!current) return current;
        const newlyRead = current.items.filter(
          (item) => selected.has(item.id) && !item.read,
        ).length;
        return {
          ...current,
          items: current.items.map((item) =>
            selected.has(item.id) ? { ...item, read: true } : item,
          ),
          unreadCount: Math.max(0, current.unreadCount - newlyRead),
        };
      });
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: notificationQueryKey }),
  });

  const unreadIds = data?.items
    .filter((item) => !item.read)
    .map((item) => item.id) ?? [];
  const pagination = data?.pagination ?? {
    page: requestedPage,
    pageSize,
    totalItems: 0,
    totalPages: 1,
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="All current operational alerts for your role, including alerts you have read"
        actions={
          unreadIds.length ? (
            <Button
              variant="outline"
              disabled={markRead.isPending}
              onClick={() => markRead.mutate(unreadIds)}
            >
              {markRead.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <CheckCheck />
              )}
              Mark page as read
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-4 p-4">
              {[1, 2, 3, 4].map((item) => (
                <div className="flex gap-3" key={item}>
                  <Skeleton className="size-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="p-10 text-center text-sm text-destructive">
              Notifications could not be loaded. Please try again.
            </div>
          ) : data?.items.length ? (
            <div className={cn("divide-y", isFetching && "opacity-70")}>
              {data.items.map((item) => {
                const Icon = item.tone === "critical" ? CircleAlert : Clock3;
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex flex-col gap-3 p-4 sm:flex-row sm:items-center",
                      !item.read && "bg-accent/35",
                    )}
                  >
                    <div className="flex min-w-0 flex-1 gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground",
                          item.tone === "critical" &&
                            "bg-destructive/10 text-destructive",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{item.title}</p>
                          <Badge variant={item.read ? "secondary" : "default"}>
                            {item.read ? "Read" : "Unread"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-2">
                      {!item.read ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={markRead.isPending}
                          onClick={() => markRead.mutate([item.id])}
                        >
                          <CheckCheck /> Mark read
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        render={
                          <Link
                            href={item.href}
                            onClick={() => {
                              if (!item.read) markRead.mutate([item.id]);
                            }}
                          />
                        }
                      >
                        Open <ArrowRight />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              <Bell className="mx-auto mb-3 size-6" />
              No operational notifications right now.
            </div>
          )}

          <div className="flex flex-col gap-3 border-t bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-center text-xs text-muted-foreground sm:text-left">
              Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems}{" "}
              notification{pagination.totalItems === 1 ? "" : "s"}
            </p>
            <Pagination className="mx-0 w-auto justify-center sm:justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href={pagination.page > 1 ? pageHref(pagination.page - 1) : "#"}
                    aria-disabled={pagination.page <= 1}
                    tabIndex={pagination.page <= 1 ? -1 : undefined}
                    className={cn(
                      pagination.page <= 1 && "pointer-events-none opacity-50",
                    )}
                  />
                </PaginationItem>
                <PaginationItem>
                  <PaginationLink href={pageHref(pagination.page)} isActive>
                    {pagination.page}
                  </PaginationLink>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    href={
                      pagination.page < pagination.totalPages
                        ? pageHref(pagination.page + 1)
                        : "#"
                    }
                    aria-disabled={pagination.page >= pagination.totalPages}
                    tabIndex={
                      pagination.page >= pagination.totalPages ? -1 : undefined
                    }
                    className={cn(
                      pagination.page >= pagination.totalPages &&
                        "pointer-events-none opacity-50",
                    )}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
