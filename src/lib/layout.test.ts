import { describe, expect, it } from "vitest";
import { layoutDay } from "./layout";
import { combine } from "./dates";
import type { CalEvent, Occurrence } from "./types";

const day = combine("2026-10-16", "00:00");

function occ(title: string, from: string, to: string, toDay = "2026-10-16", fromDay = "2026-10-16"): Occurrence {
  const start = combine(fromDay, from);
  const end = combine(toDay, to);
  const event: CalEvent = {
    id: title, calendarId: "c", title, location: "", notes: "", allDay: false, start, end,
    rrule: null, exdates: [], seriesId: null, recurrenceId: null, alerts: [], createdAt: 0, updatedAt: 0,
  };
  return { key: title, event, start, end };
}

const byTitle = (p: ReturnType<typeof layoutDay>) =>
  Object.fromEntries(p.map((x) => [x.occ.event.title, { col: x.col, cols: x.cols, top: x.top, height: x.height }]));

describe("layoutDay", () => {
  it("eventos sin solape ocupan todo el ancho", () => {
    const r = byTitle(layoutDay([occ("A", "09:00", "10:00"), occ("B", "10:00", "11:00")], day));
    expect(r.A).toMatchObject({ col: 0, cols: 1, top: 540, height: 60 });
    expect(r.B).toMatchObject({ col: 0, cols: 1 });
  });

  it("dos eventos solapados se reparten en dos columnas", () => {
    const r = byTitle(layoutDay([occ("A", "09:00", "11:00"), occ("B", "10:00", "12:00")], day));
    expect(r.A).toMatchObject({ col: 0, cols: 2 });
    expect(r.B).toMatchObject({ col: 1, cols: 2 });
  });

  it("reutiliza columnas libres dentro del mismo grupo", () => {
    const r = byTitle(
      layoutDay([occ("A", "09:00", "12:00"), occ("B", "09:00", "10:00"), occ("C", "10:30", "11:00")], day),
    );
    expect(r.A.cols).toBe(2);
    expect(r.B.col).toBe(1);
    expect(r.C.col).toBe(1);
  });

  it("recorta eventos que cruzan la medianoche", () => {
    const night = occ("N", "22:00", "02:00", "2026-10-17");
    expect(byTitle(layoutDay([night], day)).N).toMatchObject({ top: 1320, height: 120 });
    const next = combine("2026-10-17", "00:00");
    expect(byTitle(layoutDay([night], next)).N).toMatchObject({ top: 0, height: 120 });
  });

  it("aplica altura mínima a eventos muy cortos", () => {
    expect(byTitle(layoutDay([occ("X", "09:00", "09:05")], day)).X.height).toBe(15);
  });
});

import { layoutSpans } from "./layout";
import { addDaysZ, weekDays } from "./dates";

describe("layoutSpans", () => {
  const days = weekDays(combine("2026-10-14", "12:00")); // lun 12 – dom 18
  function allDay(title: string, from: string, toInclusive: string): Occurrence {
    const o = occ(title, "00:00", "00:00", toInclusive, from);
    const end = addDaysZ(combine(toInclusive, "00:00"), 1); // fin exclusivo
    return { ...o, end, event: { ...o.event, allDay: true, end } };
  }

  it("barras en carriles distintos cuando se solapan", () => {
    const { bars, lanes } = layoutSpans(
      [allDay("Viaje", "2026-10-13", "2026-10-15"), allDay("Feria", "2026-10-14", "2026-10-14"), allDay("Otro", "2026-10-16", "2026-10-16")],
      days,
    );
    const r = Object.fromEntries(bars.map((b) => [b.occ.event.title, b]));
    expect(lanes).toBe(2);
    expect(r.Viaje).toMatchObject({ startCol: 1, endCol: 3, lane: 0 });
    expect(r.Feria).toMatchObject({ startCol: 2, endCol: 2, lane: 1 });
    expect(r.Otro).toMatchObject({ startCol: 4, lane: 0 });
  });

  it("recorta a la semana visible", () => {
    const { bars } = layoutSpans([allDay("Largo", "2026-10-10", "2026-10-20")], days);
    expect(bars[0]).toMatchObject({ startCol: 0, endCol: 6, clippedStart: true, clippedEnd: true });
  });

  it("los eventos con hora de menos de 24 h no van a la franja", () => {
    expect(layoutSpans([occ("Cena", "21:00", "01:00", "2026-10-15", "2026-10-14")], days).bars).toHaveLength(0);
  });
});
