import { describe, expect, it } from "vitest";
import { completeTask, nextDue, snooze } from "./tasks";
import { combine, dayKey, timeKey } from "./dates";
import type { Task } from "./types";

const now = combine("2026-10-17", "10:00");
const task = (over: Partial<Task> = {}): Task => ({
  id: "t", calendarId: "cal-personal", title: "Pagar alquiler", notes: "", due: combine("2026-11-01", "00:00"), dueHasTime: false,
  priority: 2, completedAt: null, createdAt: 0, updatedAt: 0, rrule: null, ...over,
});
let n = 0;
const newId = () => `c${++n}`;

describe("tareas que se repiten", () => {
  it("siguiente fecha: mensual, semanal con hora y diaria", () => {
    expect(dayKey(nextDue(task({ rrule: "FREQ=MONTHLY" }))!)).toBe("2026-12-01");
    const t = task({ rrule: "FREQ=WEEKLY", due: combine("2026-10-23", "23:59"), dueHasTime: true });
    expect(`${dayKey(nextDue(t)!)} ${timeKey(nextDue(t)!)}`).toBe("2026-10-30 23:59");
    expect(nextDue(task())).toBeNull();
  });

  it("completar una tarea normal la marca como hecha", () => {
    const [done] = completeTask(task(), now, newId);
    expect(done.completedAt).toBe(now);
    expect(done.id).toBe("t");
  });

  it("completar una que se repite guarda una copia hecha y la mueve a la siguiente fecha", () => {
    const out = completeTask(task({ rrule: "FREQ=MONTHLY" }), now, newId);
    expect(out).toHaveLength(2);
    const [history, moved] = out;
    expect(history).toMatchObject({ completedAt: now, rrule: null, due: combine("2026-11-01", "00:00") });
    expect(history.id).not.toBe("t");
    expect(moved).toMatchObject({ id: "t", completedAt: null, rrule: "FREQ=MONTHLY" });
    expect(dayKey(moved.due!)).toBe("2026-12-01");
  });

  it("con fin: COUNT baja y al acabar se completa del todo; UNTIL se respeta", () => {
    const [, moved] = completeTask(task({ rrule: "FREQ=WEEKLY;COUNT=3" }), now, newId);
    expect(moved.rrule).toBe("FREQ=WEEKLY;COUNT=2");
    expect(completeTask(task({ rrule: "FREQ=WEEKLY;COUNT=1" }), now, newId)).toHaveLength(1);
    expect(completeTask(task({ rrule: "FREQ=MONTHLY;UNTIL=20261115" }), now, newId)).toHaveLength(1);
  });

  it("posponer mantiene la hora", () => {
    const t = task({ due: combine("2026-10-16", "18:30"), dueHasTime: true });
    const s = snooze(t, "tomorrow", now);
    expect(`${dayKey(s.due!)} ${timeKey(s.due!)}`).toBe("2026-10-18 18:30");
    expect(dayKey(snooze(task(), "nextWeek", now).due!)).toBe("2026-10-24");
    expect(dayKey(snooze(task(), "today", now).due!)).toBe("2026-10-17");
  });
});
