"use client";

import type { ReactNode } from "react";
import { DocumentsProvider } from "@/lib/documents-store";
import { SessionProvider } from "@/lib/session";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <DocumentsProvider>{children}</DocumentsProvider>
    </SessionProvider>
  );
}
