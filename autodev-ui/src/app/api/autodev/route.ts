import { NextRequest, NextResponse } from "next/server";
import { readLogs, readState, startAutodev, stopAutodev } from "@/lib/autodev";

export async function GET(request: NextRequest) {
  const lines = Number(request.nextUrl.searchParams.get("lines") ?? 180);
  const state = readState();
  const logs = readLogs(Math.min(1000, Math.max(50, lines)));

  return NextResponse.json({ state, logs });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: "start" | "stop" | "resume";
      goal?: string;
    };

    const action = body.action;

    if (action === "start") {
      const state = startAutodev(body.goal ?? "", false);
      return NextResponse.json({ ok: true, state });
    }

    if (action === "resume") {
      const state = startAutodev(body.goal ?? "", true);
      return NextResponse.json({ ok: true, state });
    }

    if (action === "stop") {
      const state = stopAutodev();
      return NextResponse.json({ ok: true, state });
    }

    return NextResponse.json({ ok: false, error: "Invalid action." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
