import { describe, expect, it } from "vitest";
import { buildWidgetWeek, shortDue } from "./widget";
import { combine, dayKey } from "./dates";
import { DEFAULT_CALENDARS } from "./defaults";
import type { CalEvent, Task } from "./types";

const now = combine("2026-10-16", "10:00"); // viernes, semana 42

const ev = (id: string, day: string, from: string, to: string, calendarId = "cal-uni"): CalEvent => ({
  id, calendarId, title: id, location: "", notes: "", allDay: false, start: combine(day, from), end: combine(day, to),
  rrule: null, exdates: [], seriesId: null, recurrenceId: null, alerts: [], createdAt: 0, updatedAt: 0,
});
const task = (id: string, due: number | null, completedAt: number | null = null, calendarId = "cal-uni"): Task => ({
  id, calendarId, title: id, notes: "", due, dueHasTime: false, priority: 0, completedAt, createdAt: 0, updatedAt: 0,
});

describe("buildWidgetWeek", () => {
  it("semana de lunes a domingo con hoy marcado", () => {
    const w = buildWidgetWeek(DEFAULT_CALENDARS, [], [], now);
    expect(w.title).toBe("Semana 42");
    expect(w.range).toBe("12 – 18 oct");
    expect(w.days.map((d) => dayKey(d.day))[0]).toBe("2026-10-12");
    expect(w.days.filter((d) => d.isToday).map((d) => dayKey(d.day))).toEqual(["2026-10-16"]);
    expect(w.days.filter((d) => d.isPast)).toHaveLength(4);
  });

  it("eventos en su día, ordenados y sin calendarios ocultos", () => {
    const cals = DEFAULT_CALENDARS.map((c) => (c.id === "cal-personal" ? { ...c, visible: false } : c));
    const w = buildWidgetWeek(
      cals,
      [ev("tarde", "2026-10-13", "17:00", "18:00"), ev("mañana", "2026-10-13", "09:00", "10:00"), ev("oculto", "2026-10-13", "11:00", "12:00", "cal-personal"), ev("otra-semana", "2026-10-20", "09:00", "10:00")],
      [],
      now,
    );
    expect(w.days[1].items.map((o) => o.event.title)).toEqual(["mañana", "tarde"]);
    expect(w.days.flatMap((d) => d.items)).toHaveLength(2);
  });

  it("tareas pendientes de la semana, incluidas las atrasadas", () => {
    const w = buildWidgetWeek(
      DEFAULT_CALENDARS,
      [],
      [
        task("atrasada", combine("2026-10-01", "00:00")),
        task("domingo", combine("2026-10-18", "00:00")),
        task("siguiente-semana", combine("2026-10-19", "00:00")),
        task("sin-fecha", null),
        task("hecha", combine("2026-10-14", "00:00"), 1),
      ],
      now,
    );
    expect(w.tasks.map((t) => t.id)).toEqual(["atrasada", "domingo"]);
  });

  it("mantiene un momento las recién completadas", () => {
    const w = buildWidgetWeek(DEFAULT_CALENDARS, [], [task("hecha", combine("2026-10-14", "00:00"), 1)], now, new Set(["hecha"]));
    expect(w.tasks).toHaveLength(1);
  });

  it("rango que cruza de mes", () => {
    expect(buildWidgetWeek(DEFAULT_CALENDARS, [], [], combine("2026-10-28", "10:00")).range).toBe("26 oct – 1 nov");
  });
});

describe("shortDue", () => {
  it("etiquetas cortas", () => {
    expect(shortDue({ ...task("a", combine("2026-10-16", "23:59")), dueHasTime: true }, now)).toBe("Hoy 23:59");
    expect(shortDue(task("a", combine("2026-10-17", "00:00")), now)).toBe("Mañana");
    expect(shortDue(task("a", combine("2026-10-18", "00:00")), now)).toBe("dom");
    expect(shortDue(task("a", combine("2026-10-12", "00:00")), now)).toBe("lun 12");
  });
});

import { buildToday, nextUp, untilLabel } from "./widget";
import { expandEvents } from "./occurrences";

describe("ahora / siguiente", () => {
  const occs = (evs: CalEvent[]) => expandEvents(evs, combine("2026-10-16", "00:00"), combine("2026-10-19", "00:00"));
  it("evento en curso", () => {
    const r = nextUp(occs([ev("Cálculo", "2026-10-16", "09:00", "11:00"), ev("Luego", "2026-10-16", "12:00", "13:00")]), now);
    expect(r).toMatchObject({ kind: "now", label: "hasta las 11:00" });
    expect(r!.occ.event.title).toBe("Cálculo");
  });
  it("siguiente evento con cuánto falta", () => {
    const r = nextUp(occs([ev("Tutoría", "2026-10-16", "12:30", "13:15"), ev("Fiesta", "2026-10-17", "22:00", "23:00")]), now);
    expect(r).toMatchObject({ kind: "next", label: "en 2 h 30 min" });
  });
  it("ignora todo el día y lo que está a más de 48 h", () => {
    const allDay = { ...ev("Feria", "2026-10-16", "00:00", "00:00"), allDay: true, end: combine("2026-10-17", "00:00") };
    expect(nextUp(occs([allDay, ev("Lejos", "2026-10-18", "12:00", "13:00")]), now)).toBeNull();
  });
  it("etiquetas de tiempo", () => {
    expect(untilLabel(now + 25 * 60_000, now)).toBe("en 25 min");
    expect(untilLabel(now + 3 * 3600_000, now)).toBe("en 3 h");
    expect(untilLabel(combine("2026-10-17", "09:00"), now)).toBe("mañana a las 9:00");
    expect(untilLabel(combine("2026-10-18", "09:00"), now)).toBe("domingo a las 9:00");
  });
  it("modo Hoy: hoy y mañana ordenados", () => {
    const r = buildToday(DEFAULT_CALENDARS, [ev("B", "2026-10-16", "12:00", "13:00"), ev("A", "2026-10-16", "09:00", "10:00"), ev("M", "2026-10-17", "10:00", "11:00")], now);
    expect(r.today.map((o) => o.event.title)).toEqual(["A", "B"]);
    expect(r.tomorrow.map((o) => o.event.title)).toEqual(["M"]);
  });
});
