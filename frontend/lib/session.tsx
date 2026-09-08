"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { listAllowedDomains } from "@/lib/allowed-domains";
import { emailDomain } from "@/lib/domains";
import { supabaseBrowser } from "@/lib/supabase";
import type { AccountStatus, SessionUser, UserRole } from "@/lib/types";

const FAILURES_KEY = "ubuntu-ia.auth-failures";
const LOCK_KEY = "ubuntu-ia.auth-lock";
const LOCK_AFTER = 5;
const LOCK_MS = 5 * 60 * 1000;

type AuthErrorCode =
  | "emailRequired"
  | "emailFormat"
  | "emailDomain"
  | "passwordRequired"
  | "passwordLength"
  | "credentials"
  | "locked"
  | "suspended"
  | "unavailable";

export type AuthResult =
  | { ok: true; role: UserRole }
  | {
      ok: false;
      field?: "email" | "password" | "form";
      code: AuthErrorCode;
      domains?: string[];
    };

type SessionContextValue = {
  user: SessionUser | null;
  hydrated: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

async function allowedDomainNames(): Promise<string[] | null> {
  const rows = await listAllowedDomains();
  if (!rows) return null;
  return rows.map((item) => item.domaine);
}

function isLocked(): boolean {
  const until = Number(window.sessionStorage.getItem(LOCK_KEY) ?? "0");
  return until > Date.now();
}

function asRole(value: unknown): UserRole | null {
  if (value === "administrateur" || value === "utilisateur") return value;
  return null;
}

function asStatus(value: unknown): AccountStatus {
  return value === "suspendu" ? "suspendu" : "actif";
}

async function loadProfile(userId: string): Promise<SessionUser | null> {
  const supabase = supabaseBrowser();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("users")
    .select("id, email, role, organisation, prenom, nom, statut")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const role = asRole(data.role);
  if (!role) return null;
  return {
    id: data.id,
    email: data.email,
    role,
    organisation: data.organisation ?? "SOFICAU UBUNTU GROUP",
    prenom: data.prenom,
    nom: data.nom,
    statut: asStatus(data.statut),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) {
      setHydrated(true);
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        if (!session?.user) {
          setUser(null);
          setHydrated(true);
          return;
        }
        const profile = await loadProfile(session.user.id);
        if (!profile || profile.statut === "suspendu") {
          await supabase.auth.signOut();
          setUser(null);
          setHydrated(true);
          return;
        }
        const domains = await allowedDomainNames();
        const domain = emailDomain(profile.email);
        if (domains && domain && !domains.includes(domain)) {
          await supabase.auth.signOut();
          setUser(null);
          setHydrated(true);
          return;
        }
        setUser(profile);
        setHydrated(true);
      })();
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const trimmed = email.trim().toLowerCase();

    if (isLocked()) {
      return { ok: false, field: "form", code: "locked" };
    }
    if (!trimmed) {
      return { ok: false, field: "email", code: "emailRequired" };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { ok: false, field: "email", code: "emailFormat" };
    }
    const domains = await allowedDomainNames();
    if (!domains) {
      return { ok: false, field: "form", code: "unavailable" };
    }
    const domain = emailDomain(trimmed);
    if (!domain || !domains.includes(domain)) {
      return { ok: false, field: "email", code: "emailDomain", domains };
    }
    if (!password) {
      return { ok: false, field: "password", code: "passwordRequired" };
    }
    if (password.length < 8) {
      return { ok: false, field: "password", code: "passwordLength" };
    }

    const supabase = supabaseBrowser();
    if (!supabase) {
      return { ok: false, field: "form", code: "unavailable" };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });
    if (error || !data.user) {
      return { ok: false, field: "form", code: "credentials" };
    }

    const profile = await loadProfile(data.user.id);
    if (!profile) {
      await supabase.auth.signOut();
      return { ok: false, field: "form", code: "unavailable" };
    }
    if (profile.statut === "suspendu") {
      await supabase.auth.signOut();
      return { ok: false, field: "form", code: "suspended" };
    }

    window.sessionStorage.removeItem(FAILURES_KEY);
    window.sessionStorage.removeItem(LOCK_KEY);
    setUser(profile);
    return { ok: true, role: profile.role };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = supabaseBrowser();
    if (supabase) {
      await supabase.auth.signOut();
    }
    window.sessionStorage.removeItem("ubuntu-ia.session");
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const supabase = supabaseBrowser();
    if (!supabase) return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setUser(null);
      return;
    }
    const profile = await loadProfile(data.user.id);
    if (!profile || profile.statut === "suspendu") {
      await supabase.auth.signOut();
      setUser(null);
      return;
    }
    setUser(profile);
  }, []);

  const value = useMemo(
    () => ({ user, hydrated, signIn, signOut, refreshUser }),
    [user, hydrated, signIn, signOut, refreshUser],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function recordFailedAttempt(): Extract<AuthResult, { ok: false }> {
  const count = Number(window.sessionStorage.getItem(FAILURES_KEY) ?? "0") + 1;
  window.sessionStorage.setItem(FAILURES_KEY, String(count));
  if (count >= LOCK_AFTER) {
    window.sessionStorage.setItem(LOCK_KEY, String(Date.now() + LOCK_MS));
    return { ok: false, field: "form", code: "locked" };
  }
  return { ok: false, field: "form", code: "credentials" };
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return ctx;
}
