export type UserRole = "administrateur" | "utilisateur";

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  organisation: string;
  prenom?: string | null;
  nom?: string | null;
};

export type DocumentSourceType = "fichier" | "url";
export type IndexationStatus = "en_attente" | "en_cours" | "termine" | "erreur";
export type DocumentCategory = string;

export type KnowledgeCategory = {
  id: DocumentCategory;
  label: string;
};

export type KnowledgeDocument = {
  id: string;
  titre: string;
  categorie: DocumentCategory;
  type_source: DocumentSourceType;
  url_source: string | null;
  date_ajout: string;
  statut_indexation: IndexationStatus;
  message_erreur?: string | null;
};

export type SourceCitation = {
  documentId: string;
  titre: string;
  extrait: string;
  type_source: DocumentSourceType;
  url_source: string | null;
};

export type AssistantStatus =
  | "pending"
  | "answered"
  | "no_source"
  | "error"
  | "timeout"
  | "offline"
  | "stopped";

export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
  previewUrl?: string;
};

export type ChatMessage =
  | {
      id: string;
      role: "user";
      content: string;
      attachments?: ChatAttachment[];
      createdAt: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      sources: SourceCitation[];
      status: AssistantStatus;
      createdAt: string;
    };

export type Conversation = {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
};
