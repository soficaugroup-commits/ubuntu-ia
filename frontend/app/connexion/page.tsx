"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { useSession } from "@/lib/session";

export default function ConnexionPage() {
  const router = useRouter();
  const { user, hydrated } = useSession();

  useEffect(() => {
    if (hydrated && user) {
      router.replace(user.role === "administrateur" ? "/admin" : "/chat");
    }
  }, [user, hydrated, router]);

  return <LoginForm />;
}
