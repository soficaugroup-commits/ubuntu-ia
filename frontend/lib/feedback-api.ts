import { supabaseBrowser } from "@/lib/supabase";
import type { AdminFeedback, FeedbackType, MessageFeedback } from "@/lib/types";

async function authHeaders(): Promise<HeadersInit> {
  const supabase = supabaseBrowser();
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loadOwnFeedback(): Promise<
  { ok: true; feedbacks: MessageFeedback[] } | { ok: false; error: string }
> {
  const response = await fetch("/api/feedback", {
    cache: "no-store",
    headers: await authHeaders(),
  });
  const body = (await response.json().catch(() => ({}))) as {
    feedbacks?: MessageFeedback[];
    error?: string;
  };
  if (!response.ok) {
    return { ok: false, error: body.error || "Les retours n'ont pas pu être chargés." };
  }
  return { ok: true, feedbacks: body.feedbacks ?? [] };
}

export async function submitFeedback(input: {
  conversationId: string;
  messageId: string;
  messageIndex: number;
  type: FeedbackType;
  commentaire?: string;
  extraitQuestion?: string;
  extraitReponse?: string;
}): Promise<{ ok: true; feedback: MessageFeedback } | { ok: false; error: string }> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body = (await response.json().catch(() => ({}))) as {
    feedback?: MessageFeedback;
    error?: string;
  };
  if (!response.ok || !body.feedback) {
    return { ok: false, error: body.error || "Le retour n'a pas pu être enregistré." };
  }
  return { ok: true, feedback: body.feedback };
}

export async function loadAdminFeedback(
  type: FeedbackType | "tous" = "negatif",
): Promise<{ ok: true; feedbacks: AdminFeedback[] } | { ok: false; error: string }> {
  const response = await fetch(`/api/admin/feedback?type=${type}`, {
    cache: "no-store",
    headers: await authHeaders(),
  });
  const body = (await response.json().catch(() => ({}))) as {
    feedbacks?: AdminFeedback[];
    error?: string;
  };
  if (!response.ok) {
    return { ok: false, error: body.error || "Les retours n'ont pas pu être chargés." };
  }
  return { ok: true, feedbacks: body.feedbacks ?? [] };
}
