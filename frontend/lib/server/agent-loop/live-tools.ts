import "server-only";
import { searchIndexedChunks } from "@/lib/server/agent-tools";
import { draftFromContext, formatOf } from "@/lib/server/agent-loop/task-brief";
import { defaultTools, type ToolRegistry } from "@/lib/server/agent-loop/tools/registry";
import { specFromMarkdown } from "@/lib/server/document-spec";
import { reviewDeliverable } from "@/lib/server/document-review";
import { generateChatFiles } from "@/lib/server/generate-chat-file";

/** Outils branchés sur la base interne et les générateurs du lot A. */
export function liveTools(): ToolRegistry {
  return defaultTools([
    {
      name: "search_documents",
      description: "Cherche dans les documents internes indexés.",
      risk: "lecture",
      async run(_args, ctx) {
        try {
          const chunks = await searchIndexedChunks(ctx.task.objectif);
          const extraits = chunks.map((item) => item.contenu.replace(/\s+/g, " ").trim().slice(0, 700));
          ctx.task.contexte.extraits = extraits;
          ctx.task.contexte.sources = chunks.map((item) => item.titre);
          return {
            ok: true,
            output: extraits.length
              ? `${extraits.length} extrait(s) interne(s) retenu(s).`
              : "Aucun extrait interne. Le brouillon ne contiendra pas de fait inventé.",
          };
        } catch (error) {
          console.error("[taches] recherche", error);
          return { ok: false, output: "La recherche interne n'a pas abouti." };
        }
      },
    },
    {
      name: "read_sources",
      description: "Retient les extraits dans les faits de la tâche.",
      risk: "lecture",
      async run(_args, ctx) {
        const extraits = ctx.task.contexte.extraits ?? [];
        ctx.task.contexte.faits = [...(ctx.task.contexte.faits ?? []), ...extraits.slice(0, 4)];
        return {
          ok: true,
          output: extraits.length ? `${extraits.length} extrait(s) lus.` : "Aucun extrait à lire.",
        };
      },
    },
    {
      name: "draft_section",
      description: "Rédige le brouillon à partir des extraits seulement.",
      risk: "ecriture",
      async run(_args, ctx) {
        const brouillon = draftFromContext(ctx.task.objectif, ctx.task.contexte.extraits ?? []);
        ctx.task.contexte.brouillon = brouillon;
        return { ok: true, output: "Brouillon rédigé à partir des extraits." };
      },
    },
    {
      name: "review_deliverable",
      description: "Relit le brouillon (contrôles du lot A).",
      risk: "lecture",
      async run(_args, ctx) {
        const markdown = ctx.task.contexte.brouillon || draftFromContext(ctx.task.objectif, ctx.task.contexte.extraits ?? []);
        const spec = specFromMarkdown(markdown, ctx.task.objectif);
        const { report } = await reviewDeliverable({
          spec,
          question: ctx.task.objectif,
          excerpts: ctx.task.contexte.extraits ?? [],
          citationCount: (ctx.task.contexte.extraits ?? []).length,
        });
        const alertes = report.alertes.length;
        return {
          ok: true,
          output: alertes ? `Relecture : ${alertes} point(s) à vérifier.` : "Relecture : aucun écart bloquant.",
          data: { review: report },
        };
      },
    },
    {
      name: "build_deliverable",
      description: "Produit le fichier (Word, PowerPoint, Excel ou PDF).",
      risk: "ecriture",
      async run(_args, ctx) {
        const format = formatOf(`${ctx.step.description}\n${ctx.task.objectif}`);
        const markdown =
          ctx.task.contexte.brouillon || draftFromContext(ctx.task.objectif, ctx.task.contexte.extraits ?? []);
        try {
          const files = await generateChatFiles({
            question: ctx.task.objectif,
            content: markdown,
            formats: [format],
            attachments: [],
            userId: ctx.userId,
            excerpts: ctx.task.contexte.extraits,
            citationCount: (ctx.task.contexte.extraits ?? []).length,
          });
          const names = files.map((file) => file.name);
          ctx.task.contexte.fichiers = [...(ctx.task.contexte.fichiers ?? []), ...names];
          if (!names.length) return { ok: false, output: `Le fichier ${format} n'a pas pu être produit.` };
          return { ok: true, output: `Livrable prêt : ${names.join(", ")}.`, data: { fichiers: names, format } };
        } catch (error) {
          console.error("[taches] livrable", error);
          return { ok: false, output: `Le fichier ${format} n'a pas pu être produit.` };
        }
      },
    },
  ]);
}
