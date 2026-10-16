import { useMemo, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { newId } from "../lib/backend";
import { parseQuickAdd, isPast, type QuickResult } from "../lib/nlp";
import { capitalize, fmt, hm, addDaysZ, isSameDayZ } from "../lib/dates";
import { describeRule, parseRRule } from "../lib/rrule";
import { priorityMarks } from "../lib/format";
import type { CalEvent, Task } from "../lib/types";
import { Modal } from "./Modal";

const EXAMPLES = ["Entrega práctica fabricación viernes 23:59 #uni", "Grabación villa martes 10-13 #trabajo", "Cálculo cada lunes y miércoles 9-11 #uni", "Pagar alquiler el 1 !!"];

function whenText(r: QuickResult): string {
  if (r.kind === "task") {
    if (r.due == null) return "Sin fecha";
    return capitalize(fmt(r.due, "EEEE d 'de' MMMM")) + (r.dueHasTime ? `, ${hm(r.due)}` : "");
  }
  if (r.start == null || r.end == null) return "";
  if (r.allDay) return `${capitalize(fmt(r.start, "EEEE d 'de' MMMM"))} · todo el día`;
  const sameDay = isSameDayZ(r.start, r.end) || r.end === addDaysZ(r.start, 1);
  return `${capitalize(fmt(r.start, "EEEE d 'de' MMMM"))}, ${hm(r.start)} – ${sameDay ? "" : fmt(r.end, "EEE d ")}${hm(r.end)}`;
}

/** "Añadir rápido": una línea en lenguaje natural con vista previa de lo que se va a crear. */
export function QuickAdd() {
  const calendars = useStore((s) => s.calendars);
  const { openQuickAdd, saveEvent, saveTask, setCursor } = useStore.getState();
  const [text, setText] = useState("");
  const [forced, setForced] = useState<"event" | "task" | null>(null);
  const [hint] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);

  const parsed = useMemo(() => {
    const input = forced ? `${forced === "task" ? "tarea" : "evento"}: ${text.replace(/^(tarea|evento)\s*:\s*/i, "")}` : text;
    return parseQuickAdd(input, calendars);
  }, [text, forced, calendars]);
  const defaultCal = calendars.find((c) => c.visible) ?? calendars[0];
  const cal = calendars.find((c) => c.id === parsed.calendarId) ?? defaultCal;
  const close = () => openQuickAdd(false);

  const build = (): { event?: CalEvent; task?: Task } => {
    const now = Date.now();
    if (parsed.kind === "task")
      return {
        task: { id: newId(), calendarId: cal.id, title: parsed.title, notes: "", due: parsed.due, dueHasTime: parsed.dueHasTime, priority: parsed.priority, completedAt: null, createdAt: now, updatedAt: now },
      };
    return {
      event: {
        id: newId(), calendarId: cal.id, title: parsed.title, location: parsed.location, notes: "", allDay: parsed.allDay,
        start: parsed.start!, end: parsed.end!, rrule: parsed.rrule, exdates: [], seriesId: null, recurrenceId: null,
        alerts: parsed.allDay ? [] : [15], createdAt: now, updatedAt: now,
      },
    };
  };

  const create = async () => {
    if (!parsed.title) return;
    const { event, task } = build();
    close();
    if (event) {
      await saveEvent(event);
      setCursor(event.start);
    } else if (task) {
      await saveTask(task);
      if (task.due != null) setCursor(task.due);
    }
  };

  const moreOptions = () => {
    const { event, task } = build();
    close();
    if (event) useStore.setState({ editor: { kind: "event", isNew: true, event } });
    else if (task) useStore.setState({ editor: { kind: "task", isNew: true, task } });
  };

  const rule = parseRRule(parsed.rrule);
  return (
    <Modal onClose={close} width={560}>
      <div className="quick">
        <input
          className="quick-input"
          autoFocus
          placeholder={`Ej.: ${hint}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (e.ctrlKey || e.metaKey) moreOptions();
              else void create();
            }
          }}
          aria-label="Añadir rápido"
        />
        {text.trim() ? (
          <div className="quick-preview" style={{ "--c": cal?.color } as CSSProperties}>
            <div className="quick-kind segmented small">
              <button className={parsed.kind === "event" ? "is-active" : ""} onClick={() => setForced("event")}>Evento</button>
              <button className={parsed.kind === "task" ? "is-active" : ""} onClick={() => setForced("task")}>Tarea</button>
            </div>
            <div className="quick-title">
              {parsed.kind === "task" ? <span className="check" /> : <span className="quick-bar" />}
              <span>{parsed.title || <em className="f-muted">Sin título</em>}</span>
              {parsed.priority > 0 && <span className="prio">{priorityMarks(parsed.priority)}</span>}
            </div>
            <div className="quick-meta">
              <span>🗓 {whenText(parsed)}</span>
              {rule && parsed.start != null && <span>🔁 {describeRule(rule, parsed.start)}</span>}
              {parsed.location && <span>📍 {parsed.location}</span>}
              <span><span className="dot" /> {cal?.name}{!parsed.calendarId && " (por defecto)"}</span>
            </div>
            {isPast(parsed) && <div className="f-error">Ojo: esa fecha ya ha pasado.</div>}
          </div>
        ) : (
          <div className="quick-help">
            <div><b>#uni</b> calendario · <b>@lugar</b> ubicación · <b>!</b> <b>!!</b> <b>!!!</b> prioridad</div>
            <div>Fechas: hoy, mañana, viernes, el 23, 23/10, 5 nov · Horas: 10:00, a las 9, 10-13, de 10 a 13</div>
            <div>Repetir: cada lunes y miércoles, todos los martes, cada día, cada 2 semanas … hasta el 20/12</div>
            <div>Las frases que empiezan por «Entrega», «Pagar», «Llamar»… o con «!» se crean como tarea.</div>
          </div>
        )}
        <div className="f-actions">
          <span className="f-muted quick-keys">Intro: crear · Ctrl+Intro: más opciones · Esc: cerrar</span>
          <span className="spacer" />
          <button className="btn" onClick={moreOptions} disabled={!text.trim()}>Más opciones</button>
          <button className="btn primary" onClick={() => void create()} disabled={!parsed.title}>Crear</button>
        </div>
      </div>
    </Modal>
  );
}
