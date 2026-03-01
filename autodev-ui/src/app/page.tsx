"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Plus, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

type Task = {
  taskId: string;
  goal: string;
  status: "idle" | "running" | "stopped" | "completed" | "failed" | "canceled";
  updatedAt: string;
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/autodev", { cache: "no-store" });
    const data = await res.json();
    setTasks(data.tasks ?? []);
  }, []);

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
              <ScrollArea className="h-[78vh] pr-1">
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <Link
                      href={`/task/${task.taskId}`}
                      key={task.taskId}
                      className="block rounded-2xl border border-zinc-200 px-3 py-2 hover:border-zinc-400"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-zinc-500 truncate">{task.taskId}</p>
                        <Badge className="capitalize">{task.status}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm">{task.goal}</p>
                    </Link>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </motion.aside>

        <section className="flex-1 space-y-4">
          <Card className="rounded-3xl border-zinc-200 bg-white shadow-sm">
            <CardHeader>
              <CardTitle>AutoDev Tasks</CardTitle>
              <CardDescription>Create a new task and open its dedicated page at /task/{'{task_id}'}.</CardDescription>
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
