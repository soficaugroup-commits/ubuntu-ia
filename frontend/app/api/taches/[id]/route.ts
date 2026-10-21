/** GET /api/taches/:id — état, plan et journal. */
import { NextResponse } from "next/server";
import { guardTaskRead, ownedTask } from "@/lib/server/task-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await guardTaskRead(request);
  if (actor instanceof NextResponse) return actor;
  const { id } = await context.params;
  const task = await ownedTask(actor, id);
  if (task instanceof NextResponse) return task;
  return NextResponse.json({ tache: task }, { headers: { "Cache-Control": "no-store" } });
}
