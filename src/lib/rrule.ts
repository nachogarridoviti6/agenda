/**
 * Repeticiones en formato RRULE (RFC 5545), el mismo que usan .ics e iCloud.
 * Subconjunto soportado: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY (con ordinal en
 * mensual: 2TU, -1FR), BYMONTHDAY, UNTIL y COUNT. La expansión se hace en hora de reloj de
 * Madrid: una clase a las 9:00 sigue a las 9:00 después del cambio de hora.
 */
import { addDaysZ, dayDiff, DAY_MS, fmt, fromLocal, z } from "./dates";

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface Rule {
  freq: Freq;
  interval: number;
  /** Semanal: ["MO","WE"]. Mensual: ["3FR"] (tercer viernes) o ["-1FR"] (último). */
  byDay: string[];
  /** Mensual: días del mes (1–31, -1 = último). */
  byMonthDay: number[];
  /** Último inicio permitido (UTC ms, inclusivo) o null. */
  until: number | null;
  count: number | null;
}

const MAX_ITER = 50_000;

export function parseRRule(raw: string | null | undefined): Rule | null {
  if (!raw) return null;
  const parts = Object.fromEntries(
    raw.replace(/^RRULE:/i, "").split(";").filter(Boolean).map((p) => {
      const [k, v = ""] = p.split("=");
      return [k.toUpperCase(), v.toUpperCase()];
    }),
  );
  const freq = parts.FREQ as Freq;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    byDay: parts.BYDAY ? parts.BYDAY.split(",").filter(Boolean) : [],
    byMonthDay: parts.BYMONTHDAY ? parts.BYMONTHDAY.split(",").map(Number).filter((n: number) => n !== 0 && !Number.isNaN(n)) : [],
    until: parts.UNTIL ? parseUntil(parts.UNTIL) : null,
    count: parts.COUNT ? Math.max(1, Number(parts.COUNT)) : null,
  };
}

/** UNTIL: "20261220T225959Z" (UTC) o "20261220" (fecha: hasta el final de ese día en Madrid). */
function parseUntil(v: string): number | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, utc] = m;
  if (hh == null) return addDaysZ(fromLocal(+y, +mo - 1, +d), 1) - 1;
  if (utc) return Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss);
  return fromLocal(+y, +mo - 1, +d, +hh, +mm) + +ss * 1000;
}

function formatUntil(until: number, allDay: boolean): string {
  if (allDay) return fmt(until, "yyyyMMdd");
  return new Date(until).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function formatRRule(rule: Rule, allDay: boolean): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.byMonthDay.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.until != null) parts.push(`UNTIL=${formatUntil(rule.until, allDay)}`);
  else if (rule.count != null) parts.push(`COUNT=${rule.count}`);
  return parts.join(";");
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha local. */
const isoDow = (y: number, m: number, d: number) => ((new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7) + 1;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Día del mes del n-ésimo `dow` (1–7) del mes; n negativo cuenta desde el final. */
function nthWeekday(y: number, m: number, dow: number, n: number): number | null {
  const dim = daysInMonth(y, m);
  if (n > 0) {
    const first = 1 + ((dow - isoDow(y, m, 1) + 7) % 7);
    const d = first + (n - 1) * 7;
    return d <= dim ? d : null;
  }
  const last = dim - ((isoDow(y, m, dim) - dow + 7) % 7);
  const d = last + (n + 1) * 7;
  return d >= 1 ? d : null;
}

export interface SeriesInfo {
  start: number;
  end: number;
  allDay: boolean;
  exdates?: number[];
}

/**
 * Inicios (UTC ms) de las repeticiones que solapan [from, to).
 * COUNT cuenta las repeticiones generadas, también las eliminadas con EXDATE (RFC 5545).
 */
export function expandRule(rule: Rule, series: SeriesInfo, from: number, to: number): number[] {
  const s = z(series.start);
  const Y = s.getFullYear();
  const M = s.getMonth();
  const D = s.getDate();
  const H = s.getHours();
  const Mi = s.getMinutes();
  const duration = series.end - series.start;
  const spanDays = series.allDay ? Math.max(1, dayDiff(series.end, series.start)) : 0;
  const ex = new Set(series.exdates ?? []);
  const out: number[] = [];
  let generated = 0;
  let done = false;

  const at = (y: number, m: number, d: number) => (series.allDay ? fromLocal(y, m, d) : fromLocal(y, m, d, H, Mi));
  const endOf = (start: number) => (series.allDay ? addDaysZ(start, spanDays) : start + duration);

  /** Procesa un candidato; devuelve false cuando hay que parar. */
  const emit = (y: number, m: number, d: number): boolean => {
    const start = at(y, m, d);
    if (start < series.start) return true;
    if (rule.until != null && start > rule.until) return false;
    if (rule.count != null && generated >= rule.count) return false;
    if (start >= to) return false;
    generated++;
    if (!ex.has(start) && endOf(start) > from) out.push(start);
    return true;
  };

  // Sin COUNT podemos saltar directamente cerca de `from` en las frecuencias regulares.
  const canSkip = rule.count == null;
  const lookback = series.allDay ? spanDays : Math.ceil(duration / DAY_MS) + 1;

  switch (rule.freq) {
    case "DAILY": {
      let n = canSkip ? Math.max(0, Math.floor((dayDiff(from, series.start) - lookback) / rule.interval)) : 0;
      for (let i = 0; i < MAX_ITER && !done; i++, n++) done = !emit(Y, M, D + n * rule.interval);
      break;
    }
    case "WEEKLY": {
      const days = (rule.byDay.length ? rule.byDay : [WEEKDAYS[isoDow(Y, M, D) - 1]])
        .map((d) => WEEKDAYS.indexOf(d.slice(-2) as Weekday) + 1)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      const mondayD = D - (isoDow(Y, M, D) - 1);
      let w = canSkip ? Math.max(0, Math.floor((dayDiff(from, series.start) - lookback) / 7 / rule.interval) - 1) : 0;
      for (let i = 0; i < MAX_ITER && !done; i++, w++) {
        for (const dow of days) {
          if (!emit(Y, M, mondayD + w * 7 * rule.interval + dow - 1)) {
            done = true;
            break;
          }
        }
      }
      break;
    }
    case "MONTHLY": {
      for (let n = 0; n < MAX_ITER && !done; n++) {
        const total = M + n * rule.interval;
        const y = Y + Math.floor(total / 12);
        const m = ((total % 12) + 12) % 12;
        const dim = daysInMonth(y, m);
        let dates: number[];
        if (rule.byDay.length) {
          dates = rule.byDay
            .map((bd) => {
              const mt = bd.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/);
              if (!mt) return null;
              return nthWeekday(y, m, WEEKDAYS.indexOf(mt[2] as Weekday) + 1, Number(mt[1] ?? 1));
            })
            .filter((d): d is number => d != null);
        } else {
          dates = (rule.byMonthDay.length ? rule.byMonthDay : [D])
            .map((md) => (md < 0 ? dim + md + 1 : md))
            .filter((md) => md >= 1 && md <= dim); // el 31 se salta en meses de 30 días
        }
        for (const d of [...new Set(dates)].sort((a, b) => a - b)) {
          if (!emit(y, m, d)) {
            done = true;
            break;
          }
        }
      }
      break;
    }
    case "YEARLY": {
      for (let n = 0; n < MAX_ITER && !done; n++) {
        const y = Y + n * rule.interval;
        if (D > daysInMonth(y, M)) continue; // 29 de febrero en años no bisiestos
        done = !emit(y, M, D);
      }
      break;
    }
  }
  return out;
}

/** Número de repeticiones (incluidas las eliminadas) que empiezan antes de `before`. */
export function countBefore(rule: Rule, series: SeriesInfo, before: number): number {
  return expandRule({ ...rule }, { ...series, exdates: [] }, series.start, before).filter((s) => s < before).length;
}

// ---------- Descripción en español ----------

const DOW_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const ORDINALS: Record<string, string> = { "1": "primer", "2": "segundo", "3": "tercer", "4": "cuarto", "5": "quinto", "-1": "último" };

function joinEs(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export function describeRule(rule: Rule, start: number): string {
  const n = rule.interval;
  let text: string;
  switch (rule.freq) {
    case "DAILY":
      text = n === 1 ? "Cada día" : `Cada ${n} días`;
      break;
    case "WEEKLY": {
      const days = (rule.byDay.length ? rule.byDay : [WEEKDAYS[isoDow(z(start).getFullYear(), z(start).getMonth(), z(start).getDate()) - 1]])
        .map((d) => WEEKDAYS.indexOf(d.slice(-2) as Weekday))
        .sort((a, b) => a - b);
      const base = n === 1 ? "Cada semana" : `Cada ${n} semanas`;
      const weekdaysOnly = days.length === 5 && days.every((d, i) => d === i);
      text = weekdaysOnly ? `${base} de lunes a viernes` : `${base} el ${joinEs(days.map((d) => DOW_NAMES[d]))}`;
      break;
    }
    case "MONTHLY": {
      const base = n === 1 ? "Cada mes" : `Cada ${n} meses`;
      const bd = rule.byDay[0]?.match(/^([+-]?\d+)?(MO|TU|WE|TH|FR|SA|SU)$/);
      if (bd) text = `${base} el ${ORDINALS[String(Number(bd[1] ?? 1))] ?? bd[1]} ${DOW_NAMES[WEEKDAYS.indexOf(bd[2] as Weekday)]}`;
      else {
        const md = rule.byMonthDay.length ? rule.byMonthDay : [z(start).getDate()];
        text = `${base} el día ${joinEs(md.map((d) => (d === -1 ? "último" : String(d))))}`;
      }
      break;
    }
    case "YEARLY":
      text = `${n === 1 ? "Cada año" : `Cada ${n} años`} el ${fmt(start, "d 'de' MMMM")}`;
      break;
  }
  if (rule.until != null) text += `, hasta el ${fmt(rule.until, "d MMM yyyy")}`;
  else if (rule.count != null) text += rule.count === 1 ? ", una vez" : `, ${rule.count} veces`;
  return text;
}

/** Final del día (Madrid) de `ms`, para usar como UNTIL inclusivo. */
export const endOfDayZ = (ms: number) => addDaysZ(fromLocal(z(ms).getFullYear(), z(ms).getMonth(), z(ms).getDate()), 1) - 1;
