import { describe, expect, it } from "vitest";
import { buildSemester } from "./semester";
import { expandEvents } from "./occurrences";
import { combine, dayKey, timeKey } from "./dates";

let n = 0;
const newId = () => `s${++n}`;

describe("horario del cuatrimestre", () => {
  const evs = buildSemester(
    {
      calendarId: "cal-uni",
      start: "2026-09-23", // miércoles
      end: "2026-10-16",
      rows: [
        { subject: "Cálculo II", days: [0, 2], from: "09:00", to: "11:00", location: "Aula 1.2" },
        { subject: "Fabricación", days: [3], from: "11:30", to: "13:30", location: "" },
        { subject: "", days: [1], from: "10:00", to: "11:00", location: "" }, // sin nombre → se ignora
      ],
      skipDays: ["2026-10-12"], // Fiesta Nacional (lunes)
      alerts: [10],
    },
    newId,
  );

  it("una serie semanal por asignatura, empezando el primer día que toca", () => {
    expect(evs).toHaveLength(2);
    expect(evs[0]).toMatchObject({ title: "Cálculo II", location: "Aula 1.2", alerts: [10], calendarId: "cal-uni" });
    expect(`${dayKey(evs[0].start)} ${timeKey(evs[0].start)}`).toBe("2026-09-23 09:00"); // el miércoles 23
    expect(evs[0].rrule).toMatch(/^FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261016T2159/);
  });

  it("termina con el cuatrimestre y se salta los festivos", () => {
    const occ = expandEvents([evs[0]], combine("2026-09-01", "00:00"), combine("2026-12-01", "00:00")).map((o) => dayKey(o.start));
    expect(occ).toEqual(["2026-09-23", "2026-09-28", "2026-09-30", "2026-10-05", "2026-10-07", "2026-10-14"]);
    expect(occ).not.toContain("2026-10-12");
  });
});
