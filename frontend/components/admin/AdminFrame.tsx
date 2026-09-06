"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { copy } from "@/content/fr";
import { useSession } from "@/lib/session";

export function AdminFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();

  if (user?.role !== "administrateur") {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto px-3 py-8 sm:px-4 sm:py-12">
        <EmptyState
          title={copy.admin.forbiddenTitle}
          body={copy.admin.forbiddenBody}
          action={
            <Link
              href="/chat"
              className="neo-bubble inline-flex min-h-11 items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-inverse hover:bg-brand-hover"
            >
              {copy.admin.forbiddenAction}
            </Link>
          }
        />
      </main>
    );
  }

  const tabs = [
    { href: "/admin", label: copy.admin.tabs.documents, exact: true },
    { href: "/admin/acces", label: copy.admin.tabs.access, exact: false },
    { href: "/admin/domaines", label: copy.admin.tabs.domains, exact: false },
  ];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 overflow-y-auto px-3 py-4 sm:gap-6 sm:px-4 sm:py-6">
      <nav aria-label={copy.admin.tabs.label} className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const current = tab.exact
            ? pathname === tab.href
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                current ? "neo-pressed text-content" : "text-content-muted hover:text-content"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </main>
  );
}
