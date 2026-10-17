import { describe, expect, it } from "vitest";
import { duplicateEvent, eventFromTemplate, templateFromEvent } from "./templates";
import { addDaysZ, combine, dayKey, timeKey } from "./dates";
import type { CalEvent } from "./types";

let n = 0;
const newId = () => `x${++n}`;
const grabacion: CalEvent = {
  id: "e", calendarId: "cal-trabajo", title: "Grabación villa", location: "Marbella", notes: "- Dron\n- Gimbal\n- Baterías",
  allDay: false, start: combine("2026-10-20", "10:00"), end: combine("2026-10-20", "13:00"),
  rrule: "FREQ=WEEKLY", exdates: [1], seriesId: null, recurrenceId: null, alerts: [60], createdAt: 0, updatedAt: 0,
};

describe("plantillas y duplicar", () => {
  it("de evento a plantilla y de plantilla a evento en otra fecha", () => {
    const t = templateFromEvent(grabacion, newId);
    expect(t).toMatchObject({ name: "Grabación villa", duration: 180, location: "Marbella", alerts: [60] });
    const e = eventFromTemplate(t, combine("2026-11-03", "16:00"), newId);
    expect(`${dayKey(e.start)} ${timeKey(e.start)}-${timeKey(e.end)}`).toBe("2026-11-03 16:00-19:00");
    expect(e).toMatchObject({ title: "Grabación villa", notes: grabacion.notes, rrule: null, calendarId: "cal-trabajo" });
  });

  it("plantillas de todo el día de varios días", () => {
    const d = combine("2026-10-22", "00:00");
    const t = templateFromEvent({ ...grabacion, allDay: true, start: d, end: addDaysZ(d, 2) }, newId);
    expect(t.duration).toBe(2880);
    const e = eventFromTemplate(t, combine("2026-12-01", "15:00"), newId);
    expect([dayKey(e.start), dayKey(e.end)]).toEqual(["2026-12-01", "2026-12-03"]);
  });

  it("duplicar crea un evento suelto e independiente", () => {
    const c = duplicateEvent(grabacion, newId);
    expect(c.id).not.toBe("e");
    expect(c).toMatchObject({ rrule: null, exdates: [], start: grabacion.start, title: "Grabación villa" });
  });
});
