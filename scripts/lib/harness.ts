/**
 * Shared helpers for the end-to-end verification scripts: an HTTP client with a cookie jar,
 * pass/fail reporting, and sign-in / 2FA helpers that drive the real API.
 */
import { PrismaClient } from "@prisma/client";
import * as OTPAuth from "otpauth";

export const BASE = process.env.VERIFY_BASE ?? "http://localhost:3020";
export const db = new PrismaClient();

let passed = 0;
let failed = 0;
const failures: string[] = [];

export function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}${detail !== undefined ? `  → ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}
export const section = (s: string) => console.log(`\n${s}`);

export function finish() {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("Failures:\n - " + failures.join("\n - "));
    process.exitCode = 1;
  }
}

export interface Res {
  status: number;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
  headers: Headers;
}

export class Client {
  jar = new Map<string, string>();
  async req(method: string, path: string, opts: { body?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<Res> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await fetch(BASE + path, { method, headers, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (value === "" || /max-age=0/i.test(c)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      json = JSON.parse(text);
    } catch {
      /* html or binary */
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  get = (p: string, h?: Record<string, string>) => this.req("GET", p, { headers: h });
  post = (p: string, body?: unknown, h?: Record<string, string>) => this.req("POST", p, { body: body ?? {}, headers: h });
  put = (p: string, body?: unknown) => this.req("PUT", p, { body });
  patch = (p: string, body?: unknown) => this.req("PATCH", p, { body });
  del = (p: string) => this.req("DELETE", p);
}

export const rnd = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
export const newMobile = () => `+9665${rnd(8)}`;
export const newCr = () => `10${rnd(8)}`;

export const totpFor = (b32: string, ts = Date.now()) =>
  new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(b32), digits: 6, period: 30, algorithm: "SHA1" }).generate({ timestamp: ts });

export async function login(c: Client, mobile: string) {
  await db.otpChallenge.deleteMany({ where: { mobile } }); // skip the resend cool-down in tests
  const r1 = await c.post("/api/v1/auth/otp/request", { mobile, lang: "AR" });
  if (r1.status !== 200) throw new Error(`otp request failed: ${r1.status} ${r1.text}`);
  const r2 = await c.post("/api/v1/auth/otp/verify", { mobile, code: r1.json.devCode, lang: "AR" });
  if (r2.status !== 200) throw new Error(`otp verify failed: ${r2.status} ${r2.text}`);
  return r2.json as { next: string; isNew: boolean; user: { id: string; roles: string[] } };
}

export async function enrol(c: Client): Promise<string> {
  const s = await c.post("/api/v1/me/2fa/setup");
  if (s.status !== 200) throw new Error(`2fa setup failed: ${s.status} ${s.text}`);
  const e = await c.post("/api/v1/me/2fa/enable", { token: totpFor(s.json.secretBase32) });
  if (e.status !== 200) throw new Error(`2fa enable failed: ${e.status} ${e.text}`);
  return s.json.secretBase32;
}

/** Forget TOTP state of a seeded staff account so a run can enrol it afresh. */
export async function resetStaff(mobile: string) {
  await db.otpChallenge.deleteMany({ where: { mobile } });
  const u = await db.user.findUnique({ where: { mobile } });
  if (u) {
    await db.user.update({ where: { id: u.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null } });
    await db.session.deleteMany({ where: { userId: u.id } });
  }
}
