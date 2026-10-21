/**
 * GET  /api/taches          liste des tâches de l'utilisateur
 * POST /api/taches          crée une tâche depuis un message et propose un plan
 */
import { NextResponse } from "next/server";
import { advanceTask } from "@/lib/server/agent-loop/runner";
import { supabaseTaskStore } from "@/lib/server/agent-loop/store";
import { guardTaskRead, guardTaskWrite, readJson, rememberUse } from "@/lib/server/task-http";
import { createTask, listTasksForUser } from "@/lib/server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET(request: Request) {
  const actor = await guardTaskRead(request);
  if (actor instanceof NextResponse) return actor;
  try {
    const taches = await listTasksForUser(actor.id);
    return NextResponse.json({ taches }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[taches] liste", error);
    return NextResponse.json({ error: "Les tâches n'ont pas pu être chargées." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await guardTaskWrite(request);
  if (actor instanceof NextResponse) return actor;
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Décrivez la tâche à conduire." }, { status: 400 });
  const conversationId = typeof body.conversationId === "string" ? body.conversationId : null;
  try {
    const created = await createTask({
      userId: actor.id,
      conversationId,
      titre: message.slice(0, 80),
      objectif: message,
    });
    const { task } = await advanceTask(supabaseTaskStore(actor.id), created.id, { budgetMs: 20_000 });
    await rememberUse(actor.id);
    return NextResponse.json({ tache: task });
  } catch (error) {
    console.error("[taches] création", error);
    return NextResponse.json({ error: "La tâche n'a pas pu être créée." }, { status: 500 });
  }
}
