import { describe, expect, it } from "vitest";
import { easterSunday, holidaysFor } from "./holidays";

describe("festivos", () => {
  it.each([
    [2025, [4, 20]],
    [2026, [4, 5]],
    [2027, [3, 28]],
    [2028, [4, 16]],
    [2030, [4, 21]],
  ])("Pascua %i", (y, md) => expect(easterSunday(y as number)).toEqual(md));

  it("nacionales 2026 con Viernes Santo calculado", () => {
    const h = holidaysFor(2026, null);
    expect(h).toHaveLength(10);
    expect(h.find((x) => x.name === "Viernes Santo")!.date).toBe("2026-04-03");
    expect(h[0]).toEqual({ date: "2026-01-01", name: "Año Nuevo", scope: "nacional" });
  });

  it("Andalucía añade Jueves Santo y el 28 de febrero", () => {
    const h = holidaysFor(2026, "AN");
    expect(h.find((x) => x.name === "Jueves Santo")!.date).toBe("2026-04-02");
    expect(h.find((x) => x.date === "2026-02-28")!.scope).toBe("autonómico");
    expect(h).toHaveLength(12);
  });

  it("Cataluña tiene Lunes de Pascua y no Jueves Santo", () => {
    const h = holidaysFor(2027, "CT");
    expect(h.find((x) => x.name === "Lunes de Pascua")!.date).toBe("2027-03-29");
    expect(h.some((x) => x.name === "Jueves Santo")).toBe(false);
  });
});
