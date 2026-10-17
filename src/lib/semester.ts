import type { CalEvent, Id } from "./types";
import { addDaysZ, combine, dayKey, parseDayKey, z } from "./dates";
import { endOfDayZ, expandRule, formatRRule, parseRRule, WEEKDAYS } from "./rrule";

export interface ClassRow {
  subject: string;
  /** Días de la semana: 0 = lunes … 6 = domingo */
  days: number[];
  from: string; // "09:00"
  to: string; // "11:00"
  location: string;
}

export interface SemesterInput {
  calendarId: Id;
  start: string; // "2026-09-21"
  end: string; // "2027-01-22"
  rows: ClassRow[];
  /** Días sin clase ("yyyy-MM-dd"): festivos, vacaciones… */
  skipDays: string[];
  alerts: number[];
}

/** Convierte el horario en eventos semanales que terminan con el cuatrimestre y se saltan los festivos. */
export function buildSemester(input: SemesterInput, newId: () => Id, now = Date.now()): CalEvent[] {
  const startMs = parseDayKey(input.start);
  const until = endOfDayZ(parseDayKey(input.end));
  const skip = new Set(input.skipDays);
  const out: CalEvent[] = [];
  for (const row of input.rows) {
    if (!row.subject.trim() || !row.days.length || row.from >= row.to) continue;
    // Primer día del cuatrimestre que cae en uno de los días elegidos.
    let first = startMs;
    for (let i = 0; i < 7 && !row.days.includes((z(first).getDay() + 6) % 7); i++) first = addDaysZ(first, 1);
    const start = combine(dayKey(first), row.from);
    const end = combine(dayKey(first), row.to);
    if (start > until) continue;
    const rrule = formatRRule(
      { freq: "WEEKLY", interval: 1, byDay: [...row.days].sort().map((d) => WEEKDAYS[d]), byMonthDay: [], until, count: null },
      false,
    );
    const series = { start, end, allDay: false };
    const exdates = expandRule(parseRRule(rrule)!, series, start, until + 1).filter((s) => skip.has(dayKey(s)));
    out.push({
      id: newId(),
      calendarId: input.calendarId,
      title: row.subject.trim(),
      location: row.location.trim(),
      notes: "",
      allDay: false,
      start,
      end,
      rrule,
      exdates,
      seriesId: null,
      recurrenceId: null,
      alerts: input.alerts,
      createdAt: now,
      updatedAt: now,
    });
  }
  return out;
}
