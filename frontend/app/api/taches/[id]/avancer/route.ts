/**
 * POST /api/taches/:id/avancer
 * Exécute un budget d'étapes (~240 s) et diffuse les événements en SSE.
 * Le plan doit déjà être validé (statut en_cours).
 */
import { advanceTask } from "@/lib/server/agent-loop/runner";
import { supabaseTaskStore } from "@/lib/server/agent-loop/store";
import { guardTaskWrite, ownedTask, rememberUse } from "@/lib/server/task-http";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await guardTaskWrite(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const task = await ownedTask(actor, id);
  if (task instanceof NextResponse) return task;
  if (task.statut === "plan_propose") {
    return NextResponse.json({ error: "Validez le plan avant de lancer l'exécution." }, { status: 409 });
  }
  if (task.statut === "terminee" || task.statut === "annulee" || task.statut === "echouee") {
    return NextResponse.json({ error: "Cette tâche est déjà close." }, { status: 409 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const result = await advanceTask(supabaseTaskStore(actor.id), id, { budgetMs: 240_000 });
        for (const event of result.events) send(event);
        await rememberUse(actor.id);
      } catch (error) {
        console.error("[taches] avancer", error);
        send({ type: "erreur", message: "L'exécution de la tâche s'est interrompue." });
      }
      try {
        controller.close();
      } catch {
        /* déjà fermé */
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
