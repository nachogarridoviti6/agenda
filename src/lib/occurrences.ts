import type { CalEvent, Occurrence, Task } from "./types";
import { addDaysZ, dayDiff, dayKey } from "./dates";
import { expandRule, parseRRule } from "./rrule";

/**
 * Convierte los eventos guardados en apariciones concretas dentro de [from, to).
 * Las series (RRULE) se expanden saltándose sus EXDATE; las excepciones ("solo este")
 * son eventos normales con `seriesId` y aparecen por su cuenta.
 */
export function expandEvents(events: CalEvent[], from: number, to: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const e of events) {
    const rule = parseRRule(e.rrule);
    if (rule) {
      const span = e.allDay ? dayDiff(e.end, e.start) : 0;
      for (const start of expandRule(rule, e, from, to)) {
        const end = e.allDay ? addDaysZ(start, span) : start + (e.end - e.start);
        out.push({ key: `${e.id}@${start}`, event: e, start, end });
      }
      continue;
    }
    if (e.start < to && e.end > from) out.push({ key: e.id, event: e, start: e.start, end: e.end });
    else if (e.start === e.end && e.start >= from && e.start < to) out.push({ key: e.id, event: e, start: e.start, end: e.end });
  }
  return out;
}

/** Agrupa las tareas con fecha por día de Madrid ("yyyy-MM-dd"). */
export function tasksByDay(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.due == null) continue;
    const k = dayKey(t.due);
    const list = map.get(k);
    if (list) list.push(t);
    else map.set(k, [t]);
  }
  for (const list of map.values()) list.sort(compareTasks);
  return map;
}

/** Orden de tareas: pendientes primero, luego por fecha/hora, prioridad y título. */
export function compareTasks(a: Task, b: Task): number {
  return (
    Number(a.completedAt != null) - Number(b.completedAt != null) ||
    (a.due ?? Infinity) - (b.due ?? Infinity) ||
    b.priority - a.priority ||
    a.title.localeCompare(b.title)
  );
}
