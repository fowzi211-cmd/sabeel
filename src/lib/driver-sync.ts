"use client";

import { api, ApiError } from "./client-api";
import { kvGet, kvSet, outboxList, outboxRemove, outboxTouch, type FailedItem, type OutboxItem } from "./driver-offline";

export interface FlushResult {
  sent: number;
  /** True when the phone could not reach the server, so what is left will be retried later. */
  offline: boolean;
  /** True when the sign-in expired; queued work stays on the phone. */
  signedOut: boolean;
  failed: FailedItem[];
}

async function send(item: OutboxItem): Promise<void> {
  const p = item.payload;
  const base = `/driver/jobs/${item.jobId}`;
  switch (item.type) {
    case "START":
      await api(`${base}/start`, { body: p });
      return;
    case "ARRIVED":
      await api(`${base}/arrived`, { body: p });
      return;
    case "PIN":
      await api(`${base}/pin`, { body: p });
      return;
    case "CONFIRM":
      await api(`${base}/confirm`, { body: p });
      return;
    case "FAIL":
      await api(`${base}/fail`, { body: p });
      return;
    case "PHOTO": {
      const form = new FormData();
      form.set("file", item.blob!, "photo.jpg");
      for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null) form.set(k, String(v));
      await api(`${base}/photos`, { form });
      return;
    }
  }
}

let running: Promise<FlushResult> | null = null;

/**
 * Sends queued actions oldest-first. Stops at the first network problem (nothing is lost). A rejected action
 * (the server says no — e.g. the buyer cancelled) is removed from the queue and reported so the driver sees why.
 * Safe to call from several places: overlapping calls share one run.
 */
export function flushOutbox(): Promise<FlushResult> {
  if (running) return running;
  running = (async () => {
    const result: FlushResult = { sent: 0, offline: false, signedOut: false, failed: [] };
    const items = await outboxList();
    for (const item of items) {
      try {
        await send(item);
        await outboxRemove(item.id!);
        result.sent++;
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 0 || e.status >= 500) {
            result.offline = true;
            await outboxTouch({ ...item, tries: item.tries + 1 });
            break;
          }
          if (e.status === 401) {
            result.signedOut = true;
            break;
          }
          // The server refused it for good: drop it from the queue and tell the driver.
          const detail = (e.details as { errors?: { code: string }[] } | undefined)?.errors?.map((x) => x.code).join(", ");
          result.failed.push({ at: Date.now(), orderNo: item.orderNo, type: item.type, ar: `${e.messageAr}${detail ? ` (${detail})` : ""}`, en: `${e.messageEn}${detail ? ` (${detail})` : ""}` });
          await outboxRemove(item.id!);
          continue;
        }
        result.offline = true;
        break;
      }
    }
    if (result.failed.length > 0) {
      const old = (await kvGet<FailedItem[]>("failed")) ?? [];
      await kvSet("failed", [...old, ...result.failed].slice(-20));
    }
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
