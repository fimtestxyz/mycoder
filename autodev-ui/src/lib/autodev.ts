import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type RunnerStatus = "idle" | "running" | "stopped" | "completed" | "failed";

export type AutodevState = {
  status: RunnerStatus;
  goal: string;
  pid: number | null;
  startedAt: string | null;
  updatedAt: string;
  logFile: string;
  currentPhase: number;
  phaseTitle: string;
  progress: number;
  lastSummary: string;
  exitCode: number | null;
};

const projectRoot = path.resolve(process.cwd(), "..");
const runtimeDir = path.join(projectRoot, ".autodev-ui-runtime");
const stateFile = path.join(runtimeDir, "state.json");
const defaultLog = path.join(runtimeDir, "autodev.log");
const scriptPath = path.join(projectRoot, "autodev", "autodev.sh");
const scriptCwd = path.join(projectRoot, "autodev");

const defaultState: AutodevState = {
  status: "idle",
  goal: "",
  pid: null,
  startedAt: null,
  updatedAt: new Date().toISOString(),
  logFile: defaultLog,
  currentPhase: 0,
  phaseTitle: "Waiting",
  progress: 0,
  lastSummary: "",
  exitCode: null,
};

function ensureRuntime() {
  fs.mkdirSync(runtimeDir, { recursive: true });
  if (!fs.existsSync(stateFile)) {
    fs.writeFileSync(stateFile, JSON.stringify(defaultState, null, 2));
  }
  if (!fs.existsSync(defaultLog)) {
    fs.writeFileSync(defaultLog, "");
  }
}

export function readState(): AutodevState {
  ensureRuntime();

  try {
    const raw = fs.readFileSync(stateFile, "utf-8");
    const parsed = JSON.parse(raw) as AutodevState;
    return refreshStateFromProcess(parsed);
  } catch {
    return defaultState;
  }
}

function writeState(state: AutodevState) {
  ensureRuntime();
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

function isPidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tailLines(filePath: string, lines = 250): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf-8");
  return content.split(/\r?\n/).filter(Boolean).slice(-lines);
}

function parsePhase(lines: string[]) {
  const phaseLine = [...lines].reverse().find((line) => line.includes("Phase "));
  if (!phaseLine) {
    return { currentPhase: 0, phaseTitle: "Waiting", progress: 0 };
  }

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
    return { status: "completed" as const, exitCode: 0, summary: "UAT passed. Build is complete." };
  }
  if (joined.includes("Built — UAT partial") || joined.includes("Built — UAT incomplete")) {
    return { status: "failed" as const, exitCode: 1, summary: "Build finished with failing checks." };
  }
  return null;
}

function refreshStateFromProcess(state: AutodevState): AutodevState {
  const logs = tailLines(state.logFile, 400);
  const phase = parsePhase(logs);

  const next: AutodevState = {
    ...state,
    ...phase,
    updatedAt: new Date().toISOString(),
  };

  if (state.pid && !isPidAlive(state.pid) && state.status === "running") {
    const completion = parseCompletion(logs);
    if (completion) {
      next.status = completion.status;
      next.exitCode = completion.exitCode;
      next.lastSummary = completion.summary;
    } else {
      next.status = "stopped";
      next.lastSummary = "Process ended.";
      next.exitCode = next.exitCode ?? 1;
    }
    next.pid = null;
  }

  writeState(next);
  return next;
}

export function readLogs(lines = 200) {
  const state = readState();
  return tailLines(state.logFile, lines);
}

export function startAutodev(goal: string, resume = false): AutodevState {
  ensureRuntime();

  const current = readState();
  if (current.status === "running" && current.pid) {
    return current;
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`autodev.sh not found at ${scriptPath}`);
  }

  const logFile = defaultLog;
  const goalToRun = goal.trim() || current.goal;

  if (!goalToRun) {
    throw new Error("Goal is required to start autodev.");
  }

  if (!resume) {
    fs.writeFileSync(logFile, "");
  }

  const outFd = fs.openSync(logFile, "a");
  const child = spawn("bash", [scriptPath, goalToRun], {
    cwd: scriptCwd,
    detached: true,
    stdio: ["ignore", outFd, outFd],
    env: process.env,
  });

  child.unref();

  const next: AutodevState = {
    ...current,
    status: "running",
    goal: goalToRun,
    pid: child.pid ?? null,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logFile,
    currentPhase: resume ? current.currentPhase : 1,
    phaseTitle: resume ? current.phaseTitle : "Architecture Planning",
    progress: resume ? Math.max(5, current.progress) : 8,
    lastSummary: resume ? "Resumed from previous state." : "Started autodev run.",
    exitCode: null,
  };

  writeState(next);
  return next;
}

export function stopAutodev(): AutodevState {
  const current = readState();

  if (!current.pid || current.status !== "running") {
    return current;
  }

  try {
    process.kill(-current.pid, "SIGTERM");
  } catch {
    try {
      process.kill(current.pid, "SIGTERM");
    } catch {
      // no-op
    }
  }

  const next: AutodevState = {
    ...current,
    status: "stopped",
    pid: null,
    updatedAt: new Date().toISOString(),
    lastSummary: "Run stopped by user.",
  };

  writeState(next);
  return next;
}
