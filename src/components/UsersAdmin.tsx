"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/client-api";
import { useI18n } from "@/i18n/provider";
import { Banner, Card, Chip, Field, Table, btnCls, fmtDate, inputCls, td, th } from "./ui";

const STAFF = ["ADMIN_OPS", "ADMIN_SUPPORT", "ADMIN_FINANCE", "SUPER_ADMIN"] as const;
type Staff = (typeof STAFF)[number];

export interface UserRow {
  id: string; mobile: string; name: string | null; roles: string[]; status: string;
  totpEnabledAt: string | null; lastLoginAt: string | null;
}

export function UsersAdmin({ users, meId }: { users: UserRow[]; meId: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, Staff[]>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [f, setF] = useState({ mobile: "", name: "", roles: ["ADMIN_OPS"] as Staff[] });

  const staffOf = (u: UserRow) => (edits[u.id] ?? (u.roles.filter((r) => (STAFF as readonly string[]).includes(r)) as Staff[]));

  async function run(fn: () => Promise<unknown>, okText = t("common.saved")) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "ok", text: okText });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof ApiError ? e.messageFor(locale) : t("common.error") });
    } finally {
      setBusy(false);
    }
  }

  const toggle = (u: UserRow, r: Staff) => {
    const cur = staffOf(u);
    setEdits({ ...edits, [u.id]: cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r] });
  };

  function addStaff(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await api("/admin/users", { body: f });
      setF({ mobile: "", name: "", roles: ["ADMIN_OPS"] });
    });
  }

  return (
    <div className="space-y-5">
      {msg ? <Banner tone={msg.tone} role="status">{msg.text}</Banner> : null}
      <Table>
        <thead>
          <tr>
            <th className={th}>{t("common.name")}</th>
            <th className={th}>{t("common.mobile")}</th>
            <th className={th}>{t("admin.roles")}</th>
            <th className={th}>{t("admin.totp")}</th>
            <th className={th}>{t("common.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const changed = edits[u.id] !== undefined;
            return (
              <tr key={u.id}>
                <td className={td}>{u.name ?? "—"}{u.id === meId ? <span className="text-xs text-muted"> ({t("common.account")})</span> : null}</td>
                <td className={td}><span className="ltr-iso">{u.mobile}</span></td>
                <td className={td}>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {STAFF.map((r) => (
                      <label key={r} className="flex items-center gap-1 text-xs">
                        <input type="checkbox" className="accent-aqua-600" checked={staffOf(u).includes(r)} onChange={() => toggle(u, r)} />
                        {t(`roles.${r}`)}
                      </label>
                    ))}
                  </div>
                  {u.roles.filter((r) => !(STAFF as readonly string[]).includes(r)).map((r) => <Chip key={r}>{t(`roles.${r}`)}</Chip>)}
                </td>
                <td className={td}>
                  <Chip tone={u.totpEnabledAt ? "ok" : "neutral"}>{u.totpEnabledAt ? t("admin.totpOn") : t("admin.totpOff")}</Chip>
                  {u.lastLoginAt ? <div className="text-xs text-muted">{fmtDate(u.lastLoginAt, locale, true)}</div> : null}
                </td>
                <td className={td}>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy || !changed} onClick={() => run(() => api(`/admin/users/${u.id}/roles`, { body: { roles: staffOf(u) } }))} className={btnCls("secondary", "!min-h-9 !py-1.5 text-sm")}>{t("admin.saveRoles")}</button>
                    {u.totpEnabledAt ? <button type="button" disabled={busy} onClick={() => run(() => api(`/admin/users/${u.id}/reset-2fa`, { method: "POST" }))} className={btnCls("danger", "!min-h-9 !py-1.5 text-sm")}>{t("admin.resetTotp")}</button> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <Card>
        <h2 className="mb-3 text-lg font-bold">{t("admin.addStaff")}</h2>
        <form onSubmit={addStaff} className="grid gap-3 sm:grid-cols-3">
          <Field label={t("common.mobile")} htmlFor="s-mobile"><input id="s-mobile" dir="ltr" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} className={`${inputCls} text-start`} /></Field>
          <Field label={t("common.name")} htmlFor="s-name"><input id="s-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inputCls} /></Field>
          <div>
            <span className="mb-1 block text-sm font-medium">{t("admin.roles")}</span>
            <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2">
              {STAFF.map((r) => (
                <label key={r} className="flex items-center gap-1 text-sm">
                  <input type="checkbox" className="accent-aqua-600" checked={f.roles.includes(r)} onChange={() => setF({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] })} />
                  {t(`roles.${r}`)}
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-3"><button type="submit" disabled={busy || !f.mobile || f.name.length < 2 || f.roles.length === 0} className={btnCls("primary")}>{t("admin.addStaff")}</button></div>
        </form>
      </Card>
    </div>
  );
}
