import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type RunnerStatus =
  | "idle"
  | "running"
  | "stopped"
  | "completed"
  | "failed"
  | "canceled";

export type TaskRecord = {
  taskId: string;
  goal: string;
  status: RunnerStatus;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  logFile: string;
  currentPhase: number;
  phaseTitle: string;
  progress: number;
  lastSummary: string;
  exitCode: number | null;
};

const appRoot = process.cwd();
const projectRoot = path.resolve(appRoot, "..");
const scriptPath = path.join(projectRoot, "autodev", "autodev.sh");
const scriptCwd = path.join(projectRoot, "autodev");
const tasksDir = path.join(appRoot, "tasks");

function ensureTasksDir() {
  fs.mkdirSync(tasksDir, { recursive: true });
}

function taskFile(taskId: string) {
  return path.join(tasksDir, `${taskId}.json`);
}

function defaultLog(taskId: string) {
  return path.join(tasksDir, `${taskId}.log`);
}

function now() {
  return new Date().toISOString();
}

function createTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function writeTask(task: TaskRecord) {
  ensureTasksDir();
  fs.writeFileSync(taskFile(task.taskId), JSON.stringify(task, null, 2));
}

function readTaskRaw(taskId: string): TaskRecord | null {
  try {
    const raw = fs.readFileSync(taskFile(taskId), "utf-8");
    return JSON.parse(raw) as TaskRecord;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tailLines(filePath: string, lines = 200): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  return content.split(/\r?\n/).filter(Boolean).slice(-lines);
}

function parsePhase(lines: string[]) {
  const phaseLine = [...lines].reverse().find((line) => line.includes("Phase "));
  if (!phaseLine) return { currentPhase: 0, phaseTitle: "Waiting", progress: 0 };

  const match = phaseLine.match(/Phase\s+(\d+):\s*(.+)$/i);
  if (!match) return { currentPhase: 0, phaseTitle: "Running", progress: 5 };

  const currentPhase = Number(match[1]);
  const phaseTitle = match[2].trim();
  const progress = Math.min(100, Math.max(5, Math.round((currentPhase / 8) * 100)));
  return { currentPhase, phaseTitle, progress };
}

function parseCompletion(lines: string[]) {
  const joined = lines.join("\n");
  if (joined.includes("All Systems Green — UAT Passed")) {
    return {
      status: "completed" as const,
      exitCode: 0,
      summary: "UAT passed. Build is complete.",
    };
  }
  if (joined.includes("Built — UAT partial") || joined.includes("Built — UAT incomplete")) {
    return {
      status: "failed" as const,
      exitCode: 1,
      summary: "Build finished with failing checks.",
    };
  }
  return null;
}

function refreshTask(task: TaskRecord): TaskRecord {
  const logs = tailLines(task.logFile, 400);
  const phase = parsePhase(logs);

  const next: TaskRecord = {
    ...task,
    ...phase,
    updatedAt: now(),
  };

  if (task.pid && task.status === "running" && !isPidAlive(task.pid)) {
    const completion = parseCompletion(logs);
    if (completion) {
      next.status = completion.status;
      next.exitCode = completion.exitCode;
      next.lastSummary = completion.summary;
      next.endedAt = now();
    } else {
      next.status = "stopped";
      next.exitCode = task.exitCode ?? 1;
      next.lastSummary = "Process ended.";
      next.endedAt = now();
    }
    next.pid = null;
  }

  writeTask(next);
  return next;
}

export function listTasks(): TaskRecord[] {
  ensureTasksDir();
  const files = fs
    .readdirSync(tasksDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(tasksDir, f));

  const tasks: TaskRecord[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as TaskRecord;
      tasks.push(refreshTask(parsed));
    } catch {
      // skip broken file
    }
  }

  return tasks.sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
}

export function getTask(taskId: string): TaskRecord | null {
  const task = readTaskRaw(taskId);
  return task ? refreshTask(task) : null;
}

export function readTaskLogs(taskId: string, lines = 250): string[] {
  const task = getTask(taskId);
  if (!task) return [];
  return tailLines(task.logFile, lines);
}

function spawnTaskProcess(task: TaskRecord, resume: boolean) {
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`autodev.sh not found at ${scriptPath}`);
  }

  if (!resume) {
    fs.writeFileSync(task.logFile, "");
  } else {
    fs.appendFileSync(task.logFile, `\n\n---- Resuming at ${now()} ----\n`);
  }

  const outFd = fs.openSync(task.logFile, "a");
  const child = spawn("bash", [scriptPath, task.goal], {
    cwd: scriptCwd,
    detached: true,
    stdio: ["ignore", outFd, outFd],
    env: process.env,
  });

  child.unref();
  return child.pid ?? null;
}

export function startTask(goal: string): TaskRecord {
  const trimmed = goal.trim();
  if (!trimmed) throw new Error("Goal is required.");

  const running = listTasks().find((t) => t.status === "running");
  if (running) {
    throw new Error(`Task ${running.taskId} is running. Stop/cancel it first.`);
  }

  ensureTasksDir();
  const taskId = createTaskId();
  const task: TaskRecord = {
    taskId,
    goal: trimmed,
    status: "idle",
    pid: null,
    createdAt: now(),
    updatedAt: now(),
    startedAt: null,
    endedAt: null,
    logFile: defaultLog(taskId),
    currentPhase: 0,
    phaseTitle: "Queued",
    progress: 0,
    lastSummary: "Task created.",
    exitCode: null,
  };

  fs.writeFileSync(task.logFile, "");
  const pid = spawnTaskProcess(task, false);

  const next: TaskRecord = {
    ...task,
    status: "running",
    pid,
    startedAt: now(),
    updatedAt: now(),
    currentPhase: 1,
    phaseTitle: "Architecture Planning",
    progress: 8,
    lastSummary: "Task started.",
  };

  writeTask(next);
  return next;
}

export function resumeTask(taskId: string): TaskRecord {
  const task = getTask(taskId);
  if (!task) throw new Error("Task not found.");
  if (task.status === "running") return task;
  if (task.status === "completed" || task.status === "canceled") {
    throw new Error("Cannot resume completed/canceled task.");
  }

  const running = listTasks().find((t) => t.status === "running" && t.taskId !== taskId);
  if (running) {
    throw new Error(`Task ${running.taskId} is running. Stop/cancel it first.`);
  }

  const pid = spawnTaskProcess(task, true);
  const next: TaskRecord = {
    ...task,
    status: "running",
    pid,
    updatedAt: now(),
    startedAt: task.startedAt ?? now(),
    lastSummary: "Task resumed.",
  };

  writeTask(next);
  return next;
}

export function stopTask(taskId: string): TaskRecord {
  const task = getTask(taskId);
  if (!task) throw new Error("Task not found.");
  if (!task.pid || task.status !== "running") return task;

  try {
    process.kill(-task.pid, "SIGTERM");
  } catch {
    try {
      process.kill(task.pid, "SIGTERM");
    } catch {
      // ignore
    }
  }

  const next: TaskRecord = {
    ...task,
    status: "stopped",
    pid: null,
    updatedAt: now(),
    endedAt: now(),
    lastSummary: "Task stopped by user.",
  };

  writeTask(next);
  return next;
}

export function cancelTask(taskId: string): TaskRecord {
  const task = getTask(taskId);
  if (!task) throw new Error("Task not found.");

  if (task.pid && task.status === "running") {
    try {
      process.kill(-task.pid, "SIGTERM");
    } catch {
      try {
        process.kill(task.pid, "SIGTERM");
      } catch {
        // ignore
      }
    }
  }

  const next: TaskRecord = {
    ...task,
    status: "canceled",
    pid: null,
    updatedAt: now(),
    endedAt: now(),
    lastSummary: "Task canceled by user.",
  };

  writeTask(next);
  return next;
}

function detectProjectOutputPath(task: TaskRecord): string | null {
  try {
    if (!fs.existsSync(task.logFile)) return null;
    const lines = fs.readFileSync(task.logFile, "utf-8").split(/\r?\n/);
    const line = lines.find((x) => x.includes("Output:"));
    const m = line?.match(/Output:\s+(.+)$/);
    if (!m?.[1]) return null;
    const p = m[1].trim();
    const allowedRoot = path.resolve(projectRoot, "autodev", "workspace");
    const resolved = path.resolve(p);
    if (resolved.startsWith(allowedRoot)) return resolved;
    return null;
  } catch {
    return null;
  }
}

export function deleteTask(taskId: string) {
  const task = getTask(taskId);
  if (!task) throw new Error("Task not found.");

  if (task.pid && task.status === "running") {
    try {
      process.kill(-task.pid, "SIGTERM");
    } catch {
      try {
        process.kill(task.pid, "SIGTERM");
      } catch {
        // ignore
      }
    }
  }

  const outPath = detectProjectOutputPath(task);
  if (outPath && fs.existsSync(outPath)) {
    fs.rmSync(outPath, { recursive: true, force: true });
  }

  const tf = taskFile(taskId);
  if (fs.existsSync(tf)) fs.rmSync(tf, { force: true });
  if (fs.existsSync(task.logFile)) fs.rmSync(task.logFile, { force: true });

  return { ok: true, deletedOutputPath: outPath };
}
