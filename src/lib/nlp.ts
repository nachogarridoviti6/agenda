/**
 * "Añadir rápido" en lenguaje natural (español).
 *
 *   "Entrega práctica fabricación viernes 23:59 #uni"  → tarea, vence el viernes a las 23:59
 *   "Grabación villa martes 10-13 #trabajo @Marbella"  → evento el martes de 10:00 a 13:00
 *   "Cálculo cada lunes y miércoles 9-11 #uni"          → evento repetido
 *   "Pagar alquiler el 1 !!"                           → tarea con prioridad media
 *
 * Sintaxis: #calendario, @lugar (hasta el siguiente # / ! / coma o el final),
 * !, !!, !!! (prioridad), "tarea:" / "evento:" para forzar el tipo.
 */
import type { Calendar, Priority } from "./types";
import { addDaysZ, atMinutes, dayDiff, fromLocal, startOfDayZ, z } from "./dates";
import { endOfDayZ, formatRRule, type Freq, type Rule, WEEKDAYS } from "./rrule";

export interface QuickResult {
  kind: "event" | "task";
  title: string;
  calendarId: string | null;
  location: string;
  priority: Priority;
  /** Evento */
  allDay: boolean;
  start: number | null;
  end: number | null;
  rrule: string | null;
  /** Tarea */
  due: number | null;
  dueHasTime: boolean;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const WEEKDAY_WORDS: Record<string, number> = {
  lunes: 1, lun: 1, martes: 2, mar: 2, miercoles: 3, mie: 3, mier: 3, jueves: 4, jue: 4,
  viernes: 5, vie: 5, sabado: 6, sab: 6, domingo: 7, dom: 7,
};
const WEEKDAY_PLURAL: Record<string, number> = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabados: 6, domingos: 7 };
const MONTHS: Record<string, number> = {
  enero: 0, ene: 0, febrero: 1, feb: 1, marzo: 2, abril: 3, abr: 3, mayo: 4, may: 4, junio: 5, jun: 5,
  julio: 6, jul: 6, agosto: 7, ago: 7, septiembre: 8, setiembre: 8, sep: 8, sept: 8, octubre: 9, oct: 9,
  noviembre: 10, nov: 10, diciembre: 11, dic: 11,
};
const TASK_WORDS = new Set([
  "entrega", "entregar", "tarea", "recordar", "recordatorio", "pagar", "enviar", "mandar", "llamar",
  "comprar", "subir", "rellenar", "apuntarse", "inscribirse", "renovar", "devolver", "terminar", "acabar", "hacer",
]);
const FILLER = new Set(["el", "la", "los", "las", "de", "del", "a", "al", "en", "y", "para", "este", "esta", "-", "–", ","]);

type Time = { h: number; m: number };

function parseTime(tok: string, loose: boolean): Time | null {
  const t = norm(tok);
  let m = t.match(/^(\d{1,2})(?::|\.|h)(\d{2})h?$/);
  if (m) return valid(+m[1], +m[2]);
  m = t.match(/^(\d{1,2})\s*(h|am|pm)$/);
  if (m) {
    let h = +m[1];
    if (m[2] === "pm" && h < 12) h += 12;
    if (m[2] === "am" && h === 12) h = 0;
    return valid(h, 0);
  }
  if (loose && /^\d{1,2}$/.test(t)) return valid(+t, 0);
  return null;
}
const valid = (h: number, m: number): Time | null => (h <= 23 && m <= 59 ? { h, m } : null);

function parseRange(tok: string): [Time, Time] | null {
  const m = norm(tok).match(/^(\d{1,2}(?::\d{2})?)h?[-–](\d{1,2}(?::\d{2})?)h?$/);
  if (!m) return null;
  const a = parseTime(m[1], true);
  const b = parseTime(m[2], true);
  return a && b ? [a, b] : null;
}

export function parseQuickAdd(input: string, calendars: Calendar[], now = Date.now()): QuickResult {
  let text = input.trim();
  let forced: "event" | "task" | null = null;
  const prefix = norm(text).match(/^(tarea|evento|t|e)\s*:\s*/);
  if (prefix) {
    forced = prefix[1].startsWith("t") ? "task" : "event";
    text = text.slice(prefix[0].length);
  }

  // Lugar: desde @ hasta el siguiente #, !, coma o el final.
  let location = "";
  text = text.replace(/@([^#!,]+),?/, (_, loc: string) => {
    location = loc.trim();
    return " ";
  });

  const toks = text.split(/\s+/).filter(Boolean);
  const used = new Array(toks.length).fill(false);
  const n = (i: number) => (i < toks.length ? norm(toks[i]).replace(/[,.;]$/, "") : "");

  let calendarId: string | null = null;
  let priority: Priority = 0;
  let date: number | null = null; // inicio del día
  let weekdayRelative = false;
  let start: Time | null = null;
  let end: Time | null = null;
  let allDay = false;
  let durationMin: number | null = null;
  let rule: Partial<Rule> | null = null;
  let untilDay: number | null = null;
  const today = startOfDayZ(now);
  const zt = z(now);

  const consume = (i: number, k = 1) => {
    for (let j = i; j < i + k && j < toks.length; j++) used[j] = true;
  };

  const nextWeekday = (dow: number, forceNext: boolean) => {
    const cur = ((zt.getDay() + 6) % 7) + 1;
    let diff = (dow - cur + 7) % 7;
    if (diff === 0 && forceNext) diff = 7;
    return addDaysZ(today, diff);
  };

  /** Intenta leer una fecha en la posición i. Devuelve cuántos tokens usa. */
  const readDate = (i: number): number => {
    const w = n(i);
    if (w === "hoy") return (date = today), 1;
    if (w === "manana") return (date = addDaysZ(today, 1)), 1;
    if (w === "pasado" && n(i + 1) === "manana") return (date = addDaysZ(today, 2)), 2;
    // "próximo lunes", "el lunes", "este lunes", "lunes que viene"
    let k = 0;
    let forceNext = false;
    if (["proximo", "proxima", "siguiente"].includes(w)) (forceNext = true), (k = 1);
    else if (["el", "este"].includes(w) && WEEKDAY_WORDS[n(i + 1)]) k = 1;
    const wd = WEEKDAY_WORDS[n(i + k)];
    if (wd) {
      let used = k + 1;
      if (n(i + used) === "que" && n(i + used + 1) === "viene") (forceNext = true), (used += 2);
      date = nextWeekday(wd, forceNext);
      weekdayRelative = !forceNext;
      return used;
    }
    // "dentro de 3 días", "en 2 semanas"
    if ((w === "dentro" && n(i + 1) === "de") || w === "en") {
      const off = w === "en" ? 1 : 2;
      const qty = Number(n(i + off));
      const unit = n(i + off + 1);
      if (qty > 0 && /^dias?$/.test(unit)) return (date = addDaysZ(today, qty)), off + 2;
      if (qty > 0 && /^semanas?$/.test(unit)) return (date = addDaysZ(today, qty * 7)), off + 2;
    }
    // "23/10", "23/10/2026", "23-10"
    const slashAt = w === "el" ? i + 1 : i;
    let m = n(slashAt).match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
    if (m) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : zt.getFullYear();
      const d = dateIfValid(y, +m[2] - 1, +m[1]);
      if (d != null) {
        date = !m[3] && d < today ? dateIfValid(y + 1, +m[2] - 1, +m[1]) : d;
        return slashAt - i + 1;
      }
    }
    // "(el) 23 (de) octubre (de 2026)" o "(el) 23"
    k = w === "el" ? 1 : 0;
    if (/^\d{1,2}$/.test(n(i + k))) {
      const day = +n(i + k);
      let j = i + k + 1;
      if (n(j) === "de" && MONTHS[n(j + 1)] != null) j++;
      const mon = MONTHS[n(j)];
      if (mon != null) {
        j++;
        let y = zt.getFullYear();
        let explicitYear = false;
        if (n(j) === "de" && /^\d{4}$/.test(n(j + 1))) (y = +n(j + 1)), (j += 2), (explicitYear = true);
        else if (/^\d{4}$/.test(n(j))) (y = +n(j)), (j += 1), (explicitYear = true);
        let d = dateIfValid(y, mon, day);
        if (d != null && !explicitYear && d < today) d = dateIfValid(y + 1, mon, day);
        if (d != null) return (date = d), j - i;
      } else if (k === 1 && day >= 1 && day <= 31) {
        // "el 23": este mes o el siguiente si ya ha pasado
        let y = zt.getFullYear();
        let mo = zt.getMonth();
        if (day < zt.getDate()) mo++;
        let d: number | null = null;
        for (let tries = 0; tries < 3 && d == null; tries++, mo++) d = dateIfValid(y, mo, day);
        if (d != null) return (date = d), 2;
      }
    }
    return 0;
  };

  /** Repetición: "cada día", "cada 2 semanas", "cada lunes y miércoles", "todos los martes", "diario". */
  const readRecurrence = (i: number): number => {
    const w = n(i);
    const simple: Record<string, Freq> = { diario: "DAILY", diariamente: "DAILY", semanalmente: "WEEKLY", mensualmente: "MONTHLY", anualmente: "YEARLY" };
    if (simple[w]) return (rule = { freq: simple[w], interval: 1 }), 1;
    let j: number;
    if (w === "cada") j = i + 1;
    else if ((w === "todos" && n(i + 1) === "los") || (w === "todas" && n(i + 1) === "las")) j = i + 2;
    else return 0;
    let interval = 1;
    if (/^\d+$/.test(n(j))) (interval = Math.max(1, +n(j))), j++;
    const unit = n(j);
    const units: Record<string, Freq> = { dia: "DAILY", dias: "DAILY", semana: "WEEKLY", semanas: "WEEKLY", mes: "MONTHLY", meses: "MONTHLY", ano: "YEARLY", anos: "YEARLY" };
    if (/^dias?$/.test(unit) && /^laborables?$/.test(n(j + 1))) {
      rule = { freq: "WEEKLY", interval, byDay: ["MO", "TU", "WE", "TH", "FR"] };
      return j - i + 2;
    }
    if (/^laborables?$/.test(unit)) {
      rule = { freq: "WEEKLY", interval, byDay: ["MO", "TU", "WE", "TH", "FR"] };
      return j - i + 1;
    }
    if (units[unit]) return (rule = { freq: units[unit], interval }), j - i + 1;
    const days: number[] = [];
    while (j < toks.length) {
      const d = WEEKDAY_PLURAL[n(j)] ?? WEEKDAY_WORDS[n(j)];
      if (d) (days.push(d), j++);
      else if ((n(j) === "y" || n(j) === ",") && (WEEKDAY_PLURAL[n(j + 1)] ?? WEEKDAY_WORDS[n(j + 1)])) j++;
      else break;
    }
    if (!days.length) return 0;
    rule = { freq: "WEEKLY", interval, byDay: [...new Set(days)].sort().map((d) => WEEKDAYS[d - 1]) };
    if (date == null) {
      date = Math.min(...days.map((d) => nextWeekday(d, false)));
      weekdayRelative = true;
    }
    return j - i;
  };

  for (let i = 0; i < toks.length; i++) {
    if (used[i]) continue;
    const raw = toks[i];
    const w = n(i);

    if (raw.startsWith("#") && raw.length > 1) {
      const tag = norm(raw.slice(1));
      const cal = calendars.find((c) => norm(c.name) === tag) ?? calendars.find((c) => norm(c.name).startsWith(tag));
      if (cal) (calendarId = cal.id), consume(i);
      continue;
    }
    if (/^!{1,3}$/.test(raw)) {
      priority = raw.length as Priority;
      consume(i);
      continue;
    }
    const pm = w.match(/^!(alta|media|baja)$/);
    if (pm) {
      priority = pm[1] === "alta" ? 3 : pm[1] === "media" ? 2 : 1;
      consume(i);
      continue;
    }
    if (w === "todo" && n(i + 1) === "el" && n(i + 2) === "dia") {
      allDay = true;
      consume(i, 3);
      continue;
    }
    if (w === "hasta" && i + 1 < toks.length) {
      const saved: number | null = date;
      const k = readDate(i + 1);
      if (k) {
        untilDay = date;
        date = saved;
        consume(i, k + 1);
        continue;
      }
    }
    const rk = readRecurrence(i);
    if (rk) {
      consume(i, rk);
      continue;
    }
    if (w === "durante" && /^\d+$/.test(n(i + 1))) {
      const qty = +n(i + 1);
      const unit = n(i + 2);
      if (/^(h|horas?)$/.test(unit)) (durationMin = qty * 60), consume(i, 3);
      else if (/^(min|minutos?)$/.test(unit)) (durationMin = qty), consume(i, 3);
      continue;
    }
    // "de 10 a 13", "10 a 13", "10-13", "10 - 13"
    {
      let j = i;
      if (w === "de" || w === "desde") j++;
      const r = parseRange(n(j));
      if (r) {
        [start, end] = r;
        consume(i, j - i + 1);
        continue;
      }
      const a = parseTime(n(j), j > i);
      const sep = n(j + 1);
      const b = (sep === "a" || sep === "-" || sep === "hasta") && parseTime(n(j + 2), true);
      const aLoose = a ?? parseTime(n(j), true);
      if (aLoose && b && (j > i || a || /^\d{1,2}$/.test(n(j)))) {
        start = aLoose;
        end = b;
        consume(i, j - i + 3);
        continue;
      }
    }
    // "a las 10", "a la 1", "sobre las 9"
    if ((w === "a" || w === "sobre") && (n(i + 1) === "las" || n(i + 1) === "la")) {
      const t = parseTime(n(i + 2), true);
      if (t) {
        start = t;
        consume(i, 3);
        continue;
      }
    }
    const t = parseTime(w, false);
    if (t) {
      start = t;
      consume(i);
      continue;
    }
    const dk = readDate(i);
    if (dk) {
      consume(i, dk);
      // un número suelto justo después de una fecha es la hora: "lunes 9"
      const after = i + dk;
      const isRange = ["a", "-", "hasta"].includes(n(after + 1)) && parseTime(n(after + 2), true);
      if (!used[after] && start == null && /^\d{1,2}$/.test(n(after)) && n(after + 1) !== "de" && !isRange) {
        const bare = parseTime(n(after), true);
        if (bare) {
          start = bare;
          consume(after);
        }
      }
      continue;
    }
  }

  // Título: lo que no se ha usado, sin conectores sueltos al principio o al final.
  const rest = toks.filter((_, i) => !used[i]);
  while (rest.length && FILLER.has(norm(rest[rest.length - 1]))) rest.pop();
  while (rest.length && FILLER.has(norm(rest[0]))) rest.shift();
  const title = rest.join(" ").replace(/\s+([,.;:])/g, "$1").replace(/[,;:\s]+$/, "").trim();

  // ¿Tarea o evento?
  const firstWord = norm(title.split(/\s+/)[0] ?? "");
  const isTask =
    forced === "task" ||
    (forced !== "event" &&
      end == null &&
      !allDay &&
      rule == null &&
      (priority > 0 || TASK_WORDS.has(firstWord) || (start?.h === 23 && start?.m === 59)));

  // Un día de la semana suelto que es hoy y cuya hora ya ha pasado → la semana que viene.
  if (weekdayRelative && date === today && start && atMinutes(today, start.h * 60 + start.m) < now && !rule) date = addDaysZ(today, 7);

  const base: QuickResult = {
    kind: isTask ? "task" : "event",
    title,
    calendarId,
    location,
    priority,
    allDay: false,
    start: null,
    end: null,
    rrule: null,
    due: null,
    dueHasTime: false,
  };

  if (isTask) {
    if (date != null || start) {
      const d = date ?? today;
      base.due = start ? atMinutes(d, start.h * 60 + start.m) : d;
      base.dueHasTime = !!start;
    }
    return base;
  }

  const d = date ?? today;
  if (!start || allDay) {
    base.allDay = true;
    base.start = d;
    base.end = addDaysZ(d, 1);
  } else {
    const s = atMinutes(d, start.h * 60 + start.m);
    let e: number;
    if (end) {
      e = atMinutes(d, end.h * 60 + end.m);
      if (e <= s) e = atMinutes(addDaysZ(d, 1), end.h * 60 + end.m); // "22-2" cruza la medianoche
    } else e = s + (durationMin ?? 60) * 60_000;
    base.start = s;
    base.end = e;
  }
  // (las funciones de arriba asignan `rule`; TypeScript no lo ve)
  const found = rule as Partial<Rule> | null;
  if (found) {
    const full: Rule = { freq: found.freq!, interval: found.interval ?? 1, byDay: found.byDay ?? [], byMonthDay: [], until: untilDay != null ? endOfDayZ(untilDay) : null, count: null };
    base.rrule = formatRRule(full, base.allDay);
  }
  return base;
}

function dateIfValid(y: number, m: number, d: number): number | null {
  const ms = fromLocal(y, m, d);
  const zd = z(ms);
  return zd.getDate() === d && zd.getMonth() === ((m % 12) + 12) % 12 ? ms : null;
}

/** ¿Hay que avisar de que la fecha ya ha pasado? (para la vista previa) */
export const isPast = (r: QuickResult, now = Date.now()) =>
  r.kind === "event" ? r.start != null && dayDiff(r.start, now) < 0 : r.due != null && dayDiff(r.due, now) < 0;
