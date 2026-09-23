import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { Role } from "@prisma/client";
import { getEnv } from "./env";
import { AppError } from "./errors";
import { getCurrentSession, hasRole, type CurrentSession } from "./session";
import type { RequestMeta } from "./audit";

export interface RouteContext<P> {
  req: NextRequest;
  params: P;
  meta: RequestMeta;
  /** Present unless the route is declared `auth: "none"`. */
  current: CurrentSession;
}

export interface RouteOptions {
  /** "none": public. "user": any signed-in user. Default "user". */
  auth?: "none" | "user";
  /** Signed-in user must hold one of these roles (SUPER_ADMIN always passes). */
  roles?: Role[];
  /** Allow a privileged session that has not completed two-step verification (login / 2FA setup routes). */
  allowMfaPending?: boolean;
}

/** Client address. Behind a reverse proxy, the proxy must set X-Forwarded-For. */
export function requestMeta(req: NextRequest): RequestMeta {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: forwarded || req.headers.get("x-real-ip") || null, ua: req.headers.get("user-agent") };
}

/** CSRF defence: browsers always send Origin on cross-site writes; it must be ours. */
function assertSameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser client (curl, server-to-server) — no ambient cookies to abuse
  if (new URL(origin).host !== new URL(getEnv().APP_ORIGIN).host) throw new AppError("FORBIDDEN");
}

export function route<P = Record<string, never>>(
  opts: RouteOptions,
  handler: (ctx: RouteContext<P>) => Promise<Response | object>,
) {
  return async (req: NextRequest, segment: { params: Promise<P> }): Promise<Response> => {
    try {
      assertSameOrigin(req);

      let current = null as CurrentSession | null;
      if ((opts.auth ?? "user") !== "none") {
        current = await getCurrentSession();
        if (!current) throw new AppError("UNAUTHENTICATED");
        if (current.mfaPending && !opts.allowMfaPending) throw new AppError("MFA_REQUIRED");
        if (opts.roles && !hasRole(current.user.roles, ...opts.roles)) throw new AppError("FORBIDDEN");
      }

      const result = await handler({
        req,
        params: await segment.params,
        meta: requestMeta(req),
        current: current as CurrentSession,
      });
      return result instanceof Response ? result : NextResponse.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return NextResponse.json(err.toJSON(), { status: err.status });
  }
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const app = new AppError("VALIDATION", {
      field: first?.path.join("."),
      details: { issues: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) },
    });
    return NextResponse.json(app.toJSON(), { status: app.status });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json(new AppError("INTERNAL").toJSON(), { status: 500 });
}

export async function parseJson<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("BAD_REQUEST");
  }
  return schema.parse(body);
}
