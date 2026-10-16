import { describe, expect, it } from "vitest";
import { isOverdue, occurrenceTimeLabel, taskDueLabel } from "./format";
import { addDaysZ, combine } from "./dates";
import type { CalEvent, Task } from "./types";

const now = combine("2026-10-16", "12:00"); // viernes

function task(due: number | null, dueHasTime: boolean, completedAt: number | null = null): Task {
  return { id: "t", calendarId: "c", title: "T", notes: "", due, dueHasTime, priority: 0, completedAt, createdAt: 0, updatedAt: 0 };
}

describe("etiquetas", () => {
  it("fechas relativas de tareas", () => {
    expect(taskDueLabel(task(combine("2026-10-16", "23:59"), true), now)).toBe("Hoy 23:59");
    expect(taskDueLabel(task(combine("2026-10-17", "00:00"), false), now)).toBe("Mañana");
    expect(taskDueLabel(task(combine("2026-10-15", "00:00"), false), now)).toBe("Ayer");
    expect(taskDueLabel(task(combine("2026-10-20", "09:00"), true), now)).toBe("Martes 9:00");
    expect(taskDueLabel(task(combine("2026-11-02", "00:00"), false), now)).toBe("lun 2 nov");
  });

  it("vencidas", () => {
    expect(isOverdue(task(combine("2026-10-16", "11:00"), true), now)).toBe(true);
    expect(isOverdue(task(combine("2026-10-16", "00:00"), false), now)).toBe(false);
    expect(isOverdue(task(combine("2026-10-15", "00:00"), false), now)).toBe(true);
    expect(isOverdue(task(combine("2026-10-15", "00:00"), false, 1), now)).toBe(false);
  });

  it("horario de eventos", () => {
    const base: CalEvent = {
      id: "e", calendarId: "c", title: "E", location: "", notes: "", allDay: false, start: 0, end: 0,
      rrule: null, exdates: [], seriesId: null, recurrenceId: null, alerts: [], createdAt: 0, updatedAt: 0,
    };
    const s = combine("2026-10-16", "10:00");
    const e = combine("2026-10-16", "13:00");
    expect(occurrenceTimeLabel({ key: "", event: base, start: s, end: e })).toBe("10:00 – 13:00");
    const d = combine("2026-10-16", "00:00");
    expect(occurrenceTimeLabel({ key: "", event: { ...base, allDay: true }, start: d, end: addDaysZ(d, 1) })).toBe("Todo el día");
    expect(occurrenceTimeLabel({ key: "", event: { ...base, allDay: true }, start: d, end: addDaysZ(d, 3) })).toBe("16 oct – 18 oct");
  });
});
