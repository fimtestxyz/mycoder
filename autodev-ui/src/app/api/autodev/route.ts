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

export async function GET(request: NextRequest) {
  const lines = Number(request.nextUrl.searchParams.get("lines") ?? 200);
  const taskId = request.nextUrl.searchParams.get("taskId");

  const tasks = listTasks();
  const selectedTaskId = taskId ?? tasks[0]?.taskId;
  const selectedTask = selectedTaskId ? getTask(selectedTaskId) : null;
  const logs = selectedTaskId ? readTaskLogs(selectedTaskId, Math.min(1200, Math.max(50, lines))) : [];

  return NextResponse.json({
    tasks,
    selectedTask,
    logs,
    selectedTaskId: selectedTaskId ?? null,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: "start" | "stop" | "resume" | "cancel";
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

    return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
