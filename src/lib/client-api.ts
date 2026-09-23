"use client";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public messageAr: string,
    public messageEn: string,
    public field?: string,
    public details?: Record<string, unknown>,
  ) {
    super(messageEn);
  }
  messageFor(locale: "ar" | "en") {
    return locale === "ar" ? this.messageAr : this.messageEn;
  }
}

interface Options {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

/** Thin fetch wrapper that turns the platform's `{error:{code,message_ar,message_en}}` into a typed error. */
export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"),
      headers: { ...(opts.body ? { "Content-Type": "application/json" } : {}), ...(opts.headers ?? {}) },
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "NETWORK", "تعذّر الاتصال بالخادم.", "Could not reach the server.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code ?? "INTERNAL",
      e?.message_ar ?? "حدث خطأ غير متوقع.",
      e?.message_en ?? "Something went wrong.",
      e?.field,
      e?.details,
    );
  }
  return data as T;
}
