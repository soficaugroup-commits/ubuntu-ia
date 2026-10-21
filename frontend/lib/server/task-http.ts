import "server-only";
import { NextResponse } from "next/server";
import { assertDocumentSecrets } from "@/lib/server/env";
import { assertMessageQuota, recordMessageUse } from "@/lib/server/quotas";
import { isSessionActor, requireUser, type SessionActor } from "@/lib/server/require-admin";
import { getTaskForUser } from "@/lib/server/tasks";
import type { AgentTask } from "@/lib/types";

export const TASK_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function guardTaskWrite(request: Request): Promise<SessionActor | NextResponse> {
  const actor = await guardTaskRead(request);
  if (actor instanceof NextResponse) return actor;
  const quota = await assertMessageQuota(actor.id);
  if (quota) return NextResponse.json({ error: quota }, { status: 429 });
  return actor;
}

export async function guardTaskRead(request: Request): Promise<SessionActor | NextResponse> {
  const configured = assertDocumentSecrets();
  if (configured) return NextResponse.json({ error: configured }, { status: 503 });
  const actor = await requireUser(request);
  if (!isSessionActor(actor)) return NextResponse.json({ error: actor.error }, { status: actor.status });
  return actor;
}

export async function ownedTask(actor: SessionActor, id: string): Promise<AgentTask | NextResponse> {
  if (!TASK_UUID.test(id)) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
  try {
    const task = await getTaskForUser(actor.id, id);
    if (!task) return NextResponse.json({ error: "Tâche introuvable." }, { status: 404 });
    return task;
  } catch (error) {
    console.error("[taches]", error);
    return NextResponse.json({ error: "La tâche n'a pas pu être chargée." }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "La demande n'a pas pu être lue." }, { status: 400 });
  }
}

export function commandError(result: { ok: false; error: string }): NextResponse {
  return NextResponse.json({ error: result.error }, { status: 409 });
}

export async function rememberUse(userId: string): Promise<void> {
  await recordMessageUse(userId);
}
