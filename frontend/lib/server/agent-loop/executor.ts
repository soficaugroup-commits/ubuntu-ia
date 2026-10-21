import { toolForStep, type ToolRegistry, type ToolResult } from "@/lib/server/agent-loop/tools/registry";
import type { AgentTask, TaskStep } from "@/lib/types";

export async function executeStep(
  task: AgentTask,
  step: TaskStep,
  tools: ToolRegistry,
): Promise<ToolResult> {
  const name = toolForStep(step.type);
  const tool = tools.get(name);
  if (!tool) return { ok: false, output: `Outil ${name} introuvable.` };
  if (tool.risk === "externe" && !step.necessiteValidation) {
    return { ok: false, output: "Un outil externe exige une validation humaine." };
  }
  return tool.run(
    { query: task.objectif, question: step.description, title: step.description, ...step.entree },
    { task, step, userId: task.userId },
  );
}
