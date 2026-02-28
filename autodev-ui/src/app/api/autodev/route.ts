import { NextRequest, NextResponse } from "next/server";
import {
  cancelTask,
  getTask,
  listTasks,
  readTaskLogs,
  resumeTask,
  startTask,
  stopTask,
} from "@/lib/autodev";
import { getOllamaModelLogs, getOllamaOverview, readAgentConfig, updateAgentConfig } from "@/lib/ollama";

export async function GET(request: NextRequest) {
  const lines = Number(request.nextUrl.searchParams.get("lines") ?? 200);
  const taskId = request.nextUrl.searchParams.get("taskId");

  const tasks = listTasks();
  const selectedTaskId = taskId ?? tasks[0]?.taskId;
  const selectedTask = selectedTaskId ? getTask(selectedTaskId) : null;
  const logs = selectedTaskId ? readTaskLogs(selectedTaskId, Math.min(1200, Math.max(50, lines))) : [];

  const [ollama, config] = await Promise.all([getOllamaOverview(), Promise.resolve(readAgentConfig())]);
  const modelLogs = getOllamaModelLogs(140);

  return NextResponse.json({
    tasks,
    selectedTask,
    logs,
    selectedTaskId: selectedTaskId ?? null,
    ollama,
    config,
    modelLogs,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: "start" | "stop" | "resume" | "cancel" | "updateConfig";
      goal?: string;
      taskId?: string;
      config?: {
        planner_model?: string;
        coder_model?: string;
        repair_model?: string;
        repair_model_fallback?: string;
      };
    };

    const { action, goal, taskId } = body;

    if (action === "start") {
      const task = startTask(goal ?? "");
      return NextResponse.json({ ok: true, task });
    }

    if (action === "updateConfig") {
      const config = updateAgentConfig(body.config ?? {});
      return NextResponse.json({ ok: true, config });
    }

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "taskId is required." }, { status: 400 });
    }

    if (action === "stop") {
      const task = stopTask(taskId);
      return NextResponse.json({ ok: true, task });
    }

    if (action === "resume") {
      const task = resumeTask(taskId);
      return NextResponse.json({ ok: true, task });
    }

    if (action === "cancel") {
      const task = cancelTask(taskId);
      return NextResponse.json({ ok: true, task });
    }

    return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
