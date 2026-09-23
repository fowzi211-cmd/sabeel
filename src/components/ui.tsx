import type { ReactNode } from "react";

// Shared, hook-free building blocks. Class strings use logical properties for RTL.

export const btn = {
  base: "inline-flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-[15px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 min-h-[44px]",
  primary: "bg-aqua-600 text-white hover:bg-aqua-700 border border-aqua-600",
  secondary: "bg-white text-aqua-700 border border-aqua-600 hover:bg-aqua-100",
  danger: "bg-white text-bad border border-bad hover:bg-bad-bg",
  ghost: "bg-transparent text-aqua-700 hover:bg-aqua-100 border border-transparent",
};
export const btnCls = (kind: keyof Omit<typeof btn, "base"> = "primary", extra = "") =>
  `${btn.base} ${btn[kind]} ${extra}`.trim();

export const inputCls =
  "w-full rounded-[10px] border-[1.5px] border-line bg-white px-3 py-2.5 text-[15px] text-ink placeholder:text-muted/70 focus:border-aqua-600 min-h-[44px]";
export const labelCls = "mb-1 block text-sm font-medium text-ink";

export function Card({ children, className = "", tint = false }: { children: ReactNode; className?: string; tint?: boolean }) {
  return (
    <section className={`rounded-xl border p-4 sm:p-5 ${tint ? "border-[#BFE3EA] bg-aqua-100" : "border-line bg-white"} ${className}`}>
      {children}
    </section>
  );
}

const tones = {
  neutral: "bg-[#EEF3F5] text-muted",
  ok: "bg-ok-bg text-[#14704B]",
  warn: "bg-warn-bg text-warn",
  bad: "bg-bad-bg text-bad",
  info: "bg-aqua-100 text-aqua-700",
} as const;
export type Tone = keyof typeof tones;

/** `wrap` lets long text (e.g. a restriction reason) break onto several lines instead of overflowing on phones. */
export function Chip({ tone = "neutral", wrap = false, children }: { tone?: Tone; wrap?: boolean; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-semibold ${wrap ? "max-w-full rounded-2xl" : "whitespace-nowrap rounded-full"} ${tones[tone]}`}>{children}</span>;
}

const banners = {
  info: "border-[#BFE3EA] bg-aqua-100 text-aqua-700",
  ok: "border-[#B9E2CD] bg-ok-bg text-[#14704B]",
  warn: "border-[#F0D9A2] bg-warn-bg text-[#6B4700]",
  bad: "border-[#F0BDB4] bg-bad-bg text-[#8C2B1D]",
} as const;

export function Banner({ tone = "info", children, role }: { tone?: keyof typeof banners; children: ReactNode; role?: "alert" | "status" }) {
  return (
    <div role={role} className={`rounded-[10px] border px-3.5 py-2.5 text-sm ${banners[tone]}`}>
      {children}
    </div>
  );
}

export function PageHeading({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-ink sm:text-[28px]">{title}</h1>
        {sub ? <p className="mt-1 max-w-2xl text-muted">{sub}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-medium text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full min-w-[560px] text-sm">{children}</table>
    </div>
  );
}
export const th = "bg-[#F1F6F8] px-3 py-2 text-start text-xs font-semibold text-muted";
export const td = "border-t border-line px-3 py-2.5 align-middle text-start";

export function statusTone(status: string): Tone {
  switch (status) {
    case "ACTIVE":
    case "VERIFIED":
      return "ok";
    case "PENDING":
    case "UPLOADED":
    case "NEEDS_INFO":
    case "PAUSED":
      return "warn";
    case "REJECTED":
    case "SUSPENDED":
      return "bad";
    default:
      return "neutral";
  }
}

export const fmtDate = (d: Date | string, locale: "ar" | "en", withTime = false) =>
  new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(new Date(d));
