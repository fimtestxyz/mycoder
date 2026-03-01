"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type Task = {
  taskId: string;
  goal: string;
  status: "idle" | "running" | "stopped" | "completed" | "failed" | "canceled";
  pid: number | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  currentPhase: number;
  phaseTitle: string;
  progress: number;
  lastSummary: string;
};

const AUTO_SCROLL_KEY = "autodev.task.logs.autoscroll.v1";

export default function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [phase4Log, setPhase4Log] = useState<string[]>([]);
  const [lessons, setLessons] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [nowTs, setNowTs] = useState(Date.now());
  const [copyOk, setCopyOk] = useState(false);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const preserveScrollRef = useRef<{ fromBottom: number } | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(AUTO_SCROLL_KEY);
    if (saved === "off") setAutoScroll(false);
  }, []);

  useEffect(() => {
    localStorage.setItem(AUTO_SCROLL_KEY, autoScroll ? "on" : "off");
  }, [autoScroll]);

  const load = useCallback(async () => {
    if (!taskId) return;

    // Capture current scroll offset from bottom before replacing logs
    if (!autoScroll && logContainerRef.current) {
      const el = logContainerRef.current;
      preserveScrollRef.current = { fromBottom: el.scrollHeight - el.scrollTop };
    }

    const safeTaskId = String(taskId).replace(/[{}]/g, "").trim();
    const res = await fetch(`/api/autodev?taskId=${encodeURIComponent(safeTaskId)}&lines=100000`, { cache: "no-store" });
    const data = await res.json();
    setTask(data.selectedTask ?? null);
    setLogs(data.logs ?? []);
    setPhase4Log(data.phase4Log ?? []);
    setLessons(data.lessons ?? []);
  }, [taskId, autoScroll]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2200);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;

    if (autoScroll) {
      el.scrollTop = el.scrollHeight;
      return;
    }

    // Preserve user viewport position when new logs arrive
    if (preserveScrollRef.current) {
      const fromBottom = preserveScrollRef.current.fromBottom;
      el.scrollTop = Math.max(0, el.scrollHeight - fromBottom);
      preserveScrollRef.current = null;
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const effectiveTaskId = task?.taskId ?? String(taskId).replace(/[{}]/g, "").trim();

  const formatDuration = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const visibleLogs = logs.length > 5000 ? logs.slice(-5000) : logs;

  const elapsedMs = (() => {
    if (!task?.startedAt) return null;
    const start = new Date(task.startedAt).getTime();
    const end = task.endedAt ? new Date(task.endedAt).getTime() : nowTs;
    return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
  })();

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      setCopyOk(true);
      setTimeout(() => setCopyOk(false), 1200);
    } catch {
      // ignore
    }
  };

  const action = async (type: "stop" | "resume" | "cancel") => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/autodev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: type, taskId: effectiveTaskId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Action failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const badgeClass = useMemo(() => {
    switch (task?.status) {
      case "running":
        return "bg-emerald-500 text-white";
      case "completed":
        return "bg-sky-500 text-white";
      case "failed":
        return "bg-rose-500 text-white";
      case "stopped":
        return "bg-amber-500 text-white";
      case "canceled":
        return "bg-zinc-500 text-white";
      default:
        return "bg-zinc-200 text-zinc-700";
    }
  }, [task?.status]);

  const Section = ({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) => (
    <details open={defaultOpen} className="group rounded-3xl border border-zinc-200 bg-card shadow-sm">
      <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium flex items-center justify-between">
        <span>{title}</span>
        <span className="text-xs text-zinc-500 group-open:hidden">Expand</span>
        <span className="text-xs text-zinc-500 hidden group-open:inline">Collapse</span>
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );

  return (
    <main className="min-h-screen bg-background p-3 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900">← Back to tasks</Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={() => setAutoScroll((v) => !v)}>
              {autoScroll ? "Auto-scroll: On" : "Auto-scroll: Off"}
            </Button>
          </div>
        </div>

        <Section title={`Task ${effectiveTaskId}`}>
          <div className="mb-3 text-sm text-zinc-600">{task?.goal ?? "Loading..."}</div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge className={`${badgeClass} capitalize`}>{task?.status ?? "idle"}</Badge>
              <span className="text-xs text-zinc-500">PID: {task?.pid ?? "-"}</span>
            </div>
            <div className="grid grid-cols-1 gap-1 text-xs text-zinc-500 md:grid-cols-2">
              <p>Started: {task?.startedAt ? new Date(task.startedAt).toLocaleString() : "-"}</p>
              <p>Ended: {task?.endedAt ? new Date(task.endedAt).toLocaleString() : "-"}</p>
              <p className="md:col-span-2">
                {task?.status === "completed" || task?.status === "canceled"
                  ? `Total time taken: ${elapsedMs !== null ? formatDuration(elapsedMs) : "-"}`
                  : `Time lapse: ${elapsedMs !== null ? formatDuration(elapsedMs) : "-"}`}
              </p>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-zinc-500">
                <span>Phase {task?.currentPhase ?? 0}/8</span>
                <span>{task?.progress ?? 0}%</span>
              </div>
              <Progress value={task?.progress ?? 0} />
              <p className="mt-2 text-sm">{task?.phaseTitle ?? "Waiting"}</p>
              <p className="text-xs text-zinc-500 mt-1">{task?.lastSummary ?? ""}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || task?.status !== "running"} onClick={() => action("stop")}>
                <Pause className="size-4 mr-2" />Stop
              </Button>
              <Button
                variant="outline"
                disabled={busy || !task || ["running", "completed", "canceled"].includes(task.status)}
                onClick={() => action("resume")}
              >
                <Play className="size-4 mr-2" />Resume
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !task || ["completed", "canceled"].includes(task.status)}
                onClick={() => action("cancel")}
              >
                <Trash2 className="size-4 mr-2" />Cancel
              </Button>
            </div>
            {error && <p className="text-sm text-rose-500">{error}</p>}
          </div>
        </Section>

        <Section title="Lessons Reminder" defaultOpen={false}>
          <p className="mb-2 text-xs text-zinc-500">Pulled from autodev lessons for current phase.</p>
          {lessons.length === 0 ? (
            <p className="text-sm text-zinc-500">No lessons yet for this phase.</p>
          ) : (
            <ul className="space-y-1 text-sm text-zinc-700">
              {lessons.map((item, i) => (
                <li key={`${i}-${item.slice(0, 20)}`} className="rounded-lg bg-zinc-50 px-2 py-1">{item}</li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Phase 4 Dependency Verification" defaultOpen={false}>
          <p className="mb-2 text-xs text-zinc-500">Separate install/verification log for package.json/node_modules and Python .venv checks.</p>
          <div className="h-40 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50 p-2 font-mono text-[11px]">
            {phase4Log.length
              ? phase4Log.map((line, i) => (
                  <p key={`${i}-${line.slice(0, 20)}`} className="whitespace-pre-wrap break-words text-zinc-700">{line}</p>
                ))
              : <p className="text-zinc-500">No separate Phase 4 log found yet.</p>}
          </div>
        </Section>

        <Section title="Task Logs" defaultOpen>
          <div className="mb-2 flex items-center justify-end">
            <Button size="sm" variant="outline" onClick={copyLogs}>{copyOk ? "Copied" : "Copy logs"}</Button>
          </div>
          <div
            ref={logContainerRef}
            onScroll={() => {
              const el = logContainerRef.current;
              if (!el) return;
              const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
              if (!nearBottom && autoScroll) setAutoScroll(false);
            }}
            className="h-[70vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs"
          >
            {logs.length > 5000 && (
              <p className="mb-2 text-[11px] text-zinc-500">Showing latest 5000 lines (total: {logs.length}).</p>
            )}
            {visibleLogs.length === 0 ? (
              <p className="text-zinc-500">No logs yet.</p>
            ) : (
              visibleLogs.map((line, idx) => (
                <p key={`${idx}-${line.slice(0, 20)}`} className="whitespace-pre-wrap break-words text-zinc-700">{line}</p>
              ))
            )}
          </div>
        </Section>
      </div>
    </main>
  );
}
