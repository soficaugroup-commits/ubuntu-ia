export type UserRole = "administrateur" | "utilisateur";
export type AccountStatus = "actif" | "suspendu";

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
  organisation: string;
  prenom?: string | null;
  nom?: string | null;
  statut?: AccountStatus;
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

export type SourceOrigine = "index" | "web";

export type SourceCitation = {
  documentId: string;
  titre: string;
  extrait: string;
  type_source: DocumentSourceType;
  url_source: string | null;
  origine?: SourceOrigine;
};

export type ChatTools = {
  image?: boolean;
  canvas?: boolean;
  file?: boolean;
  /** false : pas de recherche documentaire pour cet envoi. */
  documents?: boolean;
  /** false : pas de recherche web pour cet envoi. */
  web?: boolean;
  /** false : pas de tour d'outils agent. true : forcer l'analyse approfondie. */
  research?: boolean;
  /** Modèle du groupe choisi comme base du livrable (`modeles_documents.id`). */
  modeleId?: string;
};

export type TemplateFormat = "docx" | "pptx" | "xlsx";

export type TemplateField = {
  nom: string;
  type: "texte" | "boucle" | "nom_defini" | "tableau";
  colonnes?: string[];
};

export type DocumentTemplate = {
  id: string;
  nom: string;
  description: string;
  format: TemplateFormat;
  categorie: DocumentCategory | null;
  champs: TemplateField[];
  structure: {
    titres?: string[];
    tableaux?: number;
    emplacementContenu?: boolean;
    diapositives?: number;
    dispositions?: string[];
    feuilles?: string[];
  };
  actif: boolean;
  /** Aperçu signé (miniature PowerPoint produite par le worker), quand il existe. */
  apercuUrl: string | null;
  created_at: string;
  updated_at: string;
};

export type FileFormat =
  | "pdf"
  | "docx"
  | "xlsx"
  | "pptx"
  | "csv"
  | "txt"
  | "md"
  | "json"
  | "html";

export type GeneratedImage = {
  url: string;
  alt: string;
};

export type ReviewStatus = "ok" | "corrige" | "a_verifier";

export type ReviewAlertType =
  | "chiffre_non_source"
  | "citation_manquante"
  | "date_incoherente"
  | "total_incorrect"
  | "fait_non_etaye";

export type ReviewAlert = {
  type: ReviewAlertType;
  extrait: string;
  explication: string;
};

export type ReviewCorrection = {
  type: "total" | "marquage";
  extrait: string;
  avant: string;
  apres: string;
};

export type ReviewReport = {
  statut: ReviewStatus;
  corrections: ReviewCorrection[];
  alertes: ReviewAlert[];
};

export type GeneratedFile = {
  id: string;
  name: string;
  mime: string;
  format: FileFormat | "png" | "jpeg" | "webp";
  url: string;
  /** Rapport de relecture automatique, présent sur chaque livrable. */
  relecture?: ReviewReport;
};

export type AssistantStatus =
  | "pending"
  | "answered"
  | "no_source"
  | "error"
  | "timeout"
  | "offline"
  | "stopped";

export type ChatStepState = "queued" | "running" | "done" | "empty" | "error";

export type ChatStep = {
  id: string;
  label: string;
  state: ChatStepState;
};

export type ChatAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "image" | "file";
  previewUrl?: string;
  contentBase64?: string;
};

export type ChatMessage =
  | {
      id: string;
      role: "user";
      content: string;
      attachments?: ChatAttachment[];
      tools?: ChatTools;
      createdAt: string;
    }
  | {
      id: string;
      role: "assistant";
      content: string;
      sources: SourceCitation[];
      images?: GeneratedImage[];
      files?: GeneratedFile[];
      steps?: ChatStep[];
      status: AssistantStatus;
      createdAt: string;
    };

export type Conversation = {
  id: string;
  title: string;
  /** Titre figé par l'utilisateur (ne plus dériver du premier message). */
  titleLocked?: boolean;
  updatedAt: string;
  messages: ChatMessage[];
};

export type MemoryFact = {
  id: string;
  cle: string;
  valeur: string;
  sourceConversationId?: string | null;
  dateCreation: string;
  dateMaj: string;
};

export type FeedbackType = "positif" | "negatif";

export type MessageFeedback = {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  messageIndex: number | null;
  type: FeedbackType;
  commentaire: string | null;
  dateCreation: string;
};

export type AdminFeedback = MessageFeedback & {
  userId: string;
  userEmail: string;
  userName: string;
  extraitQuestion: string | null;
  extraitReponse: string | null;
};
