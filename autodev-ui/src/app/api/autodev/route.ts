import { NextRequest, NextResponse } from "next/server";
import {
  cancelTask,
  deleteTask,
  getTask,
  listTasks,
  readTaskLogs,
  resumeTask,
  startTask,
  stopTask,
} from "@/lib/autodev";
import { readPhaseLessons } from "@/lib/lessons";

export async function GET(request: NextRequest) {
  const lines = Number(request.nextUrl.searchParams.get("lines") ?? 200);
  const rawTaskId = request.nextUrl.searchParams.get("taskId");

  const tasks = listTasks();
  const normalizedTaskId = rawTaskId?.replace(/[{}]/g, "").trim();

  let selectedTask = normalizedTaskId ? getTask(normalizedTaskId) : null;
  if (!selectedTask && tasks.length > 0) {
    selectedTask = getTask(tasks[0].taskId);
  }

  const selectedTaskId = selectedTask?.taskId ?? null;
  const logs = selectedTask ? readTaskLogs(selectedTask, Math.min(200000, Math.max(200, lines))) : [];
  const lessons = selectedTask ? readPhaseLessons(selectedTask.currentPhase, 4) : [];

  let phase4Log: string[] = [];
  const outLine = logs.find((x) => x.includes("Output:"));
  if (outLine) {
    const m = outLine.match(/Output:\s+(.+)$/);
    const projectPath = m?.[1]?.trim();
    if (projectPath) {
      try {
        const fs = await import("node:fs");
        const p = `${projectPath}/phase4_dependency_check.log`;
        if (fs.existsSync(p)) {
          phase4Log = fs.readFileSync(p, "utf-8").split(/\r?\n/).filter(Boolean).slice(-80);
        }
      } catch {
        // ignore
      }
    }
  }

  return NextResponse.json({
    tasks,
    selectedTask,
    logs,
    selectedTaskId,
    lessons,
    phase4Log,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: "start" | "stop" | "resume" | "cancel" | "delete";
      goal?: string;
      taskId?: string;
    };

    const { action, goal, taskId } = body;

    if (action === "start") {
      const task = startTask(goal ?? "");
      return NextResponse.json({ ok: true, task });
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

    if (action === "delete") {
      const result = deleteTask(taskId);
      return NextResponse.json({ ok: true, result });
    }

    return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
