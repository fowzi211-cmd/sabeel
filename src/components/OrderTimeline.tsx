import { getI18n } from "@/i18n";
import { fmtWhen } from "@/lib/format";

interface Ev {
  type: string;
  at: Date | string;
  note?: string | null;
}

/** Steps after "placed" in the order they will happen. Later slices switch more of them on. */
const FLOW = ["AWAITING_SUPPLIER", "ACCEPTED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED_DRIVER_CONFIRMED", "CONFIRMED_BY_BOTH", "PAID", "CLOSED"];
/** Where an order sits on the happy path, including states that sit beside it. */
const POSITION: Record<string, number> = { ESCALATED: 0, FAILED_ATTEMPT: 2 };
const UPCOMING: { key: string; from: number }[] = [
  { key: "accepted", from: 1 },
  { key: "assigned", from: 2 },
  { key: "onTheWay", from: 3 },
  { key: "delivered", from: 4 },
  { key: "confirm", from: 5 },
  { key: "pay", from: 6 },
  { key: "review", from: 7 },
];

/** Vertical progress list: recorded events first, then what is still to come. */
export async function OrderTimeline({ status, events }: { status: string; events: Ev[] }) {
  const { t, locale } = await getI18n();
  const cancelled = status === "CANCELLED";
  const reached = POSITION[status] ?? Math.max(FLOW.indexOf(status), 0);

  const dot = (kind: "done" | "now" | "todo" | "bad") =>
    ({
      done: "bg-ok border-ok",
      now: "bg-aqua-600 border-aqua-600 ring-4 ring-aqua-100",
      todo: "bg-white border-line",
      bad: "bg-bad border-bad",
    })[kind];

  // Most event notes are free text a human typed; DISPUTED/DISPUTE_RESOLVED instead carry a category/outcome code that needs translating.
  const noteFor = (e: Ev) => {
    if (!e.note) return null;
    if (e.type === "DISPUTED") return t(`dispute.category.${e.note}`);
    if (e.type === "DISPUTE_RESOLVED") return t(`dispute.outcome.${e.note}`);
    if (e.type === "CONFIRMED") return t(`dispute.confirmMethod.${e.note}`);
    return e.note;
  };
  const rows: { key: string; label: string; sub?: string; kind: "done" | "now" | "todo" | "bad" }[] = events.map((e) => ({
    key: `${e.type}-${String(e.at)}`,
    label: t(`orders.event.${e.type}`),
    sub: `${fmtWhen(e.at, locale)}${noteFor(e) ? ` — ${noteFor(e)}` : ""}`,
    kind: e.type === "CANCELLED" || e.type === "FAILED_ATTEMPT" || e.type === "DISPUTED" ? "bad" : "done",
  }));

  if (!cancelled) {
    rows.push({ key: "now", label: t(`orders.status.${status}`), kind: "now" });
    for (const u of UPCOMING.filter((x) => x.from > reached)) rows.push({ key: u.key, label: t(`orders.upcoming.${u.key}`), kind: "todo" });
  }

  return (
    <ol className="relative space-y-4 ps-7 before:absolute before:inset-y-2 before:start-[9px] before:w-0.5 before:bg-line" aria-label={t("orders.timeline")}>
      {rows.map((r) => (
        <li key={r.key} className={`relative ${r.kind === "todo" ? "text-muted" : ""}`}>
          <span className={`absolute -start-7 top-1 size-[18px] rounded-full border-2 ${dot(r.kind)}`} aria-hidden />
          <div className={r.kind === "now" || r.kind === "bad" ? "font-semibold" : ""}>{r.label}</div>
          {r.sub ? <div className="text-xs text-muted">{r.sub}</div> : null}
        </li>
      ))}
    </ol>
  );
}
