"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  ListTodo,
  Pause,
  Play,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type Status = "idle" | "running" | "stopped" | "completed" | "failed" | "canceled";

type Task = {
  taskId: string;
  goal: string;
  status: Status;
  pid: number | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  endedAt: string | null;
  currentPhase: number;
  phaseTitle: string;
  progress: number;
  lastSummary: string;
  exitCode: number | null;
};

export default function Home() {
  const [goal, setGoal] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const query = selectedTaskId ? `?taskId=${selectedTaskId}&lines=280` : "?lines=280";
    const res = await fetch(`/api/autodev${query}`, { cache: "no-store" });
    const data = await res.json();
    setTasks(data.tasks ?? []);
    setSelectedTask(data.selectedTask ?? null);
    setLogs(data.logs ?? []);
    if (!selectedTaskId && data.selectedTaskId) setSelectedTaskId(data.selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (autoScroll) {
      logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, autoScroll]);

  const runAction = async (action: "start" | "stop" | "resume" | "cancel", taskId?: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/autodev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, goal, taskId: taskId ?? selectedTaskId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Request failed");

      if (action === "start" && data.task?.taskId) {
        setSelectedTaskId(data.task.taskId);
        setGoal("");
      }

      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const statusClass = useMemo(() => {
    switch (selectedTask?.status) {
      case "running":
        return "bg-emerald-500/90 text-white";
      case "completed":
        return "bg-sky-500/90 text-white";
      case "failed":
        return "bg-rose-500/90 text-white";
      case "stopped":
        return "bg-amber-500/90 text-white";
      case "canceled":
        return "bg-zinc-500 text-white";
      default:
        return "bg-zinc-300 text-zinc-700";
    }
  }, [selectedTask?.status]);

  const filteredTasks = tasks.filter((t) =>
    `${t.taskId} ${t.goal} ${t.status}`.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-[#f5f5f7] text-zinc-900 p-3 md:p-6">
      <div className="mx-auto max-w-7xl flex gap-3 md:gap-4">
        <motion.aside
          animate={{ width: collapsed ? 64 : 320 }}
          className="hidden md:block shrink-0 rounded-3xl border border-zinc-200 bg-white/90 shadow-sm"
        >
          <div className="p-3 flex items-center justify-between">
            {!collapsed && <h2 className="font-semibold">Tasks</h2>}
            <Button variant="ghost" size="icon" onClick={() => setCollapsed((v) => !v)}>
              {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </Button>
          </div>
          {!collapsed && (
            <div className="px-3 pb-3 space-y-3">
              <Input placeholder="Filter tasks..." value={filter} onChange={(e) => setFilter(e.target.value)} />
              <ScrollArea className="h-[74vh] pr-1">
                <div className="space-y-2">
                  {filteredTasks.map((task) => (
                    <button
                      key={task.taskId}
                      onClick={() => setSelectedTaskId(task.taskId)}
                      className={`w-full text-left rounded-2xl border px-3 py-2 transition ${
                        selectedTaskId === task.taskId
                          ? "border-zinc-900 bg-zinc-100"
                          : "border-zinc-200 hover:border-zinc-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-zinc-500 truncate">{task.taskId}</p>
                        <Badge className="capitalize">{task.status}</Badge>
                      </div>
                      <p className="mt-1 text-sm line-clamp-2">{task.goal}</p>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </motion.aside>

        <section className="flex-1 space-y-3 md:space-y-4">
          <Card className="rounded-3xl border-zinc-200 shadow-sm bg-white">
            <CardHeader>
              <CardTitle className="text-xl md:text-2xl">AutoDev Studio</CardTitle>
              <CardDescription>
                Apple-inspired clean control surface for starting, pausing, resuming and canceling tasks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="md:hidden">
                <Button variant="outline" className="w-full" onClick={() => setCollapsed((v) => !v)}>
                  <ListTodo className="mr-2 size-4" />
                  {collapsed ? "Show Tasks" : "Hide Tasks"}
                </Button>
                <AnimatePresence>
                  {!collapsed && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="mt-2 border rounded-2xl p-2 bg-zinc-50"
                    >
                      <Input placeholder="Filter tasks..." value={filter} onChange={(e) => setFilter(e.target.value)} />
                      <div className="mt-2 max-h-44 overflow-auto space-y-2">
                        {filteredTasks.map((task) => (
                          <button
                            key={task.taskId}
                            onClick={() => setSelectedTaskId(task.taskId)}
                            className="w-full text-left rounded-xl border border-zinc-200 bg-white px-2 py-2"
                          >
                            <div className="flex items-center justify-between">
                              <p className="text-[11px] text-zinc-500 truncate">{task.taskId}</p>
                              <Badge className="capitalize">{task.status}</Badge>
                            </div>
                            <p className="text-sm line-clamp-1">{task.goal}</p>
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <Input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Describe your build goal"
                className="h-12 rounded-xl"
              />

              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !goal.trim()} onClick={() => runAction("start")}>
                  <Play className="mr-2 size-4" /> Start task
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || selectedTask?.status !== "running"}
                  onClick={() => runAction("stop")}
                >
                  <Pause className="mr-2 size-4" /> Stop
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !selectedTask || selectedTask.status === "running" || selectedTask.status === "canceled" || selectedTask.status === "completed"}
                  onClick={() => runAction("resume")}
                >
                  <Square className="mr-2 size-4" /> Resume
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || !selectedTask || selectedTask.status === "completed" || selectedTask.status === "canceled"}
                  onClick={() => runAction("cancel")}
                >
                  <Trash2 className="mr-2 size-4" /> Cancel
                </Button>
              </div>

              {error && <p className="text-sm text-rose-500">{error}</p>}
            </CardContent>
          </Card>

          <div className="grid gap-3 md:gap-4 lg:grid-cols-5">
            <Card className="rounded-3xl border-zinc-200 shadow-sm bg-white lg:col-span-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Activity className="size-4" /> Task Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Badge className={`${statusClass} capitalize`}>{selectedTask?.status ?? "idle"}</Badge>
                  <p className="text-xs text-zinc-500">PID: {selectedTask?.pid ?? "-"}</p>
                </div>
                <div>
                  <div className="mb-1 text-xs flex justify-between text-zinc-500">
                    <span>Phase {selectedTask?.currentPhase ?? 0}/8</span>
                    <span>{selectedTask?.progress ?? 0}%</span>
                  </div>
                  <Progress value={selectedTask?.progress ?? 0} />
                  <p className="text-sm mt-2">{selectedTask?.phaseTitle ?? "Waiting"}</p>
                </div>
                <Separator />
                <p className="text-xs text-zinc-500">Task ID</p>
                <p className="text-sm break-all">{selectedTask?.taskId ?? "-"}</p>
                <p className="text-xs text-zinc-500">Summary</p>
                <p className="text-sm">{selectedTask?.lastSummary ?? "No updates"}</p>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-zinc-200 shadow-sm bg-white lg:col-span-3">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">Live Logs</CardTitle>
                  <Button variant="ghost" size="sm" onClick={() => setAutoScroll((v) => !v)}>
                    {autoScroll ? "Auto-scroll: On" : "Auto-scroll: Off"}
                  </Button>
                </div>
                <CardDescription>Useful enhancement: auto-scroll toggle for debugging large outputs.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[420px] rounded-2xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs md:text-sm">
                  {logs.length === 0 ? (
                    <p className="text-zinc-500">No logs yet.</p>
                  ) : (
                    logs.map((line, idx) => (
                      <p key={`${idx}-${line.slice(0, 16)}`} className="whitespace-pre-wrap break-words text-zinc-700">
                        {line}
                      </p>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
