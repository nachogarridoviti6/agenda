import { TZDate } from "@date-fns/tz";
import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  differenceInCalendarDays,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { es } from "date-fns/locale";

/** Zona horaria de la app. Toda la lógica de "qué día es" se resuelve aquí. */
export const TZ = "Europe/Madrid";
export const DAY_MS = 86_400_000;
const WEEK_OPTS = { weekStartsOn: 1 as const };

export const z = (ms: number) => new TZDate(ms, TZ);

/** Instante UTC de una hora "de reloj" en Madrid. `month` empieza en 0. */
export function fromLocal(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new TZDate(year, month, day, hour, minute, 0, 0, TZ).getTime();
}

export const startOfDayZ = (ms: number) => startOfDay(z(ms)).getTime();
/** Suma días de calendario respetando la hora de reloj (no 24 h fijas: hay cambios de hora). */
export const addDaysZ = (ms: number, n: number) => addDays(z(ms), n).getTime();
export const addWeeksZ = (ms: number, n: number) => addWeeks(z(ms), n).getTime();
export const addMonthsZ = (ms: number, n: number) => addMonths(z(ms), n).getTime();
export const addYearsZ = (ms: number, n: number) => addYears(z(ms), n).getTime();
export const startOfWeekZ = (ms: number) => startOfWeek(z(ms), WEEK_OPTS).getTime();
export const startOfMonthZ = (ms: number) => startOfMonth(z(ms)).getTime();
export const startOfYearZ = (ms: number) => startOfYear(z(ms)).getTime();

/** Días de calendario entre dos instantes (en Madrid). */
export const dayDiff = (a: number, b: number) => differenceInCalendarDays(z(a), z(b));
export const isSameDayZ = (a: number, b: number) => dayKey(a) === dayKey(b);

/** "2026-10-16" — clave estable de un día en Madrid. */
export const dayKey = (ms: number) => format(z(ms), "yyyy-MM-dd");

export function parseDayKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return fromLocal(y, m - 1, d);
}

/** "10:30" (24 h) en Madrid. */
export const timeKey = (ms: number) => format(z(ms), "HH:mm");

/** Combina un día ("yyyy-MM-dd") y una hora ("HH:mm") de Madrid en un instante UTC. */
export function combine(day: string, time: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return fromLocal(y, m - 1, d, hh, mm);
}

/** Minutos transcurridos desde la medianoche local (0–1439), o 1440 si es la medianoche siguiente. */
export function minutesIntoDay(ms: number, dayStart: number): number {
  const zd = z(ms);
  const mins = zd.getHours() * 60 + zd.getMinutes();
  return ms > dayStart && mins === 0 && !isSameDayZ(ms, dayStart) ? 1440 : mins;
}

/** Los 7 días (inicio de cada día) de la semana lunes–domingo que contiene `ms`. */
export function weekDays(ms: number): number[] {
  const start = startOfWeekZ(ms);
  return Array.from({ length: 7 }, (_, i) => addDaysZ(start, i));
}

/** Las 6 semanas (42 días) que muestra la vista de mes, empezando en lunes. */
export function monthGridDays(ms: number): number[] {
  const start = startOfWeekZ(startOfMonthZ(ms));
  return Array.from({ length: 42 }, (_, i) => addDaysZ(start, i));
}

export const fmt = (ms: number, pattern: string) => format(z(ms), pattern, { locale: es });

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Rango que cubre una vista, [inicio, fin). */
export function viewRange(view: "day" | "week" | "month" | "year", cursor: number): [number, number] {
  switch (view) {
    case "day": {
      const s = startOfDayZ(cursor);
      return [s, addDaysZ(s, 1)];
    }
    case "week": {
      const s = startOfWeekZ(cursor);
      return [s, addDaysZ(s, 7)];
    }
    case "month": {
      const days = monthGridDays(cursor);
      return [days[0], addDaysZ(days[41], 1)];
    }
    case "year": {
      const s = startOfYearZ(cursor);
      return [startOfWeekZ(s), addDaysZ(startOfWeekZ(addYearsZ(s, 1)), 7)];
    }
  }
}

/** Mueve el cursor una "página" de la vista hacia delante (+1) o atrás (-1). */
export function stepCursor(view: "day" | "week" | "month" | "year", cursor: number, dir: number): number {
  switch (view) {
    case "day":
      return addDaysZ(cursor, dir);
    case "week":
      return addWeeksZ(cursor, dir);
    case "month":
      return addMonthsZ(startOfMonthZ(cursor), dir);
    case "year":
      return addYearsZ(startOfYearZ(cursor), dir);
  }
}

/** Título de la barra superior: "Octubre 2026", "16 – 22 de octubre de 2026"... */
export function viewTitle(view: "day" | "week" | "month" | "year", cursor: number): string {
  switch (view) {
    case "day":
      return capitalize(fmt(cursor, "EEEE, d 'de' MMMM 'de' yyyy"));
    case "week": {
      const days = weekDays(cursor);
      const a = days[0];
      const b = days[6];
      if (fmt(a, "M") === fmt(b, "M")) return capitalize(fmt(a, "MMMM yyyy"));
      if (fmt(a, "y") === fmt(b, "y")) return capitalize(`${fmt(a, "MMM")} – ${fmt(b, "MMM yyyy")}`);
      return capitalize(`${fmt(a, "MMM yyyy")} – ${fmt(b, "MMM yyyy")}`);
    }
    case "month":
      return capitalize(fmt(cursor, "MMMM yyyy"));
    case "year":
      return fmt(cursor, "yyyy");
  }
}

/** Número de semana ISO (las semanas empiezan en lunes). */
export const isoWeek = (ms: number) => Number(format(z(ms), "I"));

/** Instante del día `dayStart` a `min` minutos de reloj desde la medianoche (1440 = medianoche siguiente). */
export function atMinutes(dayStart: number, min: number): number {
  const d = z(dayStart);
  return fromLocal(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(min / 60), min % 60);
}

/** Hora en formato 24 h estilo Apple en español: "9:00", "23:59". */
export const hm = (ms: number) => fmt(ms, "H:mm");
