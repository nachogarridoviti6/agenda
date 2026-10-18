import { useMemo, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { useCalendarMap } from "../hooks";
import { MiniMonth } from "./MiniMonth";
import { Cloud, Gear, Pencil, Plus } from "./icons";
import { useCloud } from "../cloud";
import { dayDiff, fmt } from "../lib/dates";
import type { Task } from "../lib/types";
import { compareTasks } from "../lib/occurrences";
import { isOverdue, priorityMarks, taskDueLabel } from "../lib/format";

/** Atrasadas · Hoy · Próximas · Sin fecha · Hechas (como en Recordatorios). */
function groupTasks(list: Task[]): [string, Task[]][] {
  const now = Date.now();
  const groups: Record<string, Task[]> = { Atrasadas: [], Hoy: [], Próximas: [], "Sin fecha": [], Hechas: [] };
  for (const t of list) {
    if (t.completedAt != null) groups.Hechas.push(t);
    else if (t.due == null) groups["Sin fecha"].push(t);
    else if (isOverdue(t, now)) groups.Atrasadas.push(t);
    else if (dayDiff(t.due, now) === 0) groups.Hoy.push(t);
    else groups.Próximas.push(t);
  }
  return Object.entries(groups).filter(([, v]) => v.length > 0);
}

export function Sidebar({ onSettings }: { onSettings(): void }) {
  const calendars = useStore((s) => s.calendars);
  const tasks = useStore((s) => s.tasks);
  const { toggleCalendar, openCalendar, openNewCalendar, openTask, openNewTask, toggleTask } = useStore.getState();
  const calMap = useCalendarMap();
  const [showDone, setShowDone] = useState(false);
  const { account, syncing, lastSync, error, linkedIds } = useCloud();

  const list = useMemo(
    () =>
      tasks
        .filter((t) => calMap.get(t.calendarId)?.visible && (showDone || t.completedAt == null))
        .sort(compareTasks),
    [tasks, calMap, showDone],
  );

  return (
    <aside className="sidebar">
      <MiniMonth />

      <section className="side-section">
        <div className="side-heading">
          <span>Calendarios</span>
          <button className="icon-btn sm" onClick={openNewCalendar} aria-label="Nuevo calendario" title="Nuevo calendario">
            <Plus width={13} height={13} />
          </button>
        </div>
        {calendars.map((c) => (
          <div key={c.id} className="cal-row" style={{ "--c": c.color } as CSSProperties}>
            <label className="cal-label">
              <input type="checkbox" className="check square" checked={c.visible} onChange={() => toggleCalendar(c)} />
              <span>{c.name}</span>
            </label>
            {linkedIds.has(c.id) && (
              <span className="cloud-badge" title="Se sincroniza con iCloud">
                <Cloud width={13} height={13} />
              </span>
            )}
            <button className="icon-btn sm cal-edit" onClick={() => openCalendar(c)} aria-label={`Editar ${c.name}`}>
              <Pencil width={12} height={12} />
            </button>
          </div>
        ))}
      </section>

      <section className="side-section side-tasks">
        <div className="side-heading">
          <span>Tareas</span>
          <button className="link-btn" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Ocultar hechas" : "Ver hechas"}
          </button>
          <button className="icon-btn sm" onClick={() => openNewTask({ due: null })} aria-label="Nueva tarea" title="Nueva tarea">
            <Plus width={13} height={13} />
          </button>
        </div>
        <div className="task-list">
          {list.length === 0 && <div className="empty">Nada pendiente 🎉</div>}
          {groupTasks(list).map(([label, items]) => (
            <div key={label}>
              <div className={`task-group ${label === "Atrasadas" ? "is-overdue" : ""}`}>{label}</div>
              {items.map((t) => (
            <div key={t.id} className="task-row" style={{ "--c": calMap.get(t.calendarId)?.color } as CSSProperties} onClick={() => openTask(t)} title="Pulsa para editar">
              <input
                type="checkbox"
                className="check"
                checked={t.completedAt != null}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleTask(t)}
                aria-label="Completada"
              />
              <div className="task-main">
                <div className={`task-title ${t.completedAt ? "done" : ""}`}>
                  {t.priority > 0 && <span className="prio">{priorityMarks(t.priority)} </span>}
                  {t.title}
                </div>
                {t.due != null && (
                  <div className={`task-due ${isOverdue(t) ? "is-overdue" : ""}`}>
                    {taskDueLabel(t)}
                    {t.rrule && <span title="Se repite"> · ↻</span>}
                  </div>
                )}
              </div>
              <button className="icon-btn sm task-edit" aria-label={`Editar ${t.title}`} onClick={(e) => (e.stopPropagation(), openTask(t))}>
                <Pencil width={12} height={12} />
              </button>
            </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="side-foot">
        <button className="icon-btn" onClick={onSettings} aria-label="Ajustes" title="Ajustes">
          <Gear />
        </button>
        {account && (
          <button
            className={`sync-status ${error ? "is-error" : ""}`}
            onClick={() => void useCloud.getState().sync()}
            title={error ?? "Sincronizar con iCloud ahora"}
          >
            <Cloud width={13} height={13} />
            {syncing
              ? "Sincronizando…"
              : error
                ? "Error al sincronizar"
                : linkedIds.size === 0
                  ? "iCloud · sin calendarios enlazados"
                  : lastSync
                    ? `iCloud · ${fmt(lastSync, "H:mm")}`
                    : "iCloud"}
          </button>
        )}
      </div>
    </aside>
  );
}
