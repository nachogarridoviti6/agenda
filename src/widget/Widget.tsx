import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { backend } from "../lib/backend";
import { DEFAULT_WIDGET } from "../lib/defaults";
import { addDaysZ, fmt, hm, startOfWeekZ } from "../lib/dates";
import { buildWidgetWeek, shortDue, type WidgetDay } from "../lib/widget";
import { isOverdue } from "../lib/format";
import type { CalEvent, Calendar, Occurrence, Task, WidgetConfig } from "../lib/types";

/** Cuánto tiempo sigue visible (tachada) una tarea recién completada. */
const KEEP_DONE_MS = 1500;

export function Widget() {
  const [config, setConfig] = useState<WidgetConfig>(DEFAULT_WIDGET);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [now, setNow] = useState(Date.now());
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const weekStart = startOfWeekZ(now);

  const load = useCallback(
    async (kind?: string) => {
      if (!kind || kind === "settings") setConfig(await backend.getWidgetConfig());
      if (!kind || kind === "calendars") setCalendars(await backend.listCalendars());
      if (!kind || kind === "events" || kind === "calendars") setEvents(await backend.listEvents(weekStart, addDaysZ(weekStart, 7)));
      if (!kind || kind === "tasks" || kind === "calendars") setTasks(await backend.listTasks());
    },
    [weekStart],
  );

  // Carga inicial y actualización instantánea cuando la app principal cambia algo.
  useEffect(() => {
    void load();
    const off = backend.onChange((kind) => void load(kind));
    return () => void off.then((f) => f());
  }, [load]);

  // Reloj: refresca "hoy" y cambia de semana el lunes a medianoche.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (config.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", config.theme);
  }, [config.theme]);

  const week = useMemo(() => buildWidgetWeek(calendars, events, tasks, now, keep), [calendars, events, tasks, now, keep]);
  const colorOf = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);

  const toggle = async (t: Task) => {
    const done = t.completedAt == null;
    const updated = { ...t, completedAt: done ? Date.now() : null, updatedAt: Date.now() };
    setTasks((ts) => ts.map((x) => (x.id === t.id ? updated : x)));
    if (done) {
      setKeep((k) => new Set(k).add(t.id));
      setTimeout(() => setKeep((k) => {
        const n = new Set(k);
        n.delete(t.id);
        return n;
      }), KEEP_DONE_MS);
    }
    await backend.saveTask(updated);
  };

  const open = (day?: number) => void backend.openMain(day);

  return (
    <div
      className={`widget-root ${config.locked ? "is-locked" : "is-unlocked"} ${config.acrylic ? "has-acrylic" : ""}`}
      style={{ "--w-alpha": config.opacity } as CSSProperties}
    >
      <header className="w-head" data-tauri-drag-region={config.locked ? undefined : true} onDoubleClick={() => open(Date.now())}>
        <span className="w-title" data-tauri-drag-region={config.locked ? undefined : true}>
          {week.title}
        </span>
        <span className="w-range" data-tauri-drag-region={config.locked ? undefined : true}>
          {week.range}
        </span>
        <span className="w-spacer" data-tauri-drag-region={config.locked ? undefined : true} />
        {!config.locked && <span className="w-hint" data-tauri-drag-region>Arrastra para mover · bloquéalo en Ajustes</span>}
      </header>

      <div className="w-body">
        <div className="w-week">
          {week.days.map((d) => (
            <DayColumn key={d.day} day={d} colorOf={colorOf} onOpen={open} />
          ))}
        </div>

        <aside className="w-tasks">
          <div className="w-tasks-head">
            Tareas <span className="w-count">{week.tasks.filter((t) => t.completedAt == null).length}</span>
          </div>
          <div className="w-task-list">
            {week.tasks.length === 0 && <div className="w-empty">Todo hecho esta semana ✓</div>}
            {week.tasks.map((t) => (
              <label key={t.id} className="w-task" style={{ "--c": colorOf.get(t.calendarId) } as CSSProperties} onDoubleClick={() => open(t.due ?? undefined)}>
                <input type="checkbox" className="check" checked={t.completedAt != null} onChange={() => void toggle(t)} />
                <span className="w-task-main">
                  <span className={`w-task-title ${t.completedAt ? "done" : ""}`}>{t.title}</span>
                  <span className={`w-task-due ${isOverdue(t, now) ? "is-overdue" : ""}`}>{shortDue(t, now)}</span>
                </span>
              </label>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function DayColumn({ day, colorOf, onOpen }: { day: WidgetDay; colorOf: Map<string, string>; onOpen(day: number): void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);

  // Cuenta los eventos que no caben para enseñar "+N".
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      const limit = el.clientHeight;
      let n = 0;
      for (const child of Array.from(el.children) as HTMLElement[]) {
        const over = child.offsetTop + child.offsetHeight > limit + 1;
        child.style.visibility = over ? "hidden" : "";
        if (over) n++;
      }
      setHidden(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [day.items]);

  return (
    <div className={`w-day ${day.isToday ? "is-today" : ""} ${day.isPast ? "is-past" : ""}`} onDoubleClick={() => onOpen(day.day)}>
      <div className="w-dayhead">
        <span className="w-wd">{fmt(day.day, "EEE")}</span>
        <span className="w-num">{fmt(day.day, "d")}</span>
      </div>
      <div className="w-items" ref={listRef}>
        {day.items.map((o) => (
          <Item key={o.key} occ={o} day={day.day} color={colorOf.get(o.event.calendarId)} onOpen={onOpen} />
        ))}
      </div>
      {hidden > 0 && <div className="w-more">+{hidden} más</div>}
    </div>
  );
}

function Item({ occ, day, color, onOpen }: { occ: Occurrence; day: number; color?: string; onOpen(day: number): void }) {
  const filled = occ.event.allDay || occ.end - occ.start >= 86_400_000;
  return (
    <div
      className={`w-item tint ${filled ? "is-filled" : ""}`}
      style={{ "--c": color } as CSSProperties}
      title={`${occ.event.title}${filled ? "" : ` · ${hm(occ.start)}–${hm(occ.end)}`}${occ.event.location ? ` · ${occ.event.location}` : ""}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpen(day);
      }}
    >
      {!filled && <span className="w-time">{occ.start < day ? "↳" : hm(occ.start)}</span>}
      <span className="w-item-title">{occ.event.title || "Nuevo evento"}</span>
    </div>
  );
}
