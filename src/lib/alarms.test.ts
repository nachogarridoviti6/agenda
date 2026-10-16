import { describe, expect, it } from "vitest";
import { computeAlarms } from "./alarms";
import { addDaysZ, combine, timeKey } from "./dates";
import { DEFAULT_CALENDARS } from "./defaults";
import type { CalEvent, Task } from "./types";

const ev = (over: Partial<CalEvent>): CalEvent => ({
  id: "e", calendarId: "cal-uni", title: "Cálculo", location: "Aula 1.2", notes: "", allDay: false,
  start: combine("2026-10-16", "12:00"), end: combine("2026-10-16", "13:00"),
  rrule: null, exdates: [], seriesId: null, recurrenceId: null, alerts: [15], createdAt: 0, updatedAt: 0, ...over,
});
const from = combine("2026-10-16", "10:00");
const to = addDaysZ(from, 2);

describe("computeAlarms", () => {
  it("15 minutos antes, con texto útil", () => {
    const [a] = computeAlarms(DEFAULT_CALENDARS, [ev({})], [], from, to);
    expect(timeKey(a.at)).toBe("11:45");
    expect(a.title).toBe("Cálculo");
    expect(a.body).toBe("En 15 min (12:00–13:00) · Aula 1.2");
  });

  it("varias alertas y repeticiones con id distinto", () => {
    const alarms = computeAlarms(DEFAULT_CALENDARS, [ev({ rrule: "FREQ=DAILY", alerts: [0, 60] })], [], from, to);
    expect(alarms.map((a) => timeKey(a.at))).toEqual(["11:00", "12:00", "11:00", "12:00"]);
    expect(new Set(alarms.map((a) => a.id)).size).toBe(4);
  });

  it("ignora las que ya pasaron, calendarios ocultos y eventos sin alertas", () => {
    const cals = DEFAULT_CALENDARS.map((c) => (c.id === "cal-trabajo" ? { ...c, visible: false } : c));
    const alarms = computeAlarms(cals, [ev({ start: combine("2026-10-16", "10:05"), end: combine("2026-10-16", "11:00") }), ev({ id: "t", calendarId: "cal-trabajo" }), ev({ id: "n", alerts: [] })], [], from, to);
    expect(alarms).toEqual([]);
  });

  it("1 día antes de un evento de todo el día avisa a las 9:00 del día anterior", () => {
    const d = combine("2026-10-18", "00:00");
    const [a] = computeAlarms(DEFAULT_CALENDARS, [ev({ allDay: true, start: d, end: addDaysZ(d, 1), alerts: [1440] })], [], from, to);
    expect(timeKey(a.at)).toBe("09:00");
    expect(a.body).toMatch(/^Mañana · Todo el día/);
  });

  it("tareas con hora avisan a la hora límite", () => {
    const t: Task = { id: "t", calendarId: "cal-uni", title: "Entrega", notes: "", due: combine("2026-10-16", "23:59"), dueHasTime: true, priority: 3, completedAt: null, createdAt: 0, updatedAt: 0 };
    const alarms = computeAlarms(DEFAULT_CALENDARS, [], [t, { ...t, id: "hecha", completedAt: 1 }, { ...t, id: "sin-hora", dueHasTime: false }], from, to);
    expect(alarms.map((a) => a.title)).toEqual(["Tarea: Entrega"]);
  });
});
