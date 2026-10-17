import type { CalEvent, Id } from "./types";
import { addDaysZ, startOfDayZ } from "./dates";

/** Plantilla de evento: todo menos la fecha. */
export interface EventTemplate {
  id: Id;
  name: string;
  title: string;
  calendarId: Id;
  allDay: boolean;
  /** Duración en minutos (todo el día: múltiplo de 1440). */
  duration: number;
  location: string;
  notes: string;
  alerts: number[];
}

export function templateFromEvent(e: CalEvent, newId: () => Id): EventTemplate {
  return {
    id: newId(),
    name: e.title || "Plantilla",
    title: e.title,
    calendarId: e.calendarId,
    allDay: e.allDay,
    duration: Math.max(e.allDay ? 1440 : 15, Math.round((e.end - e.start) / 60_000)),
    location: e.location,
    notes: e.notes,
    alerts: [...e.alerts],
  };
}

/** Evento nuevo a partir de una plantilla, empezando en `start`. */
export function eventFromTemplate(t: EventTemplate, start: number, newId: () => Id, now = Date.now()): CalEvent {
  const s = t.allDay ? startOfDayZ(start) : start;
  return {
    id: newId(),
    calendarId: t.calendarId,
    title: t.title,
    location: t.location,
    notes: t.notes,
    allDay: t.allDay,
    start: s,
    end: t.allDay ? addDaysZ(s, Math.max(1, Math.round(t.duration / 1440))) : s + t.duration * 60_000,
    rrule: null,
    exdates: [],
    seriesId: null,
    recurrenceId: null,
    alerts: [...t.alerts],
    createdAt: now,
    updatedAt: now,
  };
}

/** Copia de un evento (o de una repetición concreta) como evento suelto e independiente. */
export function duplicateEvent(e: CalEvent, newId: () => Id, now = Date.now()): CalEvent {
  return { ...e, id: newId(), rrule: null, exdates: [], seriesId: null, recurrenceId: null, title: e.title, createdAt: now, updatedAt: now };
}
