// Facility Planer · Author: Geray S. Karademir

import * as D from "./day.js";
import * as A from "./agenda.js";

/**
 * Daily reminder with the open tasks of the day (iOS: pre-planned local notifications).
 *
 * A web app cannot schedule notifications or run code at a fixed time while it is closed.
 * So the reminder is shown once a day, the first time the app is open (or opened) at or after
 * the chosen hour. Where supported, the app icon also gets a badge with today's open count.
 */

export const supported = () => "Notification" in window && "serviceWorker" in navigator;

export const permission = () => (supported() ? Notification.permission : "unsupported");

/** Asks for permission (must be called from a tap). Resolves true when allowed. */
export async function requestPermission() {
  if (!supported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

/** Shows today's reminder if it is due, and updates the app badge. */
export async function check(store, prefs) {
  const s = store.snapshot;
  const today = D.today();
  const items = A.openItems(s, today);
  updateBadge(items.length);

  if (!prefs.reminderEnabled || permission() !== "granted") return;
  if (new Date().getHours() < prefs.reminderHour) return;
  if (prefs.lastReminder === D.iso(today)) return;
  prefs.set({ lastReminder: D.iso(today) });
  if (items.length === 0) return;

  const overdue = items.filter((i) => i.dueDate < today).length;
  let summary = `${items.length} ${items.length === 1 ? "Aufgabe" : "Aufgaben"} offen`;
  if (overdue > 0) summary += `, davon ${overdue} überfällig`;
  const lines = items.slice(0, 6).map((i) => `${i.property?.name ?? ""}: ${i.task.title}`);
  if (items.length > 6) lines.push("…");

  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification("Heutige Aufgaben", {
      body: `${summary}\n${lines.join("\n")}`,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: "daily",
      data: { url: "./#/heute" },
    });
  } catch { /* notifications are a convenience */ }
}

function updateBadge(count) {
  try {
    if (count > 0) navigator.setAppBadge?.(count)?.catch?.(() => {});
    else navigator.clearAppBadge?.()?.catch?.(() => {});
  } catch { /* not supported */ }
}
