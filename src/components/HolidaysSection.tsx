import { useEffect, useState } from "react";
import { useStore } from "../store";
import { backend } from "../lib/backend";
import { holidaysFor, REGIONS } from "../lib/holidays";
import { addDaysZ, parseDayKey } from "../lib/dates";
import type { CalEvent } from "../lib/types";
import { Row } from "./fields";

export const HOLIDAYS_CALENDAR_ID = "cal-festivos";

/** Crea o actualiza el calendario "Festivos" con este año y el siguiente. */
export async function applyHolidays(region: string | null, now = Date.now()) {
  const year = new Date(now).getFullYear();
  const calendars = await backend.listCalendars();
  const existing = calendars.find((c) => c.id === HOLIDAYS_CALENDAR_ID);
  const cal = existing ?? { id: HOLIDAYS_CALENDAR_ID, name: "Festivos", color: "#FF3B30", visible: true, sortOrder: Math.max(-1, ...calendars.map((c) => c.sortOrder)) + 1 };
  // Se borran los festivos generados antes (por si cambió la comunidad) y se vuelven a crear.
  const old = (await backend.listAllEvents()).filter((e) => e.calendarId === HOLIDAYS_CALENDAR_ID && e.id.startsWith("fest-"));
  for (const e of old) await backend.deleteEvent(e.id);
  const events: CalEvent[] = [year, year + 1].flatMap((y) =>
    holidaysFor(y, region).map((h) => {
      const start = parseDayKey(h.date);
      return {
        id: `fest-${h.date}`,
        calendarId: HOLIDAYS_CALENDAR_ID,
        title: h.name,
        location: "",
        notes: h.scope === "autonómico" ? `Festivo en ${REGIONS[region!]?.name}` : "Festivo nacional",
        allDay: true,
        start,
        end: addDaysZ(start, 1),
        rrule: null,
        exdates: [],
        seriesId: null,
        recurrenceId: null,
        alerts: [],
        createdAt: now,
        updatedAt: now,
      };
    }),
  );
  await backend.saveBulk(existing ? [] : [cal], events, []);
  await backend.setSetting("holidayRegion", region);
  await backend.setSetting("holidaysYear", year);
  return events.length;
}

export function HolidaysSection() {
  const [region, setRegion] = useState<string>("");
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const calendars = useStore((s) => s.calendars);

  useEffect(() => {
    void backend.getSettings().then((s) => {
      setRegion((s.holidayRegion as string | null) ?? "");
    });
  }, []);
  useEffect(() => setEnabled(calendars.some((c) => c.id === HOLIDAYS_CALENDAR_ID)), [calendars]);

  const apply = async (r: string) => {
    setRegion(r);
    const n = await applyHolidays(r || null);
    setMsg(`Añadidos ${n} festivos de ${new Date().getFullYear()} y ${new Date().getFullYear() + 1} en el calendario «Festivos».`);
  };

  return (
    <>
      <div className="f-group">
        <Row label="Comunidad">
          <select value={region} onChange={(e) => (enabled ? void apply(e.target.value) : setRegion(e.target.value))} aria-label="Comunidad autónoma">
            <option value="">Solo nacionales</option>
            {Object.entries(REGIONS)
              .sort((a, b) => a[1].name.localeCompare(b[1].name))
              .map(([k, r]) => (
                <option key={k} value={k}>{r.name}</option>
              ))}
          </select>
          {!enabled && <button className="btn small" onClick={() => void apply(region)}>Añadir festivos</button>}
        </Row>
      </div>
      <p className="f-help">
        {msg ?? "Crea el calendario «Festivos» con los festivos nacionales y los de tu comunidad (este año y el siguiente)."} Los traslados a lunes cuando un
        festivo cae en domingo y los festivos locales de tu ciudad cambian cada año: añádelos a mano si hace falta.
      </p>
    </>
  );
}
