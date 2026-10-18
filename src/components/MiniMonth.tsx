import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { useNow, useSwipeNav } from "../hooks";
import { addMonthsZ, capitalize, fmt, isSameDayZ, monthGridDays, startOfMonthZ, startOfWeekZ } from "../lib/dates";
import { ChevronLeft, ChevronRight } from "./icons";

/** Mini calendario de la barra lateral. Pulsar un día mueve la vista a ese día. */
export function MiniMonth() {
  const cursor = useStore((s) => s.cursor);
  const view = useStore((s) => s.view);
  const setCursor = useStore((s) => s.setCursor);
  const now = useNow(60_000);
  const [shown, setShown] = useState(startOfMonthZ(cursor));
  useEffect(() => setShown(startOfMonthZ(cursor)), [cursor]);
  const ref = useRef<HTMLDivElement>(null);
  useSwipeNav(ref, "y", (dir) => setShown((s) => addMonthsZ(s, dir)));

  const days = monthGridDays(shown);
  const month = fmt(shown, "M");
  const selWeek = startOfWeekZ(cursor);

  return (
    <div className="mini" ref={ref}>
      <div className="mini-head">
        <span className="mini-title">{capitalize(fmt(shown, "MMMM yyyy"))}</span>
        <button className="icon-btn sm" onClick={() => setShown(addMonthsZ(shown, -1))} aria-label="Mes anterior">
          <ChevronLeft width={13} height={13} />
        </button>
        <button className="icon-btn sm" onClick={() => setShown(addMonthsZ(shown, 1))} aria-label="Mes siguiente">
          <ChevronRight width={13} height={13} />
        </button>
      </div>
      <div className="mini-grid">
        {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
          <div key={d} className="mini-wd">{d}</div>
        ))}
        {days.map((d) => {
          const inWeek = view === "week" && startOfWeekZ(d) === selWeek;
          return (
            <button
              key={d}
              className={[
                "mini-day",
                fmt(d, "M") !== month && "is-other",
                isSameDayZ(d, now) && "is-today",
                isSameDayZ(d, cursor) && "is-selected",
                inWeek && "in-week",
              ].filter(Boolean).join(" ")}
              onClick={() => setCursor(d)}
            >
              {fmt(d, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
