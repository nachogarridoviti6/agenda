import { describe, expect, it } from "vitest";
import { countBefore, describeRule, expandRule, formatRRule, parseRRule, type Rule } from "./rrule";
import { addDaysZ, combine, dayKey, timeKey } from "./dates";

const r = (s: string) => parseRRule(s) as Rule;
const keys = (xs: number[]) => xs.map((x) => `${dayKey(x)} ${timeKey(x)}`);
const timed = (day: string, from: string, to: string) => ({ start: combine(day, from), end: combine(day, to), allDay: false });
const range = (a: string, b: string) => [combine(a, "00:00"), combine(b, "00:00")] as const;

describe("parse / format", () => {
  it("ida y vuelta", () => {
    const s = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10";
    expect(formatRRule(r(s), false)).toBe(s);
    expect(r("RRULE:FREQ=DAILY").freq).toBe("DAILY");
    expect(parseRRule("FREQ=HOURLY")).toBeNull();
    expect(parseRRule(null)).toBeNull();
  });

  it("UNTIL en UTC y en fecha", () => {
    expect(new Date(r("FREQ=DAILY;UNTIL=20261220T225959Z").until!).toISOString()).toBe("2026-12-20T22:59:59.000Z");
    // fecha sola = hasta el final de ese día en Madrid
    const u = r("FREQ=DAILY;UNTIL=20261220").until!;
    expect(dayKey(u)).toBe("2026-12-20");
    expect(dayKey(u + 1)).toBe("2026-12-21");
    expect(formatRRule({ ...r("FREQ=DAILY"), until: u }, true)).toBe("FREQ=DAILY;UNTIL=20261220");
  });
});

describe("expansión", () => {
  it("diaria con COUNT", () => {
    const out = expandRule(r("FREQ=DAILY;COUNT=3"), timed("2026-10-16", "09:00", "10:00"), ...range("2026-10-01", "2026-11-01"));
    expect(keys(out)).toEqual(["2026-10-16 09:00", "2026-10-17 09:00", "2026-10-18 09:00"]);
  });

  it("mantiene la hora de reloj al cambiar la hora (25 oct 2026)", () => {
    const out = expandRule(r("FREQ=DAILY"), timed("2026-10-24", "09:00", "10:00"), ...range("2026-10-24", "2026-10-27"));
    expect(keys(out)).toEqual(["2026-10-24 09:00", "2026-10-25 09:00", "2026-10-26 09:00"]);
  });

  it("semanal eligiendo días (lunes y miércoles) con fin", () => {
    const rule = r("FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261028T225959Z");
    const out = expandRule(rule, timed("2026-10-14", "09:00", "11:00"), ...range("2026-10-01", "2026-12-01"));
    // Empieza el miércoles 14: el lunes 12 no cuenta
    expect(keys(out)).toEqual(["2026-10-14 09:00", "2026-10-19 09:00", "2026-10-21 09:00", "2026-10-26 09:00", "2026-10-28 09:00"]);
  });

  it("cada 2 semanas", () => {
    const out = expandRule(r("FREQ=WEEKLY;INTERVAL=2"), timed("2026-10-05", "18:00", "19:00"), ...range("2026-10-01", "2026-11-10"));
    expect(out.map(dayKey)).toEqual(["2026-10-05", "2026-10-19", "2026-11-02"]);
  });

  it("mensual el día 31 se salta los meses cortos", () => {
    const out = expandRule(r("FREQ=MONTHLY"), timed("2026-01-31", "10:00", "11:00"), ...range("2026-01-01", "2026-06-01"));
    expect(out.map(dayKey)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("mensual: tercer viernes y último viernes", () => {
    const third = expandRule(r("FREQ=MONTHLY;BYDAY=3FR"), timed("2026-10-16", "10:00", "11:00"), ...range("2026-10-01", "2027-01-01"));
    expect(third.map(dayKey)).toEqual(["2026-10-16", "2026-11-20", "2026-12-18"]);
    const last = expandRule(r("FREQ=MONTHLY;BYDAY=-1FR"), timed("2026-10-30", "10:00", "11:00"), ...range("2026-10-01", "2027-01-01"));
    expect(last.map(dayKey)).toEqual(["2026-10-30", "2026-11-27", "2026-12-25"]);
  });

  it("anual el 29 de febrero solo en bisiestos", () => {
    const out = expandRule(r("FREQ=YEARLY"), { ...timed("2028-02-29", "00:00", "00:00"), allDay: true, end: addDaysZ(combine("2028-02-29", "00:00"), 1) }, ...range("2028-01-01", "2034-01-01"));
    expect(out.map(dayKey)).toEqual(["2028-02-29", "2032-02-29"]);
  });

  it("EXDATE quita repeticiones pero cuenta para COUNT", () => {
    const series = { ...timed("2026-10-16", "09:00", "10:00"), exdates: [combine("2026-10-17", "09:00")] };
    const out = expandRule(r("FREQ=DAILY;COUNT=3"), series, ...range("2026-10-01", "2026-11-01"));
    expect(out.map(dayKey)).toEqual(["2026-10-16", "2026-10-18"]);
  });

  it("solo devuelve lo que solapa el rango, también en series largas", () => {
    const series = { start: combine("2020-01-01", "23:00"), end: combine("2020-01-02", "01:00"), allDay: false };
    const out = expandRule(r("FREQ=DAILY"), series, ...range("2026-10-16", "2026-10-17"));
    // el de la noche del 15 termina a la 1:00 del 16 → también solapa
    expect(keys(out)).toEqual(["2026-10-15 23:00", "2026-10-16 23:00"]);
  });

  it("eventos de todo el día de varios días", () => {
    const start = combine("2026-10-14", "00:00");
    const out = expandRule(r("FREQ=WEEKLY"), { start, end: addDaysZ(start, 2), allDay: true }, ...range("2026-10-20", "2026-10-22"));
    expect(out.map(dayKey)).toEqual(["2026-10-21"]);
  });

  it("countBefore", () => {
    expect(countBefore(r("FREQ=DAILY;COUNT=10"), timed("2026-10-16", "09:00", "10:00"), combine("2026-10-19", "09:00"))).toBe(3);
  });
});

describe("descripción", () => {
  const start = combine("2026-10-16", "09:00");
  it.each([
    ["FREQ=DAILY", "Cada día"],
    ["FREQ=DAILY;INTERVAL=3", "Cada 3 días"],
    ["FREQ=WEEKLY", "Cada semana el viernes"],
    ["FREQ=WEEKLY;BYDAY=MO,WE,FR", "Cada semana el lunes, miércoles y viernes"],
    ["FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "Cada semana de lunes a viernes"],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", "Cada 2 semanas el martes"],
    ["FREQ=MONTHLY", "Cada mes el día 16"],
    ["FREQ=MONTHLY;BYDAY=3FR", "Cada mes el tercer viernes"],
    ["FREQ=MONTHLY;BYDAY=-1FR", "Cada mes el último viernes"],
    ["FREQ=YEARLY", "Cada año el 16 de octubre"],
    ["FREQ=DAILY;COUNT=5", "Cada día, 5 veces"],
    ["FREQ=DAILY;UNTIL=20261220", "Cada día, hasta el 20 dic 2026"],
  ])("%s → %s", (rule, text) => expect(describeRule(r(rule), start)).toBe(text));
});
