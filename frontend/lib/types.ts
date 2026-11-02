export type UserRole = "administrateur" | "responsable" | "utilisateur";
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
      /** Tâche persistante proposée pour une mission multi-étapes. */
      tacheId?: string;
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

export type MemoryScope = "preference" | "profil" | "projet" | "organisation" | "contexte";

export type MemoryFact = {
  id: string;
  cle: string;
  valeur: string;
  sourceConversationId?: string | null;
  dateCreation: string;
  dateMaj: string;
  /** Rubrique du souvenir (migration 019). Déduite de la clé pour les anciens faits. */
  portee?: MemoryScope;
  /** Projet, client ou entité concerné : un projet n'est rappelé que si la demande le concerne. */
  sujet?: string | null;
  importance?: number;
  derniereUtilisation?: string | null;
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

export type TaskStatus =
  | "cadrage"
  | "plan_propose"
  | "en_cours"
  | "en_attente_utilisateur"
  | "en_attente_validation"
  | "terminee"
  | "echouee"
  | "annulee";

export type TaskStepType =
  | "chercher"
  | "lire"
  | "rediger"
  | "verifier"
  | "corriger"
  | "livrer"
  | "demander"
  | "agir";

export type TaskStepStatus = "a_faire" | "en_cours" | "faite" | "sautee" | "echouee" | "bloquee";

export type TaskJournalType = "fait" | "reste" | "decision" | "question" | "reponse" | "erreur" | "validation";

export type TaskBudget = {
  maxEtapes?: number;
  maxCout?: number;
  echeance?: string;
};

export type TaskContext = {
  faits?: string[];
  decisions?: string[];
  fichiers?: string[];
  sources?: string[];
  infosManquantes?: string[];
  /** Extraits internes retenus pour la rédaction. */
  extraits?: string[];
  /** Brouillon Markdown relu avant la production des fichiers. */
  brouillon?: string;
};

export type TaskStep = {
  id: string;
  ordre: number;
  type: TaskStepType;
  description: string;
  statut: TaskStepStatus;
  entree: Record<string, unknown>;
  sortie: Record<string, unknown>;
  necessiteValidation: boolean;
  tentatives: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  erreur?: string | null;
};

export type TaskJournalEntry = {
  id: string;
  horodatage: string;
  type: TaskJournalType;
  contenu: string;
  auteur: "agent" | "utilisateur";
};

export type AgentTask = {
  id: string;
  userId: string;
  organisationId: string | null;
  conversationId: string | null;
  dossierId: string | null;
  titre: string;
  objectif: string;
  statut: TaskStatus;
  plan: TaskStep[];
  contexte: TaskContext;
  etapeCourante: number;
  budget: TaskBudget;
  createdAt: string;
  updatedAt: string;
  termineeAt: string | null;
  journal?: TaskJournalEntry[];
};

export type AdminFeedback = MessageFeedback & {
  userId: string;
  userEmail: string;
  userName: string;
  extraitQuestion: string | null;
  extraitReponse: string | null;
};
