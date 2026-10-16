import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { backend } from "../lib/backend";
import { useCalendarMap } from "../hooks";
import { search } from "../lib/search";
import { fmt, hm } from "../lib/dates";
import { taskDueLabel } from "../lib/format";
import type { CalEvent } from "../lib/types";
import { Search } from "./icons";

export function SearchBox() {
  const tasks = useStore((s) => s.tasks);
  const focusSignal = useStore((s) => s.searchFocus);
  const { openOccurrenceAt, openTask, setCursor } = useStore.getState();
  const calMap = useCalendarMap();
  const [q, setQ] = useState("");
  const [all, setAll] = useState<CalEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusSignal) inputRef.current?.focus();
  }, [focusSignal]);

  // Carga todos los eventos al empezar a buscar y cuando cambian.
  useEffect(() => {
    if (!open) return;
    void backend.listAllEvents().then(setAll);
    const off = backend.onChange((k) => (k === "events" || k === "calendars") && void backend.listAllEvents().then(setAll));
    return () => void off.then((f) => f());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !boxRef.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const hits = useMemo(() => {
    const visible = (id: string) => calMap.get(id)?.visible !== false;
    return search(all.filter((e) => visible(e.calendarId)), tasks.filter((t) => visible(t.calendarId)), q).slice(0, 30);
  }, [all, tasks, q, calMap]);
  useEffect(() => setSel(0), [q]);

  const choose = (i: number) => {
    const h = hits[i];
    if (!h) return;
    setOpen(false);
    inputRef.current?.blur();
    if (h.kind === "event") openOccurrenceAt({ key: `${h.event.id}@${h.start}`, event: h.event, start: h.start, end: h.end });
    else {
      if (h.task.due != null) setCursor(h.task.due);
      openTask(h.task);
    }
  };

  return (
    <div className="search" ref={boxRef}>
      <Search className="search-icon" width={14} height={14} />
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Buscar"
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setQ("");
            setOpen(false);
            inputRef.current?.blur();
          } else if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(s + 1, hits.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(s - 1, 0)));
          else if (e.key === "Enter") (e.preventDefault(), choose(sel));
        }}
        aria-label="Buscar eventos y tareas"
      />
      {open && q.trim() && (
        <div className="search-results" role="listbox">
          {hits.length === 0 && <div className="empty">Sin resultados</div>}
          {hits.map((h, i) => {
            const color = calMap.get(h.kind === "event" ? h.event.calendarId : h.task.calendarId)?.color;
            return (
              <button
                key={h.kind === "event" ? h.event.id : h.task.id}
                className={`search-hit ${i === sel ? "is-sel" : ""}`}
                style={{ "--c": color } as CSSProperties}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(i)}
                role="option"
                aria-selected={i === sel}
              >
                {h.kind === "event" ? <span className="dot" /> : <span className={`check ${h.task.completedAt ? "is-done" : ""}`} />}
                <span className="search-main">
                  <span className={`search-title ${h.kind === "task" && h.task.completedAt ? "done" : ""}`}>
                    {h.kind === "event" ? h.event.title : h.task.title}
                    {h.kind === "event" && h.event.rrule && <span className="f-muted"> 🔁</span>}
                  </span>
                  <span className="search-sub">
                    {h.kind === "event"
                      ? `${fmt(h.start, "EEE d MMM yyyy")}${h.event.allDay ? "" : ` · ${hm(h.start)}`}${h.event.location ? ` · ${h.event.location}` : ""}`
                      : h.task.due != null
                        ? `Tarea · ${taskDueLabel(h.task)}`
                        : "Tarea · sin fecha"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
