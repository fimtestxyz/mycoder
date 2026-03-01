import { NextRequest, NextResponse } from "next/server";
import { createLesson, deleteLesson, listLessons, updateLesson } from "@/lib/lesson-manager";

export async function GET() {
  return NextResponse.json({ lessons: listLessons() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { phase: number; phase_name: string; status: string; summary: string };
    const lesson = createLesson(body);
    return NextResponse.json({ ok: true, lesson });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { id: string; phase?: number; phase_name?: string; status?: string; summary?: string };
    const lesson = updateLesson(body.id, body);
    if (!lesson) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, lesson });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
  const ok = deleteLesson(id);
  return NextResponse.json({ ok });
}
