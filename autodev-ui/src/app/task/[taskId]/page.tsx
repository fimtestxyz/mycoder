"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

type Task = {
  taskId: string;
  goal: string;
  status: "idle" | "running" | "stopped" | "completed" | "failed" | "canceled";
  pid: number | null;
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
  const [lessons, setLessons] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(AUTO_SCROLL_KEY);
    if (saved === "off") setAutoScroll(false);
  }, []);

  useEffect(() => {
    localStorage.setItem(AUTO_SCROLL_KEY, autoScroll ? "on" : "off");
  }, [autoScroll]);

  const load = useCallback(async () => {
    if (!taskId) return;
    const safeTaskId = String(taskId).replace(/[{}]/g, "").trim();
    const res = await fetch(`/api/autodev?taskId=${encodeURIComponent(safeTaskId)}&lines=400`, { cache: "no-store" });
    const data = await res.json();
    setTask(data.selectedTask ?? null);
    setLogs(data.logs ?? []);
    setLessons(data.lessons ?? []);
  }, [taskId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2200);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!autoScroll || !logContainerRef.current) return;
    const el = logContainerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [logs, autoScroll]);

  const effectiveTaskId = task?.taskId ?? String(taskId).replace(/[{}]/g, "").trim();

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

        <Card className="rounded-3xl border-zinc-200 bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Task {effectiveTaskId}</CardTitle>
            <CardDescription>{task?.goal ?? "Loading..."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge className={`${badgeClass} capitalize`}>{task?.status ?? "idle"}</Badge>
              <span className="text-xs text-zinc-500">PID: {task?.pid ?? "-"}</span>
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
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-zinc-200 bg-card shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Lessons Reminder</CardTitle>
            <CardDescription className="text-xs">Pulled from autodev lessons for current phase.</CardDescription>
          </CardHeader>
          <CardContent>
            {lessons.length === 0 ? (
              <p className="text-sm text-zinc-500">No lessons yet for this phase.</p>
            ) : (
              <ul className="space-y-1 text-sm text-zinc-700">
                {lessons.map((item, i) => (
                  <li key={`${i}-${item.slice(0, 20)}`} className="rounded-lg bg-zinc-50 px-2 py-1">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-zinc-200 bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Task Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              ref={logContainerRef}
              className="h-[56vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs"
            >
              {logs.length === 0 ? (
                <p className="text-zinc-500">No logs yet.</p>
              ) : (
                logs.map((line, idx) => (
                  <p key={`${idx}-${line.slice(0, 20)}`} className="whitespace-pre-wrap break-words text-zinc-700">
                    {line}
                  </p>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
