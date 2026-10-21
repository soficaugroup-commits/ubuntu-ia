/** POST /api/taches/:id/annuler */
import { NextResponse } from "next/server";
import { cancelTask } from "@/lib/server/agent-loop/commands";
import { commandError, guardTaskWrite, ownedTask, rememberUse } from "@/lib/server/task-http";
import { persistTask } from "@/lib/server/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await guardTaskWrite(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const task = await ownedTask(actor, id);
  if (task instanceof NextResponse) return task;
  const result = cancelTask(task);
  if (!result.ok) return commandError(result);
  try {
    await persistTask(actor.id, result.task);
    await rememberUse(actor.id);
    return NextResponse.json({ tache: result.task });
  } catch (error) {
    console.error("[taches] annulation", error);
    return NextResponse.json({ error: "La tâche n'a pas pu être annulée." }, { status: 500 });
  }
}
