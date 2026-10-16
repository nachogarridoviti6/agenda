import { useMemo, type CSSProperties } from "react";
import { useStore } from "../store";
import { useCalendarMap, useNow } from "../hooks";
import { addDaysZ, addMonthsZ, capitalize, dayKey, fmt, isSameDayZ, monthGridDays, startOfYearZ } from "../lib/dates";
import { expandEvents, tasksByDay } from "../lib/occurrences";

/** Vista año: 12 meses; los días con eventos llevan un punto del color del primer calendario. */
export function YearView() {
  const cursor = useStore((s) => s.cursor);
  const events = useStore((s) => s.events);
  const tasks = useStore((s) => s.tasks);
  const { setCursor, setView } = useStore.getState();
  const calMap = useCalendarMap();
  const now = useNow(60_000);
  const year = startOfYearZ(cursor);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonthsZ(year, i)), [year]);

  const marks = useMemo(() => {
    const map = new Map<string, string[]>();
    const add = (k: string, color?: string) => {
      if (!color) return;
      const l = map.get(k) ?? [];
      if (!l.includes(color) && l.length < 3) l.push(color);
      map.set(k, l);
    };
    const end = addMonthsZ(year, 12);
    for (const o of expandEvents(events, year, end)) {
      const cal = calMap.get(o.event.calendarId);
      if (!cal?.visible) continue;
      for (let d = Math.max(o.start, year); d < Math.min(o.end, end); d = addDaysZ(d, 1)) add(dayKey(d), cal.color);
      if (o.start === o.end) add(dayKey(o.start), cal.color);
    }
    for (const [k, list] of tasksByDay(tasks)) for (const t of list) if (!t.completedAt && calMap.get(t.calendarId)?.visible) add(k, calMap.get(t.calendarId)?.color);
    return map;
  }, [events, tasks, calMap, year]);

  return (
    <div className="year">
      {months.map((m) => {
        const month = fmt(m, "M");
        const isCur = fmt(m, "yyyy-M") === fmt(now, "yyyy-M");
        return (
          <div key={m} className="year-month">
            <button className={`year-title ${isCur ? "is-current" : ""}`} onClick={() => (setCursor(m), setView("month"))}>
              {capitalize(fmt(m, "MMMM"))}
            </button>
            <div className="year-grid">
              {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
                <div key={d} className="year-wd">{d}</div>
              ))}
              {monthGridDays(m).map((d) => {
                const other = fmt(d, "M") !== month;
                const colors = other ? [] : (marks.get(dayKey(d)) ?? []);
                return (
                  <button
                    key={d}
                    className={`year-day ${other ? "is-other" : ""} ${!other && isSameDayZ(d, now) ? "is-today" : ""}`}
                    onClick={() => (setCursor(d), setView("day"))}
                    tabIndex={other ? -1 : 0}
                  >
                    {other ? "" : fmt(d, "d")}
                    {colors.length > 0 && (
                      <span className="year-dots">
                        {colors.map((c) => (
                          <span key={c} className="year-dot" style={{ "--c": c } as CSSProperties} />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
