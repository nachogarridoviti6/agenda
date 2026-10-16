import { describe, expect, it } from "vitest";
import {
  addDaysZ,
  combine,
  dayKey,
  fromLocal,
  minutesIntoDay,
  monthGridDays,
  startOfDayZ,
  startOfWeekZ,
  stepCursor,
  timeKey,
  viewRange,
  viewTitle,
  weekDays,
} from "./dates";

describe("zona horaria Europe/Madrid", () => {
  it("convierte hora de reloj a UTC en verano (UTC+2) e invierno (UTC+1)", () => {
    expect(new Date(fromLocal(2026, 6, 1, 10, 0)).toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(new Date(fromLocal(2026, 0, 15, 10, 0)).toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("el día de Madrid no depende de la hora UTC", () => {
    // 23:30 UTC del 16 de octubre ya es 17 en Madrid (UTC+2)
    expect(dayKey(Date.UTC(2026, 9, 16, 23, 30))).toBe("2026-10-17");
    expect(timeKey(Date.UTC(2026, 9, 16, 23, 30))).toBe("01:30");
  });

  it("sumar un día cruzando el cambio de hora mantiene la hora de reloj", () => {
    // 25 de octubre de 2026: se atrasa la hora (ese día dura 25 h)
    const sat = combine("2026-10-24", "10:00");
    const sun = addDaysZ(sat, 1);
    expect(timeKey(sun)).toBe("10:00");
    expect(sun - sat).toBe(25 * 3600_000);
    // 29 de marzo de 2026: se adelanta (ese día dura 23 h)
    const a = combine("2026-03-28", "09:00");
    expect(timeKey(addDaysZ(a, 1))).toBe("09:00");
    expect(addDaysZ(a, 1) - a).toBe(23 * 3600_000);
  });

  it("startOfDay en un día con cambio de hora", () => {
    const noon = combine("2026-10-25", "12:00");
    expect(new Date(startOfDayZ(noon)).toISOString()).toBe("2026-10-24T22:00:00.000Z");
  });

  it("minutesIntoDay devuelve 1440 para la medianoche siguiente", () => {
    const day = combine("2026-10-16", "00:00");
    expect(minutesIntoDay(combine("2026-10-16", "13:45"), day)).toBe(825);
    expect(minutesIntoDay(combine("2026-10-17", "00:00"), day)).toBe(1440);
    expect(minutesIntoDay(day, day)).toBe(0);
  });
});

describe("semanas y meses (semana empieza en lunes)", () => {
  it("la semana del viernes 16/10/2026 va del lunes 12 al domingo 18", () => {
    const days = weekDays(combine("2026-10-16", "15:00")).map(dayKey);
    expect(days).toEqual([
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18",
    ]);
  });

  it("un domingo pertenece a la semana que empezó el lunes anterior", () => {
    expect(dayKey(startOfWeekZ(combine("2026-10-18", "23:00")))).toBe("2026-10-12");
  });

  it("la cuadrícula de mes tiene 42 días y empieza en lunes", () => {
    const grid = monthGridDays(combine("2026-10-16", "12:00"));
    expect(grid).toHaveLength(42);
    expect(dayKey(grid[0])).toBe("2026-09-28");
    expect(dayKey(grid[41])).toBe("2026-11-08");
  });

  it("rangos de vista", () => {
    const c = combine("2026-10-16", "12:00");
    const [ws, we] = viewRange("week", c);
    expect([dayKey(ws), dayKey(we)]).toEqual(["2026-10-12", "2026-10-19"]);
    const [ds, de] = viewRange("day", c);
    expect([dayKey(ds), dayKey(de)]).toEqual(["2026-10-16", "2026-10-17"]);
  });

  it("navegar de mes desde el día 31 no se salta meses", () => {
    const jan31 = combine("2026-01-31", "12:00");
    expect(dayKey(stepCursor("month", jan31, 1))).toBe("2026-02-01");
  });

  it("títulos en español", () => {
    const c = combine("2026-10-16", "12:00");
    expect(viewTitle("month", c)).toBe("Octubre 2026");
    expect(viewTitle("week", c)).toBe("Octubre 2026");
    expect(viewTitle("week", combine("2026-10-28", "12:00"))).toBe("Oct – nov 2026");
    expect(viewTitle("day", c)).toBe("Viernes, 16 de octubre de 2026");
  });
});
