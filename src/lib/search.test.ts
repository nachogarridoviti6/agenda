import { describe, expect, it } from "vitest";
import { search } from "./search";
import { combine, dayKey } from "./dates";
import type { CalEvent, Task } from "./types";

const now = combine("2026-10-16", "12:00");
const ev = (id: string, title: string, day: string, over: Partial<CalEvent> = {}): CalEvent => ({
  id, calendarId: "c", title, location: "", notes: "", allDay: false, start: combine(day, "10:00"), end: combine(day, "11:00"),
  rrule: null, exdates: [], seriesId: null, recurrenceId: null, alerts: [], createdAt: 0, updatedAt: 0, ...over,
});
const task = (id: string, title: string, completedAt: number | null = null): Task => ({
  id, calendarId: "c", title, notes: "", due: null, dueHasTime: false, priority: 0, completedAt, createdAt: 0, updatedAt: 0,
});
const ids = (h: ReturnType<typeof search>) => h.map((x) => (x.kind === "event" ? x.event.id : x.task.id));

describe("búsqueda", () => {
  const events = [
    ev("pasado", "Examen Termodinámica", "2026-09-01"),
    ev("futuro-lejos", "Examen Cálculo", "2026-12-10"),
    ev("futuro-cerca", "Examen fabricación", "2026-10-20"),
    ev("lugar", "Visita", "2026-10-18", { location: "Calle Larios" }),
    ev("serie", "Cálculo II", "2026-09-07", { rrule: "FREQ=WEEKLY" }),
  ];
  it("sin acentos ni mayúsculas, próximos primero y luego pasados", () => {
    expect(ids(search(events, [], "EXAMEN", now))).toEqual(["futuro-cerca", "futuro-lejos", "pasado"]);
    expect(ids(search(events, [], "termodinamica", now))).toEqual(["pasado"]);
  });
  it("busca en el lugar y exige todas las palabras", () => {
    expect(ids(search(events, [], "larios", now))).toEqual(["lugar"]);
    expect(ids(search(events, [], "examen calc", now))).toEqual(["futuro-lejos"]);
  });
  it("de una serie enseña la próxima repetición", () => {
    const [hit] = search(events, [], "calculo ii", now);
    expect(hit.kind === "event" && dayKey(hit.start)).toBe("2026-10-19");
  });
  it("incluye tareas; las hechas al final", () => {
    expect(ids(search([], [task("hecha", "Entrega memoria", 1), task("pendiente", "Entrega práctica")], "entrega", now))).toEqual(["pendiente", "hecha"]);
  });
  it("consulta vacía no devuelve nada", () => {
    expect(search(events, [], "  ", now)).toEqual([]);
  });
});
