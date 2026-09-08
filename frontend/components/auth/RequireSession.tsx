"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/lib/session";

export function RequireSession({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, hydrated } = useSession();

  useEffect(() => {
    if (hydrated && !user) {
      router.replace("/connexion");
    }
  }, [user, hydrated, router]);

  if (!hydrated || !user) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {children}
    </div>
  );
}
