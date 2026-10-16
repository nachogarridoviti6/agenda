import { describe, expect, it } from "vitest";
import { exportIcs, importIcs } from "./ics";
import { expandEvents } from "./occurrences";
import { addDaysZ, combine, dayKey, timeKey } from "./dates";
import { DEFAULT_CALENDARS } from "./defaults";
import type { CalEvent, Task } from "./types";

const now = combine("2026-10-16", "12:00");
const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: "e1", calendarId: "cal-uni", title: "Cálculo II", location: "Aula 1.2", notes: "Traer apuntes; tema 4, ejercicios\nsegunda línea",
  allDay: false, start: combine("2026-10-12", "09:00"), end: combine("2026-10-12", "11:00"),
  rrule: null, exdates: [], seriesId: null, recurrenceId: null, alerts: [15], createdAt: 1, updatedAt: 2, ...over,
});
const show = (evs: CalEvent[], a = "2026-10-01", b = "2026-11-01") =>
  expandEvents(evs, combine(a, "00:00"), combine(b, "00:00")).sort((x, y) => x.start - y.start).map((o) => `${dayKey(o.start)} ${timeKey(o.start)}-${timeKey(o.end)} ${o.event.title}`);

describe("exportar", () => {
  const text = exportIcs({ events: [ev({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE" })], calendars: DEFAULT_CALENDARS, now });
  it("estructura válida con zona horaria de Madrid", () => {
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0")).toBe(true);
    expect(text).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Madrid");
    expect(text).toContain("DTSTART;TZID=Europe/Madrid:20261012T090000");
    expect(text).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE");
    expect(text).toContain("TRIGGER:-PT15M");
    expect(text).toContain("UID:e1@agenda");
    expect(text.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
  });
  it("escapa texto y pliega líneas largas a 75 octetos", () => {
    expect(text).toContain("DESCRIPTION:Traer apuntes\; tema 4\\, ejercicios\\nsegunda línea");
    const long = exportIcs({ events: [ev({ title: "á".repeat(100) })], calendars: DEFAULT_CALENDARS, now });
    for (const line of long.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});

describe("ida y vuelta (exportar → importar)", () => {
  it("conserva eventos, series, excepciones, alertas y tareas", () => {
    const master = ev({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE", exdates: [combine("2026-10-14", "09:00"), combine("2026-10-19", "09:00")], alerts: [15, 60] });
    const exception = ev({ id: "x1", title: "Cálculo II (aula 2)", start: combine("2026-10-14", "12:00"), end: combine("2026-10-14", "14:00"), seriesId: "e1", recurrenceId: combine("2026-10-14", "09:00") });
    const d = combine("2026-10-22", "00:00");
    const allDay = ev({ id: "a1", title: "Feria SIMA", allDay: true, start: d, end: addDaysZ(d, 2), alerts: [1440], location: "", notes: "", calendarId: "cal-trabajo" });
    const task: Task = { id: "t1", calendarId: "cal-uni", title: "Entrega práctica", notes: "", due: combine("2026-10-23", "23:59"), dueHasTime: true, priority: 3, completedAt: null, createdAt: 0, updatedAt: 0 };
    const original = [master, exception, allDay];
    const back = importIcs(exportIcs({ events: original, tasks: [task], calendars: DEFAULT_CALENDARS, now }), now);

    expect(show(back.events)).toEqual(show(original));
    const m = back.events.find((e) => e.id === "e1")!;
    expect(m.alerts).toEqual([15, 60]);
    expect(m.notes).toBe(master.notes);
    expect(back.events.find((e) => e.id === "a1")!.alerts).toEqual([1440]);
    expect(back.sourceCalendar.get("a1")).toBe("Trabajo");
    expect(back.tasks).toEqual([{ ...task, calendarId: "", createdAt: now, updatedAt: now }]);
  });
});

describe("importar archivos de otras apps", () => {
  it("Apple Calendar: TZID, todo el día, alerta de 'un día antes (9:00)', EXDATE", () => {
    const text = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//macOS 15//EN", "X-WR-CALNAME:Casa",
      "BEGIN:VEVENT", "UID:ABC-123", "DTSTART;TZID=Europe/Madrid:20261020T183000", "DTEND;TZID=Europe/Madrid:20261020T193000",
      "SUMMARY:Yoga", "RRULE:FREQ=WEEKLY;BYDAY=TU;WKST=MO", "EXDATE;TZID=Europe/Madrid:20261027T183000",
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "END:VALARM", "END:VEVENT",
      "BEGIN:VEVENT", "UID:DEF-456", "DTSTART;VALUE=DATE:20261031", "DTEND;VALUE=DATE:20261101", "SUMMARY:Halloween",
      "BEGIN:VALARM", "TRIGGER:-PT15H", "ACTION:DISPLAY", "END:VALARM", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = importIcs(text, now);
    expect(r.name).toBe("Casa");
    expect(show(r.events, "2026-10-19", "2026-11-11")).toEqual([
      "2026-10-20 18:30-19:30 Yoga",
      "2026-10-31 00:00-00:00 Halloween",
      "2026-11-03 18:30-19:30 Yoga",
      "2026-11-10 18:30-19:30 Yoga",
    ]);
    expect(r.events.find((e) => e.title === "Yoga")!.alerts).toEqual([10]);
    expect(r.events.find((e) => e.title === "Halloween")!.alerts).toEqual([1440]);
  });

  it("Google/Outlook: UTC, zonas de Windows, DURATION, líneas plegadas y cancelados", () => {
    const text = [
      "BEGIN:VCALENDAR", "VERSION:2.0",
      "BEGIN:VEVENT", "UID:g1@google.com", "DTSTART:20261021T080000Z", "DTEND:20261021T090000Z", "SUMMARY:Reunión con un título muy largo que", " continúa en la siguiente línea", "END:VEVENT",
      "BEGIN:VEVENT", "UID:o1", 'DTSTART;TZID="Romance Standard Time":20261022T100000', "DURATION:PT1H30M", "SUMMARY:Outlook", "END:VEVENT",
      "BEGIN:VEVENT", "UID:c1", "DTSTART:20261023T080000Z", "DTEND:20261023T090000Z", "SUMMARY:Cancelado", "STATUS:CANCELLED", "END:VEVENT",
      "BEGIN:VEVENT", "UID:n1", "DTSTART:20261024T100000", "DTEND:20261024T110000", "SUMMARY:Flotante", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = importIcs(text, now);
    expect(show(r.events)).toEqual([
      "2026-10-21 10:00-11:00 Reunión con un título muy largo quecontinúa en la siguiente línea",
      "2026-10-22 10:00-11:30 Outlook",
      "2026-10-24 10:00-11:00 Flotante",
    ]);
  });

  it("reglas no compatibles se importan con su primera fecha y avisan", () => {
    const text = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:x", "DTSTART:20261021T080000Z", "DTEND:20261021T090000Z", "SUMMARY:Raro", "RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const r = importIcs(text, now);
    expect(r.events[0].rrule).toBeNull();
    expect(r.warnings[0]).toMatch(/1 evento repetido/);
  });

  it("reimportar el mismo archivo da los mismos ids (no duplica)", () => {
    const text = exportIcs({ events: [ev({})], calendars: DEFAULT_CALENDARS, now });
    expect(importIcs(text).events.map((e) => e.id)).toEqual(importIcs(text).events.map((e) => e.id));
    const foreign = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:abc@google.com", "DTSTART:20261021T080000Z", "SUMMARY:x", "END:VEVENT", "END:VCALENDAR"].join("\n");
    expect(importIcs(foreign).events[0].id).toBe(importIcs(foreign).events[0].id);
  });

  it("archivo que no es un calendario", () => {
    expect(() => importIcs("hola")).toThrow(/no es un calendario/);
  });
});

import { preservedFrom } from "./ics";

describe("para sincronizar", () => {
  const iphone = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Apple Inc.//iOS 18//EN",
    "BEGIN:VEVENT", "UID:7F3A-IPHONE", "DTSTAMP:20261015T100000Z", "LAST-MODIFIED:20261015T100000Z", "SEQUENCE:2",
    "DTSTART;TZID=Europe/Madrid:20261020T100000", "DTEND;TZID=Europe/Madrid:20261020T110000", "SUMMARY:Dentista",
    "URL;VALUE=URI:https://clinica.example", "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");

  it("guarda el UID original y la fecha de modificación", () => {
    const r = importIcs(iphone, now);
    const id = r.events[0].id;
    expect(r.uids.get(id)).toBe("7F3A-IPHONE");
    expect(new Date(r.modified.get(id)!).toISOString()).toBe("2026-10-15T10:00:00.000Z");
    expect(r.lossy.size).toBe(0);
  });

  it("al reescribir conserva el UID, lo que Agenda no gestiona y sube SEQUENCE", () => {
    const r = importIcs(iphone, now);
    const e = { ...r.events[0], title: "Dentista (revisión)", calendarId: "cal-personal" };
    const { preserve, sequence } = preservedFrom(iphone);
    const out = exportIcs({ events: [e], calendars: DEFAULT_CALENDARS, uids: r.uids, preserve, sequence, now });
    expect(out).toContain("UID:7F3A-IPHONE");
    expect(out).toContain("SUMMARY:Dentista (revisión)");
    expect(out).toContain("URL;VALUE=URI:https://clinica.example");
    expect(out).toContain("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC");
    expect(out).toContain("SEQUENCE:3");
    expect(out.match(/SUMMARY:/g)).toHaveLength(1);
  });

  it("invitaciones y reglas raras se marcan como no editables", () => {
    const withAttendee = iphone.replace("SUMMARY:Dentista", "SUMMARY:Reunión\r\nATTENDEE;CN=Ana:mailto:ana@example.com");
    const r = importIcs(withAttendee, now);
    expect(r.lossy.has(r.events[0].id)).toBe(true);
  });
});
