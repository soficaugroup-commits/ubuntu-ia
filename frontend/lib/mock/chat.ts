import type {
  AssistantStatus,
  ChatAttachment,
  ChatMessage,
  SourceCitation,
} from "@/lib/types";

const PROCEDURE_SOURCES: SourceCitation[] = [
  {
    documentId: "doc-achat",
    titre: "Procédure d'achat interne",
    extrait:
      "Toute demande d'achat supérieure au seuil défini doit être validée par le responsable hiérarchique, puis transmise à la direction administrative et financière.",
    type_source: "fichier",
    url_source: null,
  },
];

const INSTITUTIONAL_SOURCES: SourceCitation[] = [
  {
    documentId: "doc-site",
    titre: "soficau-ubuntu.com — accueil",
    extrait:
      "SOFICAU Ubuntu Group est une holding institutionnelle panafricaine portée par la philosophie Ubuntu. Huit entités spécialisées accompagnent la transformation des organisations.",
    type_source: "url",
    url_source: "https://soficau-ubuntu.com",
  },
];

const RH_SOURCES: SourceCitation[] = [
  {
    documentId: "doc-charte-rh",
    titre: "Charte interne RH",
    extrait:
      "Les collaborateurs s'adressent en premier lieu à leur responsable d'entité pour toute question relative aux congés, à la mobilité interne ou aux conditions de travail.",
    type_source: "fichier",
    url_source: null,
  },
];

export type AnswerScenario = {
  status: Exclude<AssistantStatus, "pending">;
  content: string;
  sources: SourceCitation[];
  delayMs: number;
};

function matches(question: string, terms: string[]): boolean {
  return terms.some((term) => question.includes(term));
}

export function resolveAnswer(question: string, online: boolean): AnswerScenario {
  const normalized = question.trim().toLowerCase();

  if (!online || matches(normalized, ["hors ligne", "offline"])) {
    return {
      status: "offline",
      content: "",
      sources: [],
      delayMs: 400,
    };
  }

  if (matches(normalized, ["aucune source", "hors corpus"])) {
    return {
      status: "no_source",
      content: "",
      sources: [],
      delayMs: 900,
    };
  }

  if (matches(normalized, ["échec", "erreur réseau"])) {
    return {
      status: "error",
      content: "",
      sources: [],
      delayMs: 900,
    };
  }

  if (matches(normalized, ["délai", "timeout"])) {
    return {
      status: "timeout",
      content: "",
      sources: [],
      delayMs: 1400,
    };
  }

  if (matches(normalized, ["achat", "procurement", "fournisseur"])) {
    return {
      status: "answered",
      content:
        "Selon la procédure d'achat interne, une demande au-dessus du seuil fixé passe d'abord par le responsable hiérarchique, puis par la direction administrative et financière. Ubuntu IA s'appuie uniquement sur le passage indexé ci-dessous.",
      sources: PROCEDURE_SOURCES,
      delayMs: 1100,
    };
  }

  if (matches(normalized, ["congé", "rh", "mobilité", "collaborateur"])) {
    return {
      status: "answered",
      content:
        "D'après la charte interne RH, les questions de congés, de mobilité interne ou de conditions de travail se posent d'abord au responsable d'entité.",
      sources: RH_SOURCES,
      delayMs: 1100,
    };
  }

  return {
    status: "answered",
    content:
      "D'après les documents institutionnels indexés, SOFICAU Ubuntu Group est une holding panafricaine structurée autour de la philosophie Ubuntu et de huit entités spécialisées.",
    sources: INSTITUTIONAL_SOURCES,
    delayMs: 1100,
  };
}

export function createUserMessage(
  content: string,
  attachments?: ChatAttachment[],
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    attachments: attachments?.length ? attachments : undefined,
    createdAt: new Date().toISOString(),
  };
}

export function createPendingAssistant(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    sources: [],
    status: "pending",
    createdAt: new Date().toISOString(),
  };
}

export function titleFromQuestion(question: string): string {
  const compact = question.trim().replace(/\s+/g, " ");
  return compact.length > 48 ? `${compact.slice(0, 45)}…` : compact;
}
