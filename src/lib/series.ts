/**
 * Editar o borrar una repetición de una serie, con la misma semántica que iCalendar/iCloud:
 * - "this":   solo esta → EXDATE en la serie + (al editar) una excepción con RECURRENCE-ID.
 * - "future": esta y las siguientes → la serie termina antes (UNTIL) y empieza otra nueva.
 */
import type { CalEvent, Id } from "./types";
import { countBefore, formatRRule, parseRRule, WEEKDAYS, type Weekday } from "./rrule";
import { z } from "./dates";

export type Scope = "this" | "future";

export interface SeriesOps {
  save: CalEvent[];
  delete: Id[];
  /** Borrar las excepciones de una serie desde un instante (incluido). */
  deleteExceptionsFrom?: { seriesId: Id; from: number };
}

/** Termina la regla justo antes de `occStart` (quita COUNT si lo había). */
function truncate(master: CalEvent, occStart: number): string | null {
  const rule = parseRRule(master.rrule);
  if (!rule) return master.rrule;
  return formatRRule({ ...rule, count: null, until: occStart - 1000 }, master.allDay);
}

/**
 * `draft` es el evento editado con las fechas de la repetición (y la regla que haya en el editor).
 * `occStart` es el inicio original de la repetición que se editó.
 */
export function editOccurrence(master: CalEvent, occStart: number, draft: CalEvent, scope: Scope, newId: () => Id, now = Date.now()): SeriesOps {
  if (scope === "this") {
    const exception: CalEvent = {
      ...draft,
      id: newId(),
      rrule: null,
      exdates: [],
      seriesId: master.id,
      recurrenceId: occStart,
      createdAt: now,
      updatedAt: now,
    };
    return {
      save: [{ ...master, exdates: [...new Set([...master.exdates, occStart])], updatedAt: now }, exception],
      delete: [],
    };
  }

  const shift = draft.start - occStart;
  const shiftedExdates = master.exdates.filter((x) => x >= occStart).map((x) => x + shift);

  // Primera repetición: se edita la serie entera.
  if (occStart <= master.start) {
    return {
      save: [{ ...draft, id: master.id, exdates: draft.rrule ? shiftedExdates : [], seriesId: null, recurrenceId: null, createdAt: master.createdAt, updatedAt: now }],
      delete: [],
    };
  }

  // A mitad de serie: se corta la vieja y empieza una nueva.
  let rrule = draft.rrule;
  const oldRule = parseRRule(master.rrule);
  const newRule = parseRRule(draft.rrule);
  if (oldRule?.count != null && newRule && draft.rrule === master.rrule) {
    const left = oldRule.count - countBefore(oldRule, master, occStart);
    rrule = formatRRule({ ...newRule, count: Math.max(1, left) }, draft.allDay);
  }
  const old: CalEvent = { ...master, rrule: truncate(master, occStart), exdates: master.exdates.filter((x) => x < occStart), updatedAt: now };
  const next: CalEvent = {
    ...draft,
    id: newId(),
    rrule,
    exdates: rrule ? shiftedExdates : [],
    seriesId: null,
    recurrenceId: null,
    createdAt: now,
    updatedAt: now,
  };
  return { save: [old, next], delete: [], deleteExceptionsFrom: { seriesId: master.id, from: occStart } };
}

export function deleteOccurrence(master: CalEvent, occStart: number, scope: Scope, now = Date.now()): SeriesOps {
  if (scope === "this") {
    return { save: [{ ...master, exdates: [...new Set([...master.exdates, occStart])], updatedAt: now }], delete: [] };
  }
  if (occStart <= master.start) return { save: [], delete: [master.id] };
  return {
    save: [{ ...master, rrule: truncate(master, occStart), exdates: master.exdates.filter((x) => x < occStart), updatedAt: now }],
    delete: [],
    deleteExceptionsFrom: { seriesId: master.id, from: occStart },
  };
}

/** Si una serie semanal de un solo día se mueve a otro día de la semana, la regla se mueve con ella. */
export function shiftWeekday(e: CalEvent, oldStart: number, newStart: number): string | null {
  const rule = parseRRule(e.rrule);
  if (!rule || rule.freq !== "WEEKLY") return e.rrule;
  const dow = (ms: number) => WEEKDAYS[(z(ms).getDay() + 6) % 7];
  const from = dow(oldStart);
  const to = dow(newStart);
  if (from === to) return e.rrule;
  const days = rule.byDay.length ? rule.byDay : [from];
  if (!days.includes(from)) return e.rrule;
  return formatRRule({ ...rule, byDay: [...new Set(days.map((d) => (d === from ? to : d)))].sort((a, b) => WEEKDAYS.indexOf(a as Weekday) - WEEKDAYS.indexOf(b as Weekday)) }, e.allDay);
}
