import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { useCalendarMap, useNow, useSwipeNav } from "../hooks";
import { addDaysZ, dayKey, fmt, hm, isSameDayZ, monthGridDays } from "../lib/dates";
import { expandEvents, tasksByDay } from "../lib/occurrences";
import { occurrencesOnDay, sortOccurrences } from "../lib/layout";
import { occurrenceTimeLabel } from "../lib/format";
import { TaskChip } from "./TimeGrid";

const ROW_H = 19; // alto de cada línea de evento dentro de una celda

export function MonthView() {
  const cursor = useStore((s) => s.cursor);
  const events = useStore((s) => s.events);
  const tasks = useStore((s) => s.tasks);
  const { openEvent, openNewEvent, openTask, toggleTask, setCursor, setView, step } = useStore.getState();
  const navDir = useStore((s) => s.navDir);
  const calMap = useCalendarMap();
  const now = useNow(60_000);
  const gridRef = useRef<HTMLDivElement>(null);
  const monthRef = useRef<HTMLDivElement>(null);
  useSwipeNav(monthRef, "y", step);
  const [maxRows, setMaxRows] = useState(3);

  const days = useMemo(() => monthGridDays(cursor), [cursor]);
  const month = fmt(cursor, "M");
  const occs = useMemo(
    () => expandEvents(events, days[0], addDaysZ(days[41], 1)).filter((o) => calMap.get(o.event.calendarId)?.visible),
    [events, days, calMap],
  );
  const taskMap = useMemo(() => tasksByDay(tasks.filter((t) => calMap.get(t.calendarId)?.visible)), [tasks, calMap]);

  // Cuántas líneas caben en cada celda según el tamaño de la ventana.
  useLayoutEffect(() => {
    const root = monthRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      const el = gridRef.current;
      if (!el) return;
      const cellH = el.clientHeight / 6;
      setMaxRows(Math.max(1, Math.floor((cellH - 30) / ROW_H)));
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const goWeek = (d: number) => {
    setCursor(d);
    setView("day");
  };

  return (
    <div className="month" ref={monthRef}>
      <div className="month-head">
        {["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className={`month-grid slide-${navDir > 0 ? "up" : navDir < 0 ? "down" : "none"}`} ref={gridRef} key={month + fmt(cursor, "yyyy")}>
        {days.map((d) => {
          const dayOccs = sortOccurrences(occurrencesOnDay(occs, d));
          const dayTasks = taskMap.get(dayKey(d)) ?? [];
          const total = dayOccs.length + dayTasks.length;
          const room = total > maxRows ? maxRows - 1 : maxRows;
          const shownOccs = dayOccs.slice(0, room);
          const shownTasks = dayTasks.slice(0, Math.max(0, room - shownOccs.length));
          const hidden = total - shownOccs.length - shownTasks.length;
          const wd = Number(fmt(d, "i"));
          return (
            <div
              key={d}
              className={`month-cell ${fmt(d, "M") !== month ? "is-other" : ""} ${wd >= 6 ? "is-weekend" : ""}`}
              onDoubleClick={(e) => e.target === e.currentTarget && openNewEvent({ start: d, allDay: true })}
            >
              <div className="month-daynum-row">
                <button className={`month-daynum ${isSameDayZ(d, now) ? "is-today" : ""}`} onClick={() => goWeek(d)}>
                  {fmt(d, "d") === "1" ? fmt(d, "d MMM") : fmt(d, "d")}
                </button>
              </div>
              {shownOccs.map((o) => {
                const color = calMap.get(o.event.calendarId)?.color;
                const filled = o.event.allDay || o.end - o.start >= 86_400_000;
                return (
                  <div
                    key={o.key}
                    className={`mitem tint ${filled ? "is-filled" : ""}`}
                    style={{ "--c": color } as CSSProperties}
                    onClick={() => openEvent(o)}
                    title={`${o.event.title} · ${occurrenceTimeLabel(o)}`}
                  >
                    {!filled && <span className="dot" />}
                    <span className="mitem-title">{o.event.title || "Nuevo evento"}</span>
                    {!filled && <span className="mitem-time">{o.start < d ? "" : hm(o.start)}</span>}
                  </div>
                );
              })}
              {shownTasks.map((t) => (
                <TaskChip key={t.id} task={t} color={calMap.get(t.calendarId)?.color} onOpen={() => openTask(t)} onToggle={() => toggleTask(t)} />
              ))}
              {hidden > 0 && (
                <button className="month-more" onClick={() => goWeek(d)}>
                  {hidden} más
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
