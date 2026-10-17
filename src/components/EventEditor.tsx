import { useState } from "react";
import { useStore } from "../store";
import type { CalEvent } from "../lib/types";
import { addDaysZ, combine, dayKey, startOfDayZ, timeKey } from "../lib/dates";
import { formatRRule, parseRRule, type Rule } from "../lib/rrule";
import { shiftWeekday } from "../lib/series";
import { RepeatEditor } from "./RepeatEditor";
import { AlertsEditor } from "./AlertsEditor";
import { useCloud } from "../cloud";
import { templateFromEvent } from "../lib/templates";
import { newId } from "../lib/backend";
import { Modal } from "./Modal";
import { DateInput, TimeInput } from "./DateTimeInputs";
import { CalendarSelect, DeleteButton, Row, Switch } from "./fields";

export function EventEditor({ event, isNew, isOccurrence }: { event: CalEvent; isNew: boolean; isOccurrence?: boolean }) {
  const calendars = useStore((s) => s.calendars);
  const { saveFromEditor, deleteFromEditor, closeEditor } = useStore.getState();
  const [rule, setRule] = useState<Rule | null>(parseRRule(event.rrule));
  const [alerts, setAlerts] = useState<number[]>(event.alerts);

  const [title, setTitle] = useState(event.title);
  const [calendarId, setCalendarId] = useState(event.calendarId);
  const [allDay, setAllDay] = useState(event.allDay);
  const [startDay, setStartDay] = useState(dayKey(event.start));
  const [startTime, setStartTime] = useState(event.allDay ? "09:00" : timeKey(event.start));
  // En todo el día el fin guardado es exclusivo; en el formulario se muestra el último día.
  const [endDay, setEndDay] = useState(dayKey(event.allDay ? addDaysZ(event.end, -1) : event.end));
  const [endTime, setEndTime] = useState(event.allDay ? "10:00" : timeKey(event.end));
  const [location, setLocation] = useState(event.location);
  const [notes, setNotes] = useState(event.notes);
  const [armed, setArmed] = useState(false);
  const isException = event.seriesId != null;
  const readonlyCloud = useCloud((s) => s.readonlyIds.has(event.seriesId ?? event.id));

  const start = allDay ? combine(startDay, "00:00") : combine(startDay, startTime);
  const end = allDay ? addDaysZ(combine(endDay, "00:00"), 1) : combine(endDay, endTime);
  const invalid = !startDay || !endDay || Number.isNaN(start) || Number.isNaN(end) || end <= start;

  // Como en Apple: al mover el inicio, el fin se desplaza para mantener la duración.
  const moveStart = (day: string, time: string) => {
    const oldStart = allDay ? combine(startDay, "00:00") : combine(startDay, startTime);
    const newStart = allDay ? combine(day, "00:00") : combine(day, time);
    if (!Number.isNaN(newStart) && !Number.isNaN(oldStart) && !Number.isNaN(end)) {
      const newEnd = allDay ? newStart + (end - oldStart) - 1 : newStart + (end - oldStart);
      setEndDay(dayKey(newEnd));
      if (!allDay) setEndTime(timeKey(newEnd));
    }
    if (rule && !Number.isNaN(newStart) && !Number.isNaN(oldStart)) {
      const shifted = parseRRule(shiftWeekday({ ...event, rrule: formatRRule(rule, allDay) }, oldStart, newStart));
      if (shifted) setRule(shifted);
    }
    setStartDay(day);
    setStartTime(time);
  };

  const draft = (): CalEvent => ({
    ...event,
    title: title.trim() || "Nuevo evento",
    calendarId,
    allDay,
    start: allDay ? startOfDayZ(start) : start,
    end,
    location: location.trim(),
    notes,
    alerts,
    rrule: rule ? formatRRule(rule, allDay) : null,
  });
  const [savedTemplate, setSavedTemplate] = useState(false);
  const saveAsTemplate = () => {
    const { templates, saveTemplates } = useStore.getState();
    const t = templateFromEvent(draft(), newId);
    void saveTemplates([...templates.filter((x) => x.name !== t.name), t]);
    setSavedTemplate(true);
  };

  const submit = () => {
    if (invalid) return;
    void saveFromEditor({
      ...event,
      title: title.trim() || "Nuevo evento",
      calendarId,
      allDay,
      start: allDay ? startOfDayZ(start) : start,
      end,
      location: location.trim(),
      notes,
      alerts,
      rrule: rule ? formatRRule(rule, allDay) : null,
    });
  };

  return (
    <Modal onClose={closeEditor} title={isNew ? "Nuevo evento" : "Editar evento"} width={500}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
          if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey) && !invalid) {
            e.preventDefault();
            useStore.getState().duplicateDraft(draft());
          }
        }}
      >
        <input className="f-title" autoFocus placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} />
        {readonlyCloud && (
          <div className="f-note">🔒 Es una invitación o usa una repetición que Agenda no sabe editar: los cambios se quedan en este PC y no se envían a iCloud. Cámbialo desde el iPhone.</div>
        )}
        <div className="f-group">
          <Row label="Calendario">
            <CalendarSelect calendars={calendars} value={calendarId} onChange={setCalendarId} />
          </Row>
          <Row label="Todo el día">
            <Switch checked={allDay} onChange={setAllDay} label="Todo el día" />
          </Row>
          <Row label="Empieza">
            <DateInput label="Fecha" value={startDay} onChange={(v) => moveStart(v, startTime)} />
            {!allDay && <TimeInput label="Hora" value={startTime} onChange={(v) => moveStart(startDay, v)} />}
          </Row>
          <Row label="Termina">
            <DateInput label="Fecha" value={endDay} onChange={(v) => setEndDay(v)} />
            {!allDay && <TimeInput label="Hora" value={endTime} onChange={(v) => setEndTime(v)} />}
          </Row>
          {invalid && <div className="f-error">El final tiene que ser posterior al inicio.</div>}
        </div>
        <div className="f-group">
          {isException ? (
            <div className="f-note">Es un cambio puntual de un evento que se repite.</div>
          ) : (
            <RepeatEditor rule={rule} start={start} onChange={setRule} />
          )}
          <AlertsEditor alerts={alerts} allDay={allDay} onChange={setAlerts} />
        </div>
        <div className="f-group">
          <input className="f-plain" placeholder="Ubicación" value={location} onChange={(e) => setLocation(e.target.value)} />
          <textarea className="f-plain" placeholder="Notas" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="f-subactions">
          {!isNew && (
            <button type="button" className="link-btn" disabled={invalid} onClick={() => useStore.getState().duplicateDraft(draft())} title="Duplicar (Ctrl+D)">
              Duplicar
            </button>
          )}
          <button type="button" className="link-btn" disabled={invalid} onClick={saveAsTemplate} title="Para crear otros iguales desde el menú +">
            {savedTemplate ? "Plantilla guardada ✓" : "Guardar como plantilla"}
          </button>
        </div>
        <div className="f-actions">
          {!isNew &&
            (isOccurrence ? (
              <button type="button" className="btn danger" onClick={() => void deleteFromEditor()}>Eliminar evento</button>
            ) : (
              <DeleteButton label="Eliminar evento" armed={armed} onArm={() => setArmed(true)} onConfirm={() => void deleteFromEditor()} />
            ))}
          <span className="spacer" />
          <button type="button" className="btn" onClick={closeEditor}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={invalid}>{isNew ? "Añadir" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
