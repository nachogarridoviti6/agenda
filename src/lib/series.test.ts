import { describe, expect, it } from "vitest";
import { deleteOccurrence, editOccurrence, shiftWeekday } from "./series";
import { expandEvents } from "./occurrences";
import { combine, dayKey, timeKey } from "./dates";
import type { CalEvent } from "./types";

const master: CalEvent = {
  id: "s", calendarId: "cal-uni", title: "Cálculo", location: "", notes: "", allDay: false,
  start: combine("2026-10-12", "09:00"), end: combine("2026-10-12", "11:00"),
  rrule: "FREQ=WEEKLY;BYDAY=MO,WE", exdates: [], seriesId: null, recurrenceId: null, alerts: [15], createdAt: 1, updatedAt: 1,
};
let n = 0;
const newId = () => `n${++n}`;
const from = combine("2026-10-01", "00:00");
const to = combine("2026-11-01", "00:00");
const show = (evs: CalEvent[]) =>
  expandEvents(evs, from, to).sort((a, b) => a.start - b.start).map((o) => `${dayKey(o.start)} ${timeKey(o.start)} ${o.event.title}`);

/** Aplica las operaciones sobre una "base de datos" en memoria. */
function apply(db: CalEvent[], ops: ReturnType<typeof editOccurrence>): CalEvent[] {
  let out = db.filter((e) => !ops.delete.includes(e.id) && !(e.seriesId && ops.delete.includes(e.seriesId)));
  if (ops.deleteExceptionsFrom) {
    const { seriesId, from } = ops.deleteExceptionsFrom;
    out = out.filter((e) => !(e.seriesId === seriesId && (e.recurrenceId ?? 0) >= from));
  }
  for (const s of ops.save) out = out.some((e) => e.id === s.id) ? out.map((e) => (e.id === s.id ? s : e)) : [...out, s];
  return out;
}

describe("editar repeticiones", () => {
  const wed = combine("2026-10-21", "09:00");

  it("solo este: cambia una repetición y deja el resto igual", () => {
    const draft = { ...master, title: "Cálculo (aula 2)", start: combine("2026-10-21", "12:00"), end: combine("2026-10-21", "14:00") };
    const db = apply([master], editOccurrence(master, wed, draft, "this", newId));
    const out = show(db);
    expect(out).toContain("2026-10-21 12:00 Cálculo (aula 2)");
    expect(out).not.toContain("2026-10-21 09:00 Cálculo");
    expect(out).toContain("2026-10-26 09:00 Cálculo");
    expect(out.filter((x) => x.includes("Cálculo"))).toHaveLength(show([master]).length);
  });

  it("todos los futuros: parte la serie y aplica el cambio desde ahí", () => {
    const draft = { ...master, title: "Cálculo II", start: combine("2026-10-21", "10:00"), end: combine("2026-10-21", "12:00") };
    const db = apply([master], editOccurrence(master, wed, draft, "future", newId));
    expect(db).toHaveLength(2);
    const out = show(db);
    expect(out.slice(0, 3)).toEqual(["2026-10-12 09:00 Cálculo", "2026-10-14 09:00 Cálculo", "2026-10-19 09:00 Cálculo"]);
    expect(out.slice(3, 5)).toEqual(["2026-10-21 10:00 Cálculo II", "2026-10-26 10:00 Cálculo II"]);
  });

  it("todos los futuros desde la primera = editar la serie entera", () => {
    const draft = { ...master, title: "Nuevo" };
    const ops = editOccurrence(master, master.start, draft, "future", newId);
    expect(ops.save).toHaveLength(1);
    expect(ops.save[0].id).toBe("s");
  });

  it("todos los futuros conserva el total con COUNT", () => {
    const m = { ...master, rrule: "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6" };
    const db = apply([m], editOccurrence(m, wed, { ...m, start: wed, end: wed + 7200_000 }, "future", newId));
    expect(show(db)).toHaveLength(6);
  });

  it("los cambios de solo-este posteriores se descartan al editar todos los futuros", () => {
    let db = apply([master], editOccurrence(master, combine("2026-10-26", "09:00"), { ...master, title: "Excepción", start: combine("2026-10-26", "09:00"), end: combine("2026-10-26", "11:00") }, "this", newId));
    const m2 = db.find((e) => e.id === "s")!;
    db = apply(db, editOccurrence(m2, wed, { ...m2, title: "Futuro", start: wed, end: wed + 7200_000 }, "future", newId));
    expect(show(db).some((x) => x.includes("Excepción"))).toBe(false);
  });
});

describe("borrar repeticiones", () => {
  const wed = combine("2026-10-21", "09:00");
  it("solo este", () => {
    const out = show(apply([master], deleteOccurrence(master, wed, "this")));
    expect(out).not.toContain("2026-10-21 09:00 Cálculo");
    expect(out).toContain("2026-10-26 09:00 Cálculo");
  });
  it("todos los futuros", () => {
    const out = show(apply([master], deleteOccurrence(master, wed, "future")));
    expect(out.at(-1)).toBe("2026-10-19 09:00 Cálculo");
  });
  it("todos los futuros desde la primera borra la serie", () => {
    expect(deleteOccurrence(master, master.start, "future").delete).toEqual(["s"]);
  });
});

describe("shiftWeekday", () => {
  it("mover el miércoles al jueves cambia BYDAY", () => {
    expect(shiftWeekday(master, combine("2026-10-21", "09:00"), combine("2026-10-22", "09:00"))).toBe("FREQ=WEEKLY;BYDAY=MO,TH");
  });
  it("mismo día o regla no semanal: sin cambios", () => {
    expect(shiftWeekday(master, combine("2026-10-21", "09:00"), combine("2026-10-21", "12:00"))).toBe(master.rrule);
    expect(shiftWeekday({ ...master, rrule: "FREQ=DAILY" }, combine("2026-10-21", "09:00"), combine("2026-10-22", "09:00"))).toBe("FREQ=DAILY");
  });
});
