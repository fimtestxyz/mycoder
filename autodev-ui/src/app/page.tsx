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
  Save,
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
  currentPhase: number;
  phaseTitle: string;
  progress: number;
  lastSummary: string;
};

type ModelTag = {
  name: string;
  details?: { parameter_size?: string; quantization_level?: string };
};

type AgentConfig = {
  planner_model: string;
  coder_model: string;
  repair_model: string;
  repair_model_fallback: string;
};

const SIDEBAR_PREF_KEY = "autodev.sidebar.pref.v1";

export default function Home() {
  const [goal, setGoal] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [modelLogs, setModelLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<280 | 320 | 360>(320);
  const [showTaskId, setShowTaskId] = useState(true);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [availableModels, setAvailableModels] = useState<ModelTag[]>([]);
  const [runningModels, setRunningModels] = useState<{ model?: string; name?: string }[]>([]);
  const [ollamaUp, setOllamaUp] = useState(false);
  const [config, setConfig] = useState<AgentConfig>({
    planner_model: "",
    coder_model: "",
    repair_model: "",
    repair_model_fallback: "",
  });

  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SIDEBAR_PREF_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { collapsed?: boolean; sidebarWidth?: 280 | 320 | 360; showTaskId?: boolean };
      if (typeof parsed.collapsed === "boolean") setCollapsed(parsed.collapsed);
      if (parsed.sidebarWidth) setSidebarWidth(parsed.sidebarWidth);
      if (typeof parsed.showTaskId === "boolean") setShowTaskId(parsed.showTaskId);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_PREF_KEY, JSON.stringify({ collapsed, sidebarWidth, showTaskId }));
  }, [collapsed, sidebarWidth, showTaskId]);

  const load = useCallback(async () => {
    const query = selectedTaskId ? `?taskId=${selectedTaskId}&lines=280` : "?lines=280";
    const res = await fetch(`/api/autodev${query}`, { cache: "no-store" });
    const data = await res.json();

    setTasks(data.tasks ?? []);
    setSelectedTask(data.selectedTask ?? null);
    setLogs(data.logs ?? []);
    setModelLogs(data.modelLogs ?? []);

    setOllamaUp(!!data.ollama?.serviceUp);
    setAvailableModels(data.ollama?.availableModels ?? []);
    setRunningModels(data.ollama?.runningModels ?? []);

    if (data.config) {
      setConfig({
        planner_model: data.config.planner_model ?? "",
        coder_model: data.config.coder_model ?? "",
        repair_model: data.config.repair_model ?? "",
        repair_model_fallback: data.config.repair_model_fallback ?? "",
      });
    }

    if (!selectedTaskId && data.selectedTaskId) setSelectedTaskId(data.selectedTaskId);
  }, [selectedTaskId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (autoScroll) logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

  const saveConfig = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/autodev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "updateConfig", config }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Cannot save config");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save config");
    } finally {
      setBusy(false);
    }
  };

  const filteredTasks = tasks.filter((t) => `${t.taskId} ${t.goal} ${t.status}`.toLowerCase().includes(filter.toLowerCase()));

  const statusClass = useMemo(() => {
    switch (selectedTask?.status) {
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
  }, [selectedTask?.status]);

  const sidebarPx = collapsed ? 68 : sidebarWidth;

  return (
    <main className="min-h-screen bg-[#f5f5f7] p-3 md:p-6 text-zinc-900">
      <div className="mx-auto max-w-7xl flex gap-3 md:gap-4">
        <motion.aside animate={{ width: sidebarPx }} className="hidden md:block rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <div className="p-3 flex items-center justify-between">
            {!collapsed && <p className="font-semibold">Tasks</p>}
            <Button size="icon" variant="ghost" onClick={() => setCollapsed((v) => !v)}>
              {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            </Button>
          </div>

          {!collapsed && (
            <div className="px-3 pb-3 space-y-3">
              <Input placeholder="Filter tasks" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <div className="rounded-2xl border border-zinc-200 p-2 space-y-2 bg-zinc-50">
                <p className="text-xs text-zinc-500">Sidebar settings</p>
                <div className="flex items-center justify-between text-xs">
                  <span>Width</span>
                  <select
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1"
                    value={sidebarWidth}
                    onChange={(e) => setSidebarWidth(Number(e.target.value) as 280 | 320 | 360)}
                  >
                    <option value={280}>Compact</option>
                    <option value={320}>Default</option>
                    <option value={360}>Wide</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={showTaskId} onChange={(e) => setShowTaskId(e.target.checked)} />
                  Show task IDs
                </label>
              </div>

              <ScrollArea className="h-[68vh]">
                <div className="space-y-2 pr-1">
                  {filteredTasks.map((task) => (
                    <button
                      key={task.taskId}
                      onClick={() => setSelectedTaskId(task.taskId)}
                      className={`w-full rounded-2xl border px-3 py-2 text-left ${
                        selectedTaskId === task.taskId ? "border-zinc-900 bg-zinc-100" : "border-zinc-200 hover:border-zinc-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        {showTaskId ? <p className="text-[11px] text-zinc-500 truncate">{task.taskId}</p> : <span />}
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
          <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl md:text-2xl">AutoDev Studio</CardTitle>
              <CardDescription>Task orchestration + Ollama management in one minimalist workspace.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="md:hidden">
                <Button className="w-full" variant="outline" onClick={() => setCollapsed((v) => !v)}>
                  <ListTodo className="mr-2 size-4" /> {collapsed ? "Show Tasks" : "Hide Tasks"}
                </Button>
                <AnimatePresence>
                  {!collapsed && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-2 p-2 rounded-2xl border bg-zinc-50">
                      <Input placeholder="Filter tasks" value={filter} onChange={(e) => setFilter(e.target.value)} />
                      <div className="max-h-44 overflow-auto mt-2 space-y-2">
                        {filteredTasks.map((task) => (
                          <button
                            key={task.taskId}
                            onClick={() => setSelectedTaskId(task.taskId)}
                            className="w-full text-left rounded-xl border border-zinc-200 bg-white px-2 py-2"
                          >
                            <div className="flex justify-between">
                              {showTaskId ? <p className="text-[11px] text-zinc-500 truncate">{task.taskId}</p> : <span />}
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

              <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Describe your build goal" className="h-12 rounded-xl" />

              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || !goal.trim()} onClick={() => runAction("start")}><Play className="size-4 mr-2" />Start</Button>
                <Button variant="secondary" disabled={busy || selectedTask?.status !== "running"} onClick={() => runAction("stop")}><Pause className="size-4 mr-2" />Stop</Button>
                <Button variant="outline" disabled={busy || !selectedTask || ["running", "completed", "canceled"].includes(selectedTask.status)} onClick={() => runAction("resume")}><Square className="size-4 mr-2" />Resume</Button>
                <Button variant="destructive" disabled={busy || !selectedTask || ["completed", "canceled"].includes(selectedTask.status)} onClick={() => runAction("cancel")}><Trash2 className="size-4 mr-2" />Cancel</Button>
              </div>
              {error && <p className="text-sm text-rose-500">{error}</p>}
            </CardContent>
          </Card>

          <div className="grid gap-3 md:gap-4 lg:grid-cols-5">
            <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm lg:col-span-2">
              <CardHeader><CardTitle className="text-lg flex gap-2 items-center"><Activity className="size-4" />Task Status</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between"><Badge className={`${statusClass} capitalize`}>{selectedTask?.status ?? "idle"}</Badge><p className="text-xs text-zinc-500">PID: {selectedTask?.pid ?? "-"}</p></div>
                <div><div className="mb-1 text-xs text-zinc-500 flex justify-between"><span>Phase {selectedTask?.currentPhase ?? 0}/8</span><span>{selectedTask?.progress ?? 0}%</span></div><Progress value={selectedTask?.progress ?? 0} /><p className="mt-2 text-sm">{selectedTask?.phaseTitle ?? "Waiting"}</p></div>
                <Separator />
                <p className="text-xs text-zinc-500">Task ID</p><p className="text-sm break-all">{selectedTask?.taskId ?? "-"}</p>
                <p className="text-xs text-zinc-500">Summary</p><p className="text-sm">{selectedTask?.lastSummary ?? "No updates"}</p>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm lg:col-span-3">
              <CardHeader>
                <div className="flex items-center justify-between"><CardTitle className="text-lg">Live Logs</CardTitle><Button size="sm" variant="ghost" onClick={() => setAutoScroll((v) => !v)}>{autoScroll ? "Auto-scroll: On" : "Auto-scroll: Off"}</Button></div>
                <CardDescription>Current selected task output</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[360px] rounded-2xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs">
                  {logs.length ? logs.map((line, idx) => <p key={`${idx}-${line.slice(0, 16)}`} className="whitespace-pre-wrap break-words text-zinc-700">{line}</p>) : <p className="text-zinc-500">No logs yet.</p>}
                  <div ref={logsEndRef} />
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-3 md:gap-4 lg:grid-cols-2">
            <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle>Ollama Management UI</CardTitle>
                <CardDescription>Loaded from <code>autodev/config/agent.config.json</code>, editable with available local models.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Ollama status</span>
                  <Badge className={ollamaUp ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"}>{ollamaUp ? "Running" : "Down"}</Badge>
                </div>
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Running models</p>
                  <div className="flex flex-wrap gap-2">
                    {runningModels.length ? runningModels.map((m, i) => <Badge key={`${m.name}-${i}`} variant="secondary">{m.name || m.model}</Badge>) : <p className="text-sm text-zinc-500">No active model process</p>}
                  </div>
                </div>

                {([
                  ["planner_model", "Planner model"],
                  ["coder_model", "Coder model"],
                  ["repair_model", "Repair model"],
                  ["repair_model_fallback", "Repair fallback"],
                ] as const).map(([key, label]) => (
                  <div key={key} className="space-y-1">
                    <p className="text-xs text-zinc-500">{label}</p>
                    <select
                      className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm"
                      value={config[key]}
                      onChange={(e) => setConfig((prev) => ({ ...prev, [key]: e.target.value }))}
                    >
                      <option value={config[key]}>{config[key] || "Select model"}</option>
                      {availableModels.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} {m.details?.parameter_size ? `(${m.details.parameter_size})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}

                <Button onClick={saveConfig} disabled={busy} className="w-full"><Save className="size-4 mr-2" />Save model config</Button>
              </CardContent>
            </Card>

            <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
              <CardHeader>
                <CardTitle>Ollama / Agent Logs</CardTitle>
                <CardDescription>Planner/Coder/Repair events extracted from recent task logs.</CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[320px] rounded-2xl border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs">
                  {modelLogs.length ? modelLogs.map((line, i) => <p key={`${i}-${line.slice(0, 20)}`} className="whitespace-pre-wrap text-zinc-700">{line}</p>) : <p className="text-zinc-500">No model logs yet.</p>}
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
