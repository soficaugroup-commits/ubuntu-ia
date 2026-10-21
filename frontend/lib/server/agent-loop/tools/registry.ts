import type { AgentTask, TaskStep } from "@/lib/types";

export type ToolRisk = "lecture" | "ecriture" | "externe";

export type ToolContext = {
  task: AgentTask;
  step: TaskStep;
  userId: string;
};

export type ToolResult = {
  ok: boolean;
  output: string;
  data?: Record<string, unknown>;
  askUser?: string;
};

export type AgentTool = {
  name: string;
  description: string;
  risk: ToolRisk;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

export type ToolRegistry = Map<string, AgentTool>;

export function createRegistry(tools: AgentTool[]): ToolRegistry {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export function defaultTools(overrides: AgentTool[] = []): ToolRegistry {
  const base: AgentTool[] = [
    {
      name: "search_documents",
      description: "Cherche dans les documents internes.",
      risk: "lecture",
      async run(args) {
        const query = typeof args.query === "string" ? args.query : "";
        return { ok: true, output: query ? `Recherche interne : ${query}` : "Requête vide." };
      },
    },
    {
      name: "ask_user",
      description: "Pose une question précise à l'utilisateur.",
      risk: "lecture",
      async run(args) {
        const question = typeof args.question === "string" ? args.question : "Précisez votre besoin.";
        return { ok: true, output: question, askUser: question };
      },
    },
    {
      name: "draft_section",
      description: "Rédige une section à partir des faits établis.",
      risk: "ecriture",
      async run(args, ctx) {
        const title = typeof args.title === "string" ? args.title : ctx.step.description;
        return { ok: true, output: `Section préparée : ${title}` };
      },
    },
    {
      name: "build_deliverable",
      description: "Construit le fichier livrable (lot A).",
      risk: "ecriture",
      async run(args) {
        const format = typeof args.format === "string" ? args.format : "docx";
        return { ok: true, output: `Livrable ${format} prêt.`, data: { format } };
      },
    },
    {
      name: "review_deliverable",
      description: "Relit le livrable (lot A3).",
      risk: "lecture",
      async run() {
        return { ok: true, output: "Relecture : aucun écart bloquant." };
      },
    },
  ];
  return createRegistry([...base.filter((tool) => !overrides.some((item) => item.name === tool.name)), ...overrides]);
}

export function toolForStep(type: TaskStep["type"]): string {
  if (type === "chercher") return "search_documents";
  if (type === "demander") return "ask_user";
  if (type === "rediger") return "draft_section";
  if (type === "livrer") return "build_deliverable";
  if (type === "verifier" || type === "corriger") return "review_deliverable";
  return "draft_section";
}
