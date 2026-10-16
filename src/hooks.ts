import { useEffect, useMemo, useState } from "react";
import { useStore } from "./store";
import type { Calendar } from "./lib/types";

/** Hora actual que se refresca cada `ms` (por defecto 30 s), para la línea roja. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Aplica el tema elegido ("system" deja que mande el sistema). */
export function useApplyTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
}

export function useCalendarMap(): Map<string, Calendar> {
  const calendars = useStore((s) => s.calendars);
  return useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** Atajos de teclado globales: N nuevo, T hoy, flechas navegar, 2/3 cambiar de vista. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      if (s.editor || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case "n":
        case "N":
          s.openNewEvent();
          break;
        case "t":
        case "T":
          s.goToday();
          break;
        case "ArrowLeft":
          s.step(-1);
          break;
        case "ArrowRight":
          s.step(1);
          break;
        case "2":
          s.setView("week");
          break;
        case "3":
          s.setView("month");
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
