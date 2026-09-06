"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/lib/session";

export default function HomePage() {
  const router = useRouter();
  const { user, hydrated } = useSession();

  useEffect(() => {
    if (!hydrated) return;
    router.replace(
      !user ? "/connexion" : user.role === "administrateur" ? "/admin" : "/chat",
    );
  }, [router, user, hydrated]);

  return null;
}
