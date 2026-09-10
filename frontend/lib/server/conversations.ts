import "server-only";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import type {
  ChatAttachment,
  ChatMessage,
  ChatTools,
  Conversation,
  FileFormat,
  GeneratedFile,
  GeneratedImage,
  SourceCitation,
} from "@/lib/types";

type ConversationRow = {
  id: string;
  date_creation: string;
  messages: unknown;
  title: string | null;
  title_locked: boolean | null;
};

export async function listUserConversations(
  userId: string,
): Promise<Conversation[]> {
  const { data, error } = await supabaseAdmin()
    .from("conversations")
    .select("id, date_creation, messages, title, title_locked")
    .eq("user_id", userId)
    .order("date_creation", { ascending: false });
  if (error) {
    throw new Error("L'historique n'a pas pu être chargé.");
  }
  return (data as ConversationRow[]).map(mapConversation).filter((item) =>
    item.messages.length > 0,
  );
}

export async function deleteUserConversation(
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new Error("La conversation n'a pas pu être supprimée.");
  }
  return Boolean(data);
}

export async function renameUserConversation(
  userId: string,
  conversationId: string,
  title: string,
): Promise<Conversation | null> {
  const cleaned = sanitizeTitle(title);
  if (!cleaned) {
    throw new Error("Indiquez un titre pour cette conversation.");
  }
  const { data, error } = await supabaseAdmin()
    .from("conversations")
    .update({ title: cleaned, title_locked: true })
    .eq("id", conversationId)
    .eq("user_id", userId)
    .select("id, date_creation, messages, title, title_locked")
    .maybeSingle();
  if (error) {
    throw new Error("La conversation n'a pas pu être renommée.");
  }
  if (!data) return null;
  return mapConversation(data as ConversationRow);
}

export async function getUserConversation(
  userId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const { data, error } = await supabaseAdmin()
    .from("conversations")
    .select("id, date_creation, messages, title, title_locked")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new Error("La conversation n'a pas pu être chargée.");
  }
  if (!data) return null;
  return mapConversation(data as ConversationRow);
}

export async function saveUserConversation(
  userId: string,
  conversation: Conversation,
): Promise<void> {
  const { data: existing } = await supabaseAdmin()
    .from("conversations")
    .select("user_id, title, title_locked")
    .eq("id", conversation.id)
    .maybeSingle();
  if (existing && existing.user_id !== userId) {
    throw new Error("La conversation n'a pas pu être enregistrée.");
  }

  const locked = Boolean(existing?.title_locked || conversation.titleLocked);
  const autoTitle = titleFromStored(conversation.messages);
  const title = locked
    ? sanitizeTitle(conversation.title) ||
      sanitizeTitle(String(existing?.title ?? "")) ||
      autoTitle ||
      "Nouvelle conversation"
    : autoTitle || sanitizeTitle(conversation.title) || "Nouvelle conversation";

  const payload = {
    id: conversation.id,
    user_id: userId,
    messages: conversation.messages.map(serializeMessage),
    title,
    title_locked: locked,
  };
  const { error } = await supabaseAdmin()
    .from("conversations")
    .upsert(payload, { onConflict: "id" });
  if (error) {
    throw new Error("La conversation n'a pas pu être enregistrée.");
  }
}

export function sanitizeTitle(value: string): string {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "";
  return compact.length > 80 ? `${compact.slice(0, 77)}…` : compact;
}

function mapConversation(row: ConversationRow): Conversation {
  const messages = Array.isArray(row.messages)
    ? row.messages.map(parseMessage).filter((item): item is ChatMessage => item !== null)
    : [];
  const last = messages.at(-1);
  const locked = Boolean(row.title_locked);
  const stored = sanitizeTitle(row.title ?? "");
  return {
    id: row.id,
    title: locked
      ? stored || titleFromStored(messages) || "Nouvelle conversation"
      : stored || titleFromStored(messages) || "Nouvelle conversation",
    titleLocked: locked,
    updatedAt: last?.createdAt || row.date_creation,
    messages,
  };
}

function titleFromStored(messages: ChatMessage[]): string {
  const first = messages.find((item) => item.role === "user");
  if (!first) return "";
  return sanitizeTitle(first.content);
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (row.role === "user" && typeof row.content === "string") {
    return {
      id: String(row.id ?? crypto.randomUUID()),
      role: "user",
      content: row.content,
      attachments: Array.isArray(row.attachments)
        ? row.attachments.map(parseAttachment).filter((item): item is ChatAttachment => item !== null)
        : undefined,
      tools: parseTools(row.tools),
      createdAt: String(row.createdAt ?? new Date().toISOString()),
    };
  }
  if (row.role === "assistant") {
    return {
      id: String(row.id ?? crypto.randomUUID()),
      role: "assistant",
      content: typeof row.content === "string" ? row.content : "",
      sources: parseSources(row.sources),
      images: parseImages(row.images),
      files: parseFiles(row.files),
      status:
        row.status === "answered" ||
        row.status === "no_source" ||
        row.status === "error" ||
        row.status === "timeout" ||
        row.status === "offline" ||
        row.status === "stopped"
          ? row.status
          : "answered",
      createdAt: String(row.createdAt ?? new Date().toISOString()),
    };
  }
  return null;
}

function parseSources(value: unknown): SourceCitation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.documentId !== "string" || typeof row.titre !== "string") {
      return [];
    }
    return [
      {
        documentId: row.documentId,
        titre: row.titre,
        extrait: typeof row.extrait === "string" ? row.extrait : "",
        type_source: row.type_source === "url" ? "url" : "fichier",
        url_source: typeof row.url_source === "string" ? row.url_source : null,
        origine:
          row.origine === "web" || String(row.documentId).startsWith("web:")
            ? "web"
            : "index",
      },
    ];
  });
}

function parseImages(value: unknown): GeneratedImage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const images = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.url !== "string" || !row.url) return [];
    return [
      {
        url: row.url,
        alt: typeof row.alt === "string" ? row.alt : "",
      },
    ];
  });
  return images.length ? images : undefined;
}

function parseFiles(value: unknown): GeneratedFile[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files = value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.url !== "string" || !row.url || typeof row.name !== "string") {
      return [];
    }
    return [
      {
        id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
        name: row.name,
        mime: typeof row.mime === "string" ? row.mime : "application/octet-stream",
        format: asFileFormat(row.format),
        url: row.url,
      },
    ];
  });
  return files.length ? files : undefined;
}

function asFileFormat(value: unknown): GeneratedFile["format"] {
  const allowed: GeneratedFile["format"][] = [
    "pdf",
    "docx",
    "xlsx",
    "pptx",
    "csv",
    "txt",
    "md",
    "json",
    "png",
    "jpeg",
    "webp",
  ];
  return allowed.includes(value as FileFormat) ? (value as FileFormat) : "pdf";
}

function parseTools(value: unknown): ChatTools | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as { image?: unknown; canvas?: unknown; file?: unknown };
  const tools: ChatTools = {};
  if (row.image) tools.image = true;
  if (row.canvas) tools.canvas = true;
  if (row.file) tools.file = true;
  return tools.image || tools.canvas || tools.file ? tools : undefined;
}

function parseAttachment(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string") return null;
  return {
    id: row.id,
    name: row.name,
    mime: typeof row.mime === "string" ? row.mime : "application/octet-stream",
    size: typeof row.size === "number" ? row.size : 0,
    kind: row.kind === "image" ? "image" : "file",
  };
}

function serializeMessage(message: ChatMessage): ChatMessage {
  if (message.role === "user") {
    return {
      ...message,
      attachments: message.attachments?.map((item) => ({
        id: item.id,
        name: item.name,
        mime: item.mime,
        size: item.size,
        kind: item.kind,
      })),
    };
  }
  return {
    id: message.id,
    role: "assistant",
    content: message.content,
    sources: message.sources,
    images: message.images,
    files: message.files,
    status: message.status,
    createdAt: message.createdAt,
  };
}
