import "server-only";
import {
  requestCanvas,
  requestFile,
  requestImage,
  requestedFormats,
} from "@/lib/model-intents";
import type { ChatAttachment, ChatTools, FileFormat } from "@/lib/types";

export type AgentMode = "answer" | "task" | "hybrid";

export type AgentPlan = {
  mode: AgentMode;
  needRag: boolean;
  needWeb: boolean;
  needImage: boolean;
  needFile: boolean;
  needCanvas: boolean;
  formats: FileFormat[];
  /** Tour d'outils agent (search_documents, prepare_deliverable). */
  needTools: boolean;
  label: string;
};

const INTERNAL_TOPIC =
  /\b(soficau|ubuntu group|ubuntu ia|ubuntu itrack|proc[eé]dure interne|note de service|r[eè]glement int[eé]rieur|documents? index[eé]s?)\b/i;

const TASK_VERB =
  /\b(fais|faites|cr[eé]e[rz]?|g[eé]n[eè]re|r[eé]dige|pr[eé]pare|produis|livre|envoie|organise|planifie|[eé]cris|compose|transforme|convertis|construis|d[eé]veloppe|impl[eé]mente|corrige|refactor|optimise|mets?(ez)? en place|r[eé]alise|ex[eé]cute|lance|d[eé]ploie|synth[eé]tise|r[eé]sume|compare|analyse|liste|d[eé]taille|traduis|calcule|code|debug)\b/i;

const MULTI_STEP =
  /\b(puis|ensuite|apr[eè]s (quoi|cela)|et aussi|en plus|d['’]abord|deuxi[eè]mement|étape|plan d['’]action|todo|checklist)\b/i;

const CHITCHAT =
  /^(bonjour|bonsoir|salut|hello|hi|hey|merci|ok|d['’]accord|ça va|ca va|à plus|a plus)[\s!.?]*$/i;

const QUESTION_MARK = /\?/;

/**
 * Classe le message : question simple, tâche à exécuter, ou mixte.
 * Sert de boussole avant RAG / outils / livrables — sans appeler le LLM.
 */
export function planAgentTurn(
  question: string,
  tools: ChatTools = {},
  attachments: ChatAttachment[] = [],
): AgentPlan {
  const text = question.trim();
  const names = attachments.map((item) => item.name);
  const needImage = requestImage(text, tools, attachments);
  const needCanvas = requestCanvas(text, tools);
  const formats = requestedFormats(text, tools, names);
  const needFile = requestFile(text, tools, attachments.length) || formats.length > 0;
  const deliverable = needImage || needFile || needCanvas;
  const taskish = TASK_VERB.test(text) || MULTI_STEP.test(text) || deliverable;
  const asks = QUESTION_MARK.test(text) || /^(qui|quoi|quand|o[uù]|pourquoi|comment|combien|quel)\b/i.test(text);
  const chat = CHITCHAT.test(text) && attachments.length === 0;

  let mode: AgentMode = "answer";
  if (taskish && asks) mode = "hybrid";
  else if (taskish || attachments.length > 0) mode = "task";
  else if (asks || chat) mode = "answer";
  else if (text.length > 80) mode = "hybrid";
  else mode = "answer";

  const needRag =
    !chat && (INTERNAL_TOPIC.test(text) || mode !== "answer" || asks);
  const needWeb = !chat;
  const needTools = mode !== "answer" || needRag || deliverable;

  return {
    mode,
    needRag,
    needWeb,
    needImage,
    needFile,
    needCanvas,
    formats,
    needTools: needTools && mode !== "answer",
    label: labelFor(mode, deliverable),
  };
}

function labelFor(mode: AgentMode, deliverable: boolean): string {
  if (mode === "task") {
    return deliverable
      ? "Tâche identifiée — préparation du livrable."
      : "Tâche identifiée — sélection des outils.";
  }
  if (mode === "hybrid") {
    return "Demande mixte — analyse puis exécution.";
  }
  return "Question identifiée — réponse directe.";
}
