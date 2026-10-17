import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { backend, newId } from "../lib/backend";
import { buildSemester, type ClassRow } from "../lib/semester";
import { holidaysFor } from "../lib/holidays";
import { addMonthsZ, dayKey, parseDayKey } from "../lib/dates";
import { Modal } from "./Modal";
import { CalendarSelect, Row, Switch } from "./fields";
import { DateInput, TimeInput } from "./DateTimeInputs";

const DOW = ["L", "M", "X", "J", "V", "S"];
const emptyRow = (): ClassRow => ({ subject: "", days: [], from: "09:00", to: "11:00", location: "" });

/** Asistente para meter el horario del cuatrimestre de una vez. */
export function SemesterWizard({ onClose }: { onClose(): void }) {
  const calendars = useStore((s) => s.calendars);
  const uni = calendars.find((c) => /uni|clase|facultad/i.test(c.name)) ?? calendars[0];
  const [calendarId, setCalendarId] = useState(uni?.id ?? "");
  const [start, setStart] = useState(dayKey(Date.now()));
  const [end, setEnd] = useState(dayKey(addMonthsZ(Date.now(), 4)));
  const [rows, setRows] = useState<ClassRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [skipHolidays, setSkipHolidays] = useState(true);
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState<string | null>(null);
  useEffect(() => void backend.getSettings().then((s) => setRegion((s.holidayRegion as string | undefined) ?? null)), []);

  const skipDays = useMemo(() => {
    if (!skipHolidays) return [];
    const y1 = Number(start.slice(0, 4));
    const y2 = Number(end.slice(0, 4));
    const out: string[] = [];
    for (let y = y1; y <= y2; y++) out.push(...holidaysFor(y, region).map((h) => h.date));
    return out;
  }, [skipHolidays, start, end, region]);

  const events = useMemo(
    () => buildSemester({ calendarId, start, end, rows, skipDays, alerts: [10] }, newId),
    [calendarId, start, end, rows, skipDays],
  );
  const update = (i: number, patch: Partial<ClassRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const invalidRange = parseDayKey(end) <= parseDayKey(start);

  const create = async () => {
    setBusy(true);
    try {
      await backend.saveBulk([], events, []);
      onClose();
    } catch (e) {
      setBusy(false);
      useStore.setState({ error: String(e) });
    }
  };

  return (
    <Modal title="Horario del cuatrimestre" onClose={onClose} width={640}>
      <div className="form">
        <div className="f-group">
          <Row label="Calendario">
            <CalendarSelect calendars={calendars} value={calendarId} onChange={setCalendarId} />
          </Row>
          <Row label="Empieza">
            <DateInput label="Inicio del cuatrimestre" value={start} onChange={setStart} />
          </Row>
          <Row label="Termina">
            <DateInput label="Fin del cuatrimestre" value={end} onChange={setEnd} />
          </Row>
          <Row label="Sin clase en festivos">
            <Switch checked={skipHolidays} onChange={setSkipHolidays} label="Sin clase en festivos" />
          </Row>
        </div>
        {invalidRange && <p className="f-error">El final tiene que ser posterior al inicio.</p>}

        <div className="sem-rows">
          <div className="sem-head">
            <span>Asignatura</span>
            <span>Días</span>
            <span>Hora</span>
            <span>Aula</span>
            <span />
          </div>
          {rows.map((r, i) => (
            <div key={i} className="sem-row" style={{ "--c": calendars.find((c) => c.id === calendarId)?.color } as CSSProperties}>
              <input className="text-input" placeholder="p. ej. Cálculo II" value={r.subject} onChange={(e) => update(i, { subject: e.target.value })} aria-label={`Asignatura ${i + 1}`} />
              <div className="dow-picker small">
                {DOW.map((d, k) => (
                  <button
                    type="button"
                    key={d}
                    className={r.days.includes(k) ? "is-on" : ""}
                    aria-pressed={r.days.includes(k)}
                    aria-label={`${d} asignatura ${i + 1}`}
                    onClick={() => update(i, { days: r.days.includes(k) ? r.days.filter((x) => x !== k) : [...r.days, k] })}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="sem-time">
                <TimeInput label={`Inicio asignatura ${i + 1}`} value={r.from} onChange={(v) => update(i, { from: v })} />
                <span>–</span>
                <TimeInput label={`Fin asignatura ${i + 1}`} value={r.to} onChange={(v) => update(i, { to: v })} />
              </div>
              <input className="text-input" placeholder="Aula" value={r.location} onChange={(e) => update(i, { location: e.target.value })} aria-label={`Aula asignatura ${i + 1}`} />
              <button type="button" className="icon-btn sm" aria-label="Quitar" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="link-btn sem-add" onClick={() => setRows((rs) => [...rs, emptyRow()])}>
            + Añadir asignatura
          </button>
        </div>

        <p className="f-help">
          Cada asignatura se repite cada semana en sus días hasta el final del cuatrimestre, con un aviso 10 minutos antes.
          {skipHolidays && ` Se saltan los festivos${region ? "" : " nacionales (elige tu comunidad en Ajustes → Festivos para incluir los autonómicos)"}.`}
        </p>
        <div className="f-actions">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || invalidRange || events.length === 0} onClick={() => void create()}>
            {events.length ? `Crear ${events.length} ${events.length === 1 ? "asignatura" : "asignaturas"}` : "Crear"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
