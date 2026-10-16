import type { CalEvent, Occurrence, Task } from "./types";
import { dayKey } from "./dates";

/**
 * Convierte los eventos guardados en apariciones concretas dentro de [from, to).
 * (Fase 3: aquí se expanden las series con RRULE y se aplican excepciones.)
 */
export function expandEvents(events: CalEvent[], from: number, to: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const e of events) {
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
