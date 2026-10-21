/** POST /api/taches/:id/plan — valider ou remplacer le plan proposé. */
import { NextResponse } from "next/server";
import { acceptPlan, replacePlan } from "@/lib/server/agent-loop/commands";
import { commandError, guardTaskWrite, ownedTask, readJson, rememberUse } from "@/lib/server/task-http";
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
  const body = await readJson(request);
  if (body instanceof NextResponse) return body;
  const result =
    body.action === "valider"
      ? acceptPlan(task)
      : Array.isArray(body.etapes)
        ? replacePlan(task, body.etapes)
        : { ok: false as const, error: "Indiquez action=valider ou une liste etapes." };
  if (!result.ok) return commandError(result);
  try {
    await persistTask(actor.id, result.task);
    await rememberUse(actor.id);
    return NextResponse.json({ tache: result.task });
  } catch (error) {
    console.error("[taches] plan", error);
    return NextResponse.json({ error: "Le plan n'a pas pu être enregistré." }, { status: 500 });
  }
}
