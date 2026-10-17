import type { Id, Task } from "./types";
import { addDaysZ, addWeeksZ, startOfDayZ, combine, dayKey, timeKey } from "./dates";
import { expandRule, formatRRule, parseRRule } from "./rrule";

/** Siguiente fecha límite de una tarea que se repite (o null si la serie ha terminado). */
export function nextDue(t: Task): number | null {
  const rule = parseRRule(t.rrule);
  if (!rule || t.due == null) return null;
  const series = { start: t.due, end: t.due, allDay: !t.dueHasTime };
  return expandRule(rule, series, t.due, t.due + 5 * 366 * 86_400_000).find((s) => s > t.due!) ?? null;
}

/**
 * Marcar una tarea como hecha. Si se repite (como en Recordatorios): se guarda una copia
 * completada para el historial y la tarea pasa a su siguiente fecha.
 */
export function completeTask(t: Task, now: number, newId: () => Id): Task[] {
  const done: Task = { ...t, completedAt: now, updatedAt: now };
  const next = nextDue(t);
  const rule = parseRRule(t.rrule);
  if (next == null || !rule) return [done];
  let rrule = t.rrule ?? null;
  if (rule.count != null) {
    // COUNT cuenta desde la fecha actual: queda una menos.
    if (rule.count <= 1) return [done];
    rrule = formatRRule({ ...rule, count: rule.count - 1 }, !t.dueHasTime);
  }
  return [
    { ...done, id: newId(), rrule: null, createdAt: now },
    { ...t, due: next, rrule, completedAt: null, updatedAt: now },
  ];
}

/** Posponer: hoy, mañana o la semana que viene, manteniendo la hora si la tenía. */
export function snooze(t: Task, to: "today" | "tomorrow" | "nextWeek", now: number): Task {
  const base = startOfDayZ(now);
  const day = to === "today" ? base : to === "tomorrow" ? addDaysZ(base, 1) : addWeeksZ(base, 1);
  const due = t.dueHasTime && t.due != null ? combine(dayKey(day), timeKey(t.due)) : day;
  return { ...t, due, updatedAt: now };
}
