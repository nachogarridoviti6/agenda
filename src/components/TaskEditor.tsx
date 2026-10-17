import { useState } from "react";
import { useStore } from "../store";
import type { Priority, Task } from "../lib/types";
import { combine, dayKey, startOfDayZ, timeKey } from "../lib/dates";
import { Modal } from "./Modal";
import { DateInput, TimeInput } from "./DateTimeInputs";
import { RepeatEditor } from "./RepeatEditor";
import { formatRRule, parseRRule, type Rule } from "../lib/rrule";
import { snooze } from "../lib/tasks";
import { CalendarSelect, DeleteButton, Row, Switch } from "./fields";

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 0, label: "Ninguna" },
  { value: 1, label: "Baja" },
  { value: 2, label: "Media" },
  { value: 3, label: "Alta" },
];

export function TaskEditor({ task, isNew }: { task: Task; isNew: boolean }) {
  const calendars = useStore((s) => s.calendars);
  const cursor = useStore((s) => s.cursor);
  const { saveTask, deleteTask, closeEditor } = useStore.getState();

  const [title, setTitle] = useState(task.title);
  const [calendarId, setCalendarId] = useState(task.calendarId);
  const [hasDate, setHasDate] = useState(task.due != null);
  const [day, setDay] = useState(dayKey(task.due ?? cursor));
  const [hasTime, setHasTime] = useState(task.dueHasTime);
  const [time, setTime] = useState(task.dueHasTime && task.due != null ? timeKey(task.due) : "23:59");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [notes, setNotes] = useState(task.notes);
  const [done, setDone] = useState(task.completedAt != null);
  const [armed, setArmed] = useState(false);
  const [rule, setRule] = useState<Rule | null>(parseRRule(task.rrule));

  const due = hasDate ? (hasTime ? combine(day, time) : startOfDayZ(combine(day, "12:00"))) : null;
  const invalid = !title.trim() || (due != null && Number.isNaN(due));

  const submit = () => {
    if (invalid) return;
    void saveTask({
      ...task,
      title: title.trim(),
      calendarId,
      due,
      dueHasTime: hasDate && hasTime,
      priority,
      notes,
      completedAt: done ? (task.completedAt ?? Date.now()) : null,
      rrule: hasDate && rule ? formatRRule(rule, !(hasDate && hasTime)) : null,
    });
  };

  return (
    <Modal onClose={closeEditor} title={isNew ? "Nueva tarea" : "Editar tarea"}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input className="f-title" autoFocus placeholder="¿Qué hay que hacer?" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="f-group">
          <Row label="Calendario">
            <CalendarSelect calendars={calendars} value={calendarId} onChange={setCalendarId} />
          </Row>
          <Row label="Fecha límite">
            <Switch checked={hasDate} onChange={setHasDate} label="Fecha límite" />
            {hasDate && <DateInput label="Fecha" value={day} onChange={(v) => setDay(v)} />}
          </Row>
          {hasDate && (
            <Row label="Posponer a">
              <div className="segmented small">
                {([["today", "Hoy"], ["tomorrow", "Mañana"], ["nextWeek", "+1 semana"]] as const).map(([k, label]) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => {
                      const s2 = snooze({ ...task, due: due ?? Date.now(), dueHasTime: hasTime }, k, Date.now());
                      setDay(dayKey(s2.due!));
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Row>
          )}
          {hasDate && (
            <Row label="Hora">
              <Switch checked={hasTime} onChange={setHasTime} label="Hora" />
              {hasTime && <TimeInput label="Hora" value={time} onChange={(v) => setTime(v)} />}
            </Row>
          )}
          {hasDate && due != null && !Number.isNaN(due) && <RepeatEditor rule={rule} start={due} onChange={setRule} />}
          <Row label="Prioridad">
            <div className="segmented small">
              {PRIORITIES.map((p) => (
                <button type="button" key={p.value} className={priority === p.value ? "is-active" : ""} onClick={() => setPriority(p.value)}>
                  {p.label}
                </button>
              ))}
            </div>
          </Row>
          {!isNew && (
            <Row label="Completada">
              <Switch checked={done} onChange={setDone} label="Completada" />
            </Row>
          )}
        </div>
        <div className="f-group">
          <textarea className="f-plain" placeholder="Notas" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="f-actions">
          {!isNew && <DeleteButton label="Eliminar tarea" armed={armed} onArm={() => setArmed(true)} onConfirm={() => deleteTask(task.id)} />}
          <span className="spacer" />
          <button type="button" className="btn" onClick={closeEditor}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={invalid}>{isNew ? "Añadir" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
