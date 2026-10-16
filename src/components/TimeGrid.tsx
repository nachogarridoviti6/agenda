import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { useStore } from "../store";
import { useCalendarMap, useNow } from "../hooks";
import { addDaysZ, atMinutes, dayKey, fmt, hm, isSameDayZ, minutesIntoDay } from "../lib/dates";
import { expandEvents, tasksByDay } from "../lib/occurrences";
import { isAllDayLike, layoutDay, layoutSpans } from "../lib/layout";
import type { Occurrence, Task } from "../lib/types";
import { occurrenceTimeLabel } from "../lib/format";

const HOUR = 48; // px por hora
const SNAP = 15; // minutos
const snap = (m: number) => Math.max(0, Math.min(1440, Math.round(m / SNAP) * SNAP));

type Drag =
  | { mode: "create"; day: number; from: number; to: number }
  | { mode: "move"; occ: Occurrence; grab: number; day: number; startMin: number; moved: boolean; x0: number; y0: number }
  | { mode: "resize"; occ: Occurrence; day: number; endMin: number };

/** Rejilla horaria de N días (7 en la vista semana, 1 en la vista día). */
export function TimeGrid({ days }: { days: number[] }) {
  const events = useStore((s) => s.events);
  const tasks = useStore((s) => s.tasks);
  const { openEvent, openNewEvent, openTask, toggleTask, saveEvent, setCursor, setView } = useStore.getState();
  const calMap = useCalendarMap();
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const rangeEnd = addDaysZ(days[days.length - 1], 1);
  const occs = useMemo(
    () => expandEvents(events, days[0], rangeEnd).filter((o) => calMap.get(o.event.calendarId)?.visible),
    [events, days, rangeEnd, calMap],
  );
  const spans = useMemo(() => layoutSpans(occs, days), [occs, days]);
  const timed = useMemo(() => occs.filter((o) => !isAllDayLike(o)), [occs]);
  const perDay = useMemo(() => days.map((d) => layoutDay(timed, d)), [timed, days]);
  const taskMap = useMemo(() => tasksByDay(tasks.filter((t) => calMap.get(t.calendarId)?.visible)), [tasks, calMap]);
  const todayIdx = days.findIndex((d) => isSameDayZ(d, now));

  // Al abrir, desplaza hasta la hora actual (o a las 7:00).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = todayIdx >= 0 ? (minutesIntoDay(now, days[todayIdx]) / 60 - 2) * HOUR : 7 * HOUR;
    el.scrollTop = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKey(days[0])]);

  const pointerAt = (clientX: number, clientY: number) => {
    const r = colsRef.current!.getBoundingClientRect();
    const day = Math.max(0, Math.min(days.length - 1, Math.floor(((clientX - r.left) / r.width) * days.length)));
    const min = ((clientY - r.top) / HOUR) * 60;
    return { day, min };
  };

  // Seguimiento del arrastre con listeners globales.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const { day, min } = pointerAt(e.clientX, e.clientY);
      setDrag((d) => {
        if (!d) return d;
        if (d.mode === "create") return { ...d, to: snap(min) };
        if (d.mode === "resize") return { ...d, endMin: Math.max(snap(min), minutesIntoDay(d.occ.start, days[d.day]) + SNAP) };
        const moved = d.moved || Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 4;
        const dur = (d.occ.end - d.occ.start) / 60_000;
        return { ...d, moved, day, startMin: Math.max(0, Math.min(1440 - Math.min(dur, 1440), snap(min - d.grab))) };
      });
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.mode === "create") {
        const a = Math.min(d.from, d.to);
        const b = Math.max(d.from, d.to);
        if (b - a >= SNAP) openNewEvent({ start: atMinutes(days[d.day], a), end: atMinutes(days[d.day], b) });
      } else if (d.mode === "move") {
        if (!d.moved) openEvent(d.occ);
        else {
          const start = atMinutes(days[d.day], d.startMin);
          const dur = d.occ.end - d.occ.start;
          if (start !== d.occ.start) void saveEvent({ ...d.occ.event, start, end: start + dur });
        }
      } else {
        const end = atMinutes(days[d.day], d.endMin);
        if (end !== d.occ.end) void saveEvent({ ...d.occ.event, end });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, days]);

  const onColumnDown = (e: RPointerEvent) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const { day, min } = pointerAt(e.clientX, e.clientY);
    const m = Math.floor(min / SNAP) * SNAP;
    setDrag({ mode: "create", day, from: m, to: m });
  };
  const onColumnDouble = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const { day, min } = pointerAt(e.clientX, e.clientY);
    const m = Math.floor(min / 30) * 30;
    openNewEvent({ start: atMinutes(days[day], m) });
  };
  const onEventDown = (e: RPointerEvent, occ: Occurrence, dayIdx: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const { min } = pointerAt(e.clientX, e.clientY);
    const startMin = occ.start < days[dayIdx] ? 0 : minutesIntoDay(occ.start, days[dayIdx]);
    // Los eventos que cruzan la medianoche se abren con un clic pero no se arrastran desde el día siguiente.
    if (occ.start < days[dayIdx]) return void openEvent(occ);
    setDrag({ mode: "move", occ, grab: min - startMin, day: dayIdx, startMin, moved: false, x0: e.clientX, y0: e.clientY });
  };
  const onResizeDown = (e: RPointerEvent, occ: Occurrence, dayIdx: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setDrag({ mode: "resize", occ, day: dayIdx, endMin: minutesIntoDay(occ.end, days[dayIdx]) });
  };

  const gotoDay = (d: number) => {
    setCursor(d);
    if (days.length > 1) setView("week");
  };

  const cols = `56px repeat(${days.length}, minmax(0, 1fr))`;
  const maxTasks = Math.max(0, ...days.map((d) => taskMap.get(dayKey(d))?.length ?? 0));
  const hasAllDay = spans.lanes > 0 || maxTasks > 0;

  return (
    <div className="timegrid">
      <div className="tg-head" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((d, i) => (
          <div key={d} className={`tg-dayhead ${i === todayIdx ? "is-today" : ""}`} onClick={() => gotoDay(d)}>
            <span className="tg-wd">{fmt(d, "EEE")}</span>
            <span className="tg-num">{fmt(d, "d")}</span>
          </div>
        ))}
      </div>

      <div className={`tg-allday ${hasAllDay ? "" : "is-empty"}`} style={{ gridTemplateColumns: cols }}>
        <div className="tg-allday-label">todo el día</div>
        <div className="tg-allday-body" style={{ gridColumn: `2 / span ${days.length}` }}>
          {days.map((d, i) => (
            <div
              key={d}
              className="tg-allday-cell"
              style={{ left: `${(i / days.length) * 100}%`, width: `${100 / days.length}%` }}
              onDoubleClick={() => openNewEvent({ start: d, allDay: true })}
            />
          ))}
          <div className="tg-bars" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {spans.bars.map((b) => {
              const cal = calMap.get(b.occ.event.calendarId);
              return (
                <div
                  key={b.occ.key}
                  className={`bar tint ${b.clippedStart ? "clip-l" : ""} ${b.clippedEnd ? "clip-r" : ""}`}
                  style={{ "--c": cal?.color, gridColumn: `${b.startCol + 1} / ${b.endCol + 2}`, gridRow: b.lane + 1 } as CSSProperties}
                  onClick={() => openEvent(b.occ)}
                  title={`${b.occ.event.title} · ${occurrenceTimeLabel(b.occ)}`}
                >
                  {b.occ.event.title || "Nuevo evento"}
                </div>
              );
            })}
          </div>
          <div className="tg-tasks" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d) => (
              <div key={d} className="tg-taskcell">
                {(taskMap.get(dayKey(d)) ?? []).map((t) => (
                  <TaskChip key={t.id} task={t} color={calMap.get(t.calendarId)?.color} onOpen={() => openTask(t)} onToggle={() => toggleTask(t)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="tg-scroll" ref={scrollRef}>
        <div className="tg-body" style={{ gridTemplateColumns: cols, height: 24 * HOUR }}>
          <div className="tg-gutter">
            {Array.from({ length: 23 }, (_, h) => (
              <div key={h} className="tg-hour" style={{ top: (h + 1) * HOUR }}>
                {h + 1}:00
              </div>
            ))}
            {todayIdx >= 0 && (
              <div className="tg-now-label" style={{ top: (minutesIntoDay(now, days[todayIdx]) / 60) * HOUR }}>
                {hm(now)}
              </div>
            )}
          </div>
          <div className="tg-cols" ref={colsRef} style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d, i) => {
              const wd = Number(fmt(d, "i"));
              return (
                <div
                  key={d}
                  className={`tg-col ${wd >= 6 ? "is-weekend" : ""}`}
                  onPointerDown={onColumnDown}
                  onDoubleClick={onColumnDouble}
                >
                  {perDay[i].map((p) => {
                    const hidden = drag && drag.mode !== "create" && drag.occ.key === p.occ.key && (drag.mode === "resize" || drag.moved);
                    return (
                      <EventBlock
                        key={p.occ.key}
                        occ={p.occ}
                        color={calMap.get(p.occ.event.calendarId)?.color}
                        top={p.top}
                        height={p.height}
                        left={p.col / p.cols}
                        width={1 / p.cols}
                        faded={!!hidden}
                        onPointerDown={(e) => onEventDown(e, p.occ, i)}
                        onResizeDown={(e) => onResizeDown(e, p.occ, i)}
                      />
                    );
                  })}
                  {i === todayIdx && <div className="tg-now" style={{ top: (minutesIntoDay(now, d) / 60) * HOUR }} />}
                  {drag && <DragPreview drag={drag} dayIdx={i} days={days} color={drag.mode === "create" ? undefined : calMap.get(drag.occ.event.calendarId)?.color} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventBlock(props: {
  occ: Occurrence;
  color?: string;
  top: number;
  height: number;
  left: number;
  width: number;
  faded?: boolean;
  onPointerDown(e: RPointerEvent): void;
  onResizeDown(e: RPointerEvent): void;
}) {
  const { occ, color, top, height, left, width } = props;
  const px = (height / 60) * HOUR;
  const compact = px < 34;
  return (
    <div
      className={`ev tint ${compact ? "is-compact" : ""} ${props.faded ? "is-faded" : ""}`}
      style={
        {
          "--c": color,
          top: (top / 60) * HOUR,
          height: Math.max(px - 1, 14),
          left: `calc(${left * 100}% + 1px)`,
          width: `calc(${width * 100}% - 3px)`,
        } as CSSProperties
      }
      onPointerDown={props.onPointerDown}
      title={`${occ.event.title}\n${occurrenceTimeLabel(occ)}${occ.event.location ? `\n${occ.event.location}` : ""}`}
    >
      <div className="ev-title">
        {occ.event.title || "Nuevo evento"}
        {compact && <span className="ev-time-inline"> {hm(occ.start)}</span>}
      </div>
      {!compact && <div className="ev-time">{hm(occ.start)} – {hm(occ.end)}</div>}
      {!compact && px > 60 && occ.event.location && <div className="ev-loc">{occ.event.location}</div>}
      <div className="ev-resize" onPointerDown={props.onResizeDown} />
    </div>
  );
}

function DragPreview({ drag, dayIdx, days, color }: { drag: Drag; dayIdx: number; days: number[]; color?: string }) {
  if (drag.day !== dayIdx) return null;
  let a: number, b: number, title: string;
  if (drag.mode === "create") {
    a = Math.min(drag.from, drag.to);
    b = Math.max(drag.from, drag.to);
    if (b - a < SNAP) return null;
    title = "Nuevo evento";
  } else if (drag.mode === "move") {
    if (!drag.moved) return null;
    a = drag.startMin;
    b = a + (drag.occ.end - drag.occ.start) / 60_000;
    title = drag.occ.event.title;
  } else {
    a = minutesIntoDay(drag.occ.start, days[dayIdx]);
    b = drag.endMin;
    title = drag.occ.event.title;
  }
  const d = days[dayIdx];
  return (
    <div
      className="ev tint is-preview"
      style={{ "--c": color ?? "var(--accent)", top: (a / 60) * HOUR, height: ((b - a) / 60) * HOUR - 1, left: 1, width: "calc(100% - 3px)" } as CSSProperties}
    >
      <div className="ev-title">{title || "Nuevo evento"}</div>
      <div className="ev-time">
        {hm(atMinutes(d, a))} – {hm(atMinutes(d, Math.min(b, 1440)))}
      </div>
    </div>
  );
}

export function TaskChip({ task, color, onOpen, onToggle }: { task: Task; color?: string; onOpen(): void; onToggle(): void }) {
  return (
    <div className="taskchip" style={{ "--c": color } as CSSProperties} onClick={onOpen} title={task.title}>
      <input
        type="checkbox"
        className="check"
        checked={task.completedAt != null}
        onClick={(e) => e.stopPropagation()}
        onChange={onToggle}
        aria-label="Completada"
      />
      <span className={`taskchip-title ${task.completedAt ? "done" : ""}`}>
        {task.dueHasTime && task.due != null && <span className="taskchip-time">{hm(task.due)} </span>}
        {task.title}
      </span>
    </div>
  );
}
