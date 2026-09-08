import "server-only";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type { AdminFeedback, FeedbackType, MessageFeedback } from "@/lib/types";

type FeedbackRow = {
  id: string;
  user_id?: string;
  conversation_id: string | null;
  message_id: string | null;
  message_index: number | null;
  type: FeedbackType;
  commentaire: string | null;
  extrait_question?: string | null;
  extrait_reponse?: string | null;
  date_creation: string;
};

export async function listOwnFeedback(userId: string): Promise<MessageFeedback[]> {
  const { data, error } = await supabaseAdmin()
    .from("feedback")
    .select("id, conversation_id, message_id, message_index, type, commentaire, date_creation")
    .eq("user_id", userId)
    .order("date_creation", { ascending: false })
    .limit(200);
  if (error) {
    throw new Error("Les retours n'ont pas pu être chargés.");
  }
  return ((data ?? []) as FeedbackRow[]).map(mapOwn);
}

export async function upsertFeedback(input: {
  userId: string;
  conversationId: string | null;
  messageId: string;
  messageIndex: number | null;
  type: FeedbackType;
  commentaire?: string | null;
  extraitQuestion?: string | null;
  extraitReponse?: string | null;
}): Promise<MessageFeedback> {
  const { data, error } = await supabaseAdmin()
    .from("feedback")
    .upsert(
      {
        user_id: input.userId,
        conversation_id: input.conversationId,
        message_id: input.messageId,
        message_index: input.messageIndex,
        type: input.type,
        commentaire: input.commentaire?.trim() || null,
        extrait_question: input.extraitQuestion?.trim().slice(0, 500) || null,
        extrait_reponse: input.extraitReponse?.trim().slice(0, 800) || null,
      },
      { onConflict: "user_id,message_id" },
    )
    .select("id, conversation_id, message_id, message_index, type, commentaire, date_creation")
    .single();
  if (error || !data) {
    throw new Error("Le retour n'a pas pu être enregistré.");
  }
  return mapOwn(data as FeedbackRow);
}

export async function listAdminFeedback(filter: FeedbackType | "tous"): Promise<AdminFeedback[]> {
  let query = supabaseAdmin()
    .from("feedback")
    .select(
      "id, user_id, conversation_id, message_id, message_index, type, commentaire, extrait_question, extrait_reponse, date_creation",
    )
    .order("date_creation", { ascending: false })
    .limit(80);
  if (filter !== "tous") query = query.eq("type", filter);
  const { data, error } = await query;
  if (error) {
    throw new Error("Les retours n'ont pas pu être chargés.");
  }
  const rows = (data ?? []) as FeedbackRow[];
  const ids = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => Boolean(id)))];
  const people = new Map<string, { email: string; prenom: string | null; nom: string | null }>();
  if (ids.length) {
    const { data: users, error: usersError } = await supabaseAdmin()
      .from("users")
      .select("id, email, prenom, nom")
      .in("id", ids);
    if (usersError) {
      throw new Error("Les retours n'ont pas pu être chargés.");
    }
    for (const person of users ?? []) {
      people.set(person.id, {
        email: person.email,
        prenom: person.prenom,
        nom: person.nom,
      });
    }
  }
  return rows.map((row) => mapAdmin(row, people.get(row.user_id ?? "")));
}

function mapOwn(row: FeedbackRow): MessageFeedback {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    messageIndex: row.message_index,
    type: row.type,
    commentaire: row.commentaire,
    dateCreation: row.date_creation,
  };
}

function mapAdmin(
  row: FeedbackRow,
  person?: { email: string; prenom: string | null; nom: string | null },
): AdminFeedback {
  const name = [person?.prenom?.trim(), person?.nom?.trim()].filter(Boolean).join(" ");
  return {
    ...mapOwn(row),
    userId: row.user_id ?? "",
    userEmail: person?.email ?? "",
    userName: name,
    extraitQuestion: row.extrait_question ?? null,
    extraitReponse: row.extrait_reponse ?? null,
  };
}
