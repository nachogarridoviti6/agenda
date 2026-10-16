import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { capitalize, fmt, viewTitle } from "../lib/dates";
import { ChevronLeft, ChevronRight, Plus, SidebarIcon } from "./icons";
import type { ViewMode } from "../lib/types";

const VIEWS: { id: ViewMode; label: string; key: string }[] = [
  { id: "week", label: "Semana", key: "2" },
  { id: "month", label: "Mes", key: "3" },
];

export function Toolbar() {
  const view = useStore((s) => s.view);
  const cursor = useStore((s) => s.cursor);
  const { setView, step, goToday, toggleSidebar, openNewEvent, openNewTask } = useStore.getState();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  // Título estilo Apple: mes en negrita y año en gris.
  const title = viewTitle(view, cursor);
  const [main, year] = view === "month" || (view === "week" && /\d{4}$/.test(title))
    ? [title.replace(/\s\d{4}$/, ""), title.match(/\d{4}$/)?.[0]]
    : [title, undefined];

  return (
    <header className="toolbar">
      <div className="tb-left">
        <button className="icon-btn" onClick={toggleSidebar} aria-label="Mostrar u ocultar barra lateral" title="Barra lateral">
          <SidebarIcon />
        </button>
        <div className="tb-add" ref={menuRef}>
          <button className="icon-btn" onClick={() => setMenu((m) => !m)} aria-label="Añadir" title="Añadir (N)">
            <Plus />
          </button>
          {menu && (
            <div className="menu">
              <button onClick={() => { setMenu(false); openNewEvent(); }}>
                Nuevo evento <kbd>N</kbd>
              </button>
              <button onClick={() => { setMenu(false); openNewTask(); }}>Nueva tarea</button>
            </div>
          )}
        </div>
        <h1 className="tb-title">
          {main} {year && <span className="tb-year">{year}</span>}
        </h1>
      </div>

      <div className="segmented" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            className={view === v.id ? "is-active" : ""}
            onClick={() => setView(v.id)}
            title={`${v.label} (${v.key})`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="tb-right">
        <div className="nav-group">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Anterior" title="Anterior (←)">
            <ChevronLeft />
          </button>
          <button className="today-btn" onClick={goToday} title={`Hoy, ${capitalize(fmt(Date.now(), "EEEE d"))} (T)`}>
            Hoy
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Siguiente" title="Siguiente (→)">
            <ChevronRight />
          </button>
        </div>
      </div>
    </header>
  );
}
