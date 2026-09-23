import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// A liveness/readiness probe for an external uptime monitor or a load balancer's health check
// (design pack §7 "monitoring and alerts"). Public and unauthenticated on purpose — it must be
// reachable before anyone has signed in — and reports nothing beyond booleans and a timing number.
const g = globalThis as unknown as { __sabeelJobsTimer?: unknown };

export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  // Jobs are informational only, never gate "ok": a valid multi-instance deployment can run the
  // background loop from one supervised process and JOBS_ENABLED=false everywhere else.
  const jobsRunningHere = !!g.__sabeelJobsTimer;
  const body = { ok: dbOk, db: dbOk, jobsRunningHere, tookMs: Date.now() - startedAt };
  return NextResponse.json(body, { status: dbOk ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
