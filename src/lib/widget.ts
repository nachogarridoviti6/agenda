import type { CalEvent, Calendar, Occurrence, Task } from "./types";
import { addDaysZ, dayDiff, fmt, hm, isSameDayZ, isoWeek, startOfDayZ, weekDays } from "./dates";
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

export type NextUp =
  | { kind: "now"; occ: Occurrence; label: string }
  | { kind: "next"; occ: Occurrence; label: string }
  | null;

/** Texto de cuánto falta: "en 25 min", "en 2 h 10 min", "mañana a las 9:00". */
export function untilLabel(start: number, now: number): string {
  const mins = Math.max(0, Math.round((start - now) / 60_000));
  if (mins < 1) return "ahora";
  if (mins < 60) return `en ${mins} min`;
  const d = dayDiff(start, now);
  if (d === 0) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `en ${h} h ${m} min` : `en ${h} h`;
  }
  if (d === 1) return `mañana a las ${hm(start)}`;
  return `${fmt(start, "EEEE")} a las ${hm(start)}`;
}

/**
 * Lo que enseña la cabecera del widget: el evento con hora que está ocurriendo
 * ("Ahora: Cálculo II · hasta 11:00") o el siguiente en las próximas 48 h.
 * Los eventos de todo el día no cuentan.
 */
export function nextUp(occs: Occurrence[], now: number): NextUp {
  const timed = occs.filter((o) => !o.event.allDay && o.end - o.start < 86_400_000).sort((a, b) => a.start - b.start);
  const current = timed.filter((o) => o.start <= now && o.end > now).sort((a, b) => b.start - a.start)[0];
  if (current) return { kind: "now", occ: current, label: `hasta las ${hm(current.end)}` };
  const next = timed.find((o) => o.start > now && o.start - now <= 48 * 3600_000);
  return next ? { kind: "next", occ: next, label: untilLabel(next.start, now) } : null;
}

/** Apariciones de hoy y mañana para el modo "Hoy" del widget. */
export function buildToday(calendars: Calendar[], events: CalEvent[], now: number) {
  const visible = new Set(calendars.filter((c) => c.visible).map((c) => c.id));
  const today = startOfDayZ(now);
  const tomorrow = addDaysZ(today, 1);
  const occs = expandEvents(events, today, addDaysZ(today, 2)).filter((o) => visible.has(o.event.calendarId));
  return {
    today: sortOccurrences(occurrencesOnDay(occs, today)),
    tomorrow: sortOccurrences(occurrencesOnDay(occs, tomorrow)),
    occs,
  };
}
