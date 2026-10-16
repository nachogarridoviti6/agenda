import type { Occurrence, Task } from "./types";
import { addDaysZ, capitalize, dayDiff, fmt, hm, isSameDayZ, startOfDayZ } from "./dates";

/** "10:00 – 11:30", "Todo el día", o con fechas si abarca varios días. */
export function occurrenceTimeLabel(o: Occurrence): string {
  if (o.event.allDay) {
    const lastDay = addDaysZ(o.end, -1);
    return isSameDayZ(o.start, lastDay) ? "Todo el día" : `${fmt(o.start, "d MMM")} – ${fmt(lastDay, "d MMM")}`;
  }
  if (isSameDayZ(o.start, o.end) || o.end === addDaysZ(startOfDayZ(o.start), 1))
    return `${hm(o.start)} – ${hm(o.end)}`;
  return `${fmt(o.start, "d MMM H:mm")} – ${fmt(o.end, "d MMM H:mm")}`;
}

/** Etiqueta relativa de la fecha límite de una tarea: "Hoy 23:59", "Mañana", "Ayer", "vie 23 oct". */
export function taskDueLabel(t: Task, now = Date.now()): string {
  if (t.due == null) return "";
  const diff = dayDiff(t.due, now);
  const time = t.dueHasTime ? ` ${hm(t.due)}` : "";
  if (diff === 0) return `Hoy${time}`;
  if (diff === 1) return `Mañana${time}`;
  if (diff === -1) return `Ayer${time}`;
  if (diff > 1 && diff < 7) return `${capitalize(fmt(t.due, "EEEE"))}${time}`;
  return `${fmt(t.due, "EEE d MMM")}${time}`;
}

export function isOverdue(t: Task, now = Date.now()): boolean {
  if (t.due == null || t.completedAt != null) return false;
  return t.dueHasTime ? t.due < now : dayDiff(t.due, now) < 0;
}

export const priorityMarks = (p: number) => (p > 0 ? "!".repeat(p) : "");
