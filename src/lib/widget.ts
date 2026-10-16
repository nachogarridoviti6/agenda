import type { CalEvent, Calendar, Occurrence, Task } from "./types";
import { addDaysZ, dayDiff, fmt, hm, isSameDayZ, isoWeek, weekDays } from "./dates";
import { expandEvents, compareTasks } from "./occurrences";
import { occurrencesOnDay, sortOccurrences } from "./layout";

export interface WidgetDay {
  day: number;
  isToday: boolean;
  isPast: boolean;
  items: Occurrence[];
}

export interface WidgetWeek {
  title: string; // "Semana 42"
  range: string; // "12 – 18 oct"
  days: WidgetDay[];
  tasks: Task[];
}

/**
 * Datos del widget para la semana (lunes–domingo) que contiene `now`.
 * Tareas: las pendientes que vencen hasta el domingo, incluidas las atrasadas.
 * `keepIds` mantiene visibles un momento las que se acaban de completar.
 */
export function buildWidgetWeek(
  calendars: Calendar[],
  events: CalEvent[],
  tasks: Task[],
  now: number,
  keepIds: ReadonlySet<string> = new Set(),
): WidgetWeek {
  const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
  const days = weekDays(now);
  const end = addDaysZ(days[6], 1);
  const occs = expandEvents(events, days[0], end).filter((o) => visible.has(o.event.calendarId));
  const a = days[0];
  const b = days[6];
  const range =
    fmt(a, "M") === fmt(b, "M") ? `${fmt(a, "d")} – ${fmt(b, "d MMM")}` : `${fmt(a, "d MMM")} – ${fmt(b, "d MMM")}`;
  return {
    title: `Semana ${isoWeek(now)}`,
    range,
    days: days.map((d) => ({
      day: d,
      isToday: isSameDayZ(d, now),
      isPast: dayDiff(d, now) < 0,
      items: sortOccurrences(occurrencesOnDay(occs, d)),
    })),
    tasks: tasks
      .filter((t) => visible.has(t.calendarId) && t.due != null && t.due < end && (t.completedAt == null || keepIds.has(t.id)))
      .sort(compareTasks),
  };
}

/** Etiqueta corta para la lista del widget: "Hoy 23:59", "vie", "lun 12" (atrasada). */
export function shortDue(t: Task, now: number): string {
  if (t.due == null) return "";
  const diff = dayDiff(t.due, now);
  const time = t.dueHasTime ? ` ${hm(t.due)}` : "";
  if (diff === 0) return `Hoy${time}`;
  if (diff === 1) return `Mañana${time}`;
  if (diff < 0) return fmt(t.due, "EEE d");
  return `${fmt(t.due, "EEE")}${time}`;
}
