"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, Settings2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

type Task = {
  taskId: string;
  goal: string;
  status: "idle" | "running" | "stopped" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
};

const PINNED_KEY = "autodev.tasks.pinned.v1";

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goal, setGoal] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/autodev", { cache: "no-store" });
    const data = await res.json();
    setTasks(data.tasks ?? []);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(PINNED_KEY);
    if (!saved) return;
    try {
      const ids = JSON.parse(saved) as string[];
      setPinned(Array.isArray(ids) ? ids : []);
    } catch {
      setPinned([]);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(PINNED_KEY, JSON.stringify(pinned));
  }, [pinned]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const createTask = async () => {
    if (!goal.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/autodev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", goal }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Failed to create task");
      setGoal("");
      await load();
      window.location.href = `/task/${data.task.taskId}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const togglePin = (taskId: string) => {
    setPinned((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
  };

  const sortedTasks = useMemo(() => {
    const list = [...tasks];
    list.sort((a, b) => +new Date(b.createdAt || b.updatedAt) - +new Date(a.createdAt || a.updatedAt));
    return list;
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedTasks;
    return sortedTasks.filter((t) => `${t.taskId} ${t.goal}`.toLowerCase().includes(q));
  }, [sortedTasks, search]);

  const pinnedTasks = filteredTasks.filter((t) => pinned.includes(t.taskId));
  const normalTasks = filteredTasks.filter((t) => !pinned.includes(t.taskId));

  const TaskRow = ({ task }: { task: Task }) => {
    const isPinned = pinned.includes(task.taskId);
    return (
      <Link
        href={`/task/${task.taskId}`}
        key={task.taskId}
        className="block rounded-2xl border border-zinc-200 px-3 py-2 hover:border-zinc-400"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-zinc-500 truncate">{task.taskId}</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                togglePin(task.taskId);
              }}
              className="inline-flex items-center justify-center rounded-md p-1 hover:bg-zinc-100"
              title={isPinned ? "Unpin task" : "Pin task"}
            >
              <Star className={`size-4 ${isPinned ? "fill-yellow-400 text-yellow-500" : "text-zinc-400"}`} />
            </button>
            <Badge className="capitalize">{task.status}</Badge>
          </div>
        </div>
        <p className="mt-1 line-clamp-2 text-sm">{task.goal}</p>
      </Link>
    );
  };

  return (
    <main className="min-h-screen bg-[#f5f5f7] p-3 md:p-6">
      <div className="mx-auto max-w-7xl flex gap-4">
        <motion.aside
          animate={{ width: collapsed ? 64 : 320 }}
          className="hidden md:block rounded-3xl border border-zinc-200 bg-white shadow-sm"
        >
          <div className="p-3 flex items-center justify-between">
            {!collapsed && <p className="font-semibold">Tasks</p>}
            <div className="flex items-center gap-1">
              {!collapsed && (
                <Button size="icon" variant="ghost" onClick={createTask} disabled={busy || !goal.trim()} title="Create task">
                  <Plus className="size-4" />
                </Button>
              )}
              <Button size="icon" variant="ghost" onClick={() => setCollapsed((v) => !v)}>
                {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
              </Button>
            </div>
          </div>

          {!collapsed && (
            <div className="px-3 pb-3">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by task description"
                className="mb-3"
              />
              <ScrollArea className="h-[72vh] pr-1">
                {pinnedTasks.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 text-xs font-medium text-zinc-500">PINNED</p>
                    <div className="space-y-2">
                      {pinnedTasks.map((task) => (
                        <TaskRow key={`p-${task.taskId}`} task={task} />
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <p className="mb-2 text-xs font-medium text-zinc-500">ALL TASKS</p>
                  <div className="space-y-2">
                    {normalTasks.map((task) => (
                      <TaskRow key={task.taskId} task={task} />
                    ))}
                    {filteredTasks.length === 0 && <p className="text-sm text-zinc-500">No matching tasks.</p>}
                  </div>
                </div>
              </ScrollArea>
            </div>
          )}
        </motion.aside>

        <section className="flex-1 space-y-4">
          <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>AutoDev Tasks</CardTitle>
              <CardDescription>Create a new task and open its dedicated page at /task/{"{task_id}"}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Describe a full-stack app goal" className="h-12" />
              <div className="flex gap-2 flex-wrap">
                <Button onClick={createTask} disabled={busy || !goal.trim()}><Plus className="size-4 mr-2" />New task</Button>
                <Link href="/ollama"><Button variant="outline"><Settings2 className="size-4 mr-2" />Ollama Management</Button></Link>
              </div>
              {error && <p className="text-sm text-rose-500">{error}</p>}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
