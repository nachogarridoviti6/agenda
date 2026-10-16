import { useMemo, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { backend, newId } from "../lib/backend";
import { exportIcs, importIcs, type ImportResult } from "../lib/ics";
import { PALETTE } from "../lib/defaults";
import { fmt } from "../lib/dates";
import type { Calendar } from "../lib/types";
import { Modal } from "./Modal";
import { Row, Switch } from "./fields";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Botones de Ajustes: importar y exportar .ics. */
export function ImportExportSection() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const pick = async () => {
    setMsg(null);
    try {
      const text = await backend.pickIcs();
      if (text == null) return;
      const r = importIcs(text);
      if (!r.events.length && !r.tasks.length) setMsg("El archivo no tiene eventos ni tareas.");
      else setResult(r);
    } catch (e) {
      setMsg(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <>
      <div className="f-group">
        <Row label="Importar">
          <button className="btn small" onClick={() => void pick()}>Importar .ics…</button>
        </Row>
        <Row label="Exportar">
          <button className="btn small" onClick={() => setExporting(true)}>Exportar .ics…</button>
        </Row>
      </div>
      {msg && <p className="f-help">{msg}</p>}
      {result && <ImportDialog result={result} onClose={(m) => (setResult(null), setMsg(m ?? null))} />}
      {exporting && <ExportDialog onClose={(m) => (setExporting(false), setMsg(m ?? null))} />}
    </>
  );
}

export function ImportDialog({ result, onClose }: { result: ImportResult; onClose(msg?: string): void }) {
  const calendars = useStore((s) => s.calendars);
  const hasSource = result.sourceCalendar.size > 0;
  const [target, setTarget] = useState<string>(hasSource ? "source" : result.name ? "new" : (calendars[0]?.id ?? "new"));
  const [newName, setNewName] = useState(result.name ?? "Importado");
  const [withTasks, setWithTasks] = useState(true);
  const [busy, setBusy] = useState(false);

  const series = result.events.filter((e) => e.rrule).length;
  const dates = result.events.map((e) => e.start).sort((a, b) => a - b);

  const run = async () => {
    setBusy(true);
    try {
      const created: Calendar[] = [];
      let order = Math.max(-1, ...calendars.map((c) => c.sortOrder)) + 1;
      const makeCal = (name: string): Calendar => {
        const c: Calendar = { id: newId(), name, color: PALETTE[(calendars.length + created.length + 6) % PALETTE.length].hex, visible: true, sortOrder: order++ };
        created.push(c);
        return c;
      };
      const byName = new Map(calendars.map((c) => [norm(c.name), c.id]));
      let fixed: string | null = null;
      if (target === "new") fixed = makeCal(newName.trim() || "Importado").id;
      else if (target !== "source") fixed = target;
      const resolve = (id: string) => {
        if (fixed) return fixed;
        const name = result.sourceCalendar.get(id) ?? result.name ?? "Importado";
        const found = byName.get(norm(name));
        if (found) return found;
        const c = makeCal(name);
        byName.set(norm(name), c.id);
        return c.id;
      };
      const events = result.events.map((e) => ({ ...e, calendarId: resolve(e.seriesId ?? e.id) }));
      const tasks = withTasks ? result.tasks.map((t) => ({ ...t, calendarId: resolve(t.id) })) : [];
      await backend.saveBulk(created, events, tasks);
      onClose(`Importados ${events.length} eventos${tasks.length ? ` y ${tasks.length} tareas` : ""}.${result.warnings.length ? ` ${result.warnings.join(" ")}` : ""}`);
    } catch (e) {
      setBusy(false);
      useStore.setState({ error: String(e) });
    }
  };

  return (
    <Modal title="Importar calendario" onClose={() => onClose()} width={440}>
      <div className="form">
        <div className="import-summary">
          <b>{result.events.length}</b> eventos{series ? ` (${series} repetidos)` : ""}
          {result.tasks.length > 0 && <> · <b>{result.tasks.length}</b> tareas</>}
          {dates.length > 0 && <div className="f-muted">Del {fmt(dates[0], "d MMM yyyy")} al {fmt(dates[dates.length - 1], "d MMM yyyy")}</div>}
        </div>
        <div className="f-group">
          <Row label="Añadir a">
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Calendario de destino">
              {hasSource && <option value="source">Sus calendarios originales</option>}
              <option value="new">Calendario nuevo…</option>
              {calendars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Row>
          {target === "new" && (
            <Row label="Nombre">
              <input className="text-input" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Nombre del calendario nuevo" />
            </Row>
          )}
          {result.tasks.length > 0 && (
            <Row label="Incluir tareas">
              <Switch checked={withTasks} onChange={setWithTasks} label="Incluir tareas" />
            </Row>
          )}
        </div>
        {result.warnings.map((w) => (
          <p key={w} className="f-help">⚠️ {w}</p>
        ))}
        <p className="f-help">Si vuelves a importar el mismo archivo, se actualizan los eventos en vez de duplicarse.</p>
        <div className="f-actions">
          <span className="spacer" />
          <button className="btn" onClick={() => onClose()}>Cancelar</button>
          <button className="btn primary" disabled={busy} onClick={() => void run()}>{busy ? "Importando…" : "Importar"}</button>
        </div>
      </div>
    </Modal>
  );
}

function ExportDialog({ onClose }: { onClose(msg?: string): void }) {
  const calendars = useStore((s) => s.calendars);
  const [selected, setSelected] = useState<Set<string>>(new Set(calendars.map((c) => c.id)));
  const [withTasks, setWithTasks] = useState(true);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const run = async () => {
    setBusy(true);
    try {
      const [events, tasks] = await Promise.all([backend.listAllEvents(), backend.listTasks()]);
      const cals = calendars.filter((c) => selected.has(c.id));
      const evs = events.filter((e) => selected.has(e.calendarId));
      const ts = withTasks ? tasks.filter((t) => selected.has(t.calendarId)) : [];
      const name = cals.length === 1 ? cals[0].name : "Agenda";
      const content = exportIcs({ events: evs, tasks: ts, calendars, name });
      const file = `${name} ${fmt(Date.now(), "yyyy-MM-dd")}.ics`.replace(/[\\/:*?"<>|]/g, "-");
      const path = await backend.saveIcs(content, file);
      onClose(path ? `Exportados ${evs.length} eventos${ts.length ? ` y ${ts.length} tareas` : ""} en ${path}.` : undefined);
    } catch (e) {
      setBusy(false);
      useStore.setState({ error: String(e) });
    }
  };

  return (
    <Modal title="Exportar calendario" onClose={() => onClose()} width={400}>
      <div className="form">
        <div className="f-group">
          {calendars.map((c) => (
            <Row key={c.id} label={c.name}>
              <input type="checkbox" className="check square" style={{ "--c": c.color } as CSSProperties} checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={c.name} />
            </Row>
          ))}
          <Row label="Incluir tareas">
            <Switch checked={withTasks} onChange={setWithTasks} label="Incluir tareas" />
          </Row>
        </div>
        <p className="f-help">
          El archivo se abre con Apple Calendar, Google Calendar u Outlook. Para pasar eventos al iPhone: envíatelo por correo o AirDrop y ábrelo allí.
          Las tareas solo las entienden apps como Agenda (Apple Calendar las ignora).
        </p>
        <div className="f-actions">
          <span className="spacer" />
          <button className="btn" onClick={() => onClose()}>Cancelar</button>
          <button className="btn primary" disabled={busy || selected.size === 0} onClick={() => void run()}>{busy ? "Exportando…" : "Exportar"}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Diálogo para un .ics abierto con doble clic en el Explorador. */
export function PendingIcsImport() {
  const text = useStore((s) => s.pendingIcs);
  const result = useMemo(() => {
    if (!text) return null;
    try {
      return importIcs(text);
    } catch (e) {
      useStore.setState({ error: String(e instanceof Error ? e.message : e), pendingIcs: null });
      return null;
    }
  }, [text]);
  const [done, setDone] = useState<string | null>(null);
  if (done) {
    return (
      <div className="toast ok" role="status" onClick={() => setDone(null)}>
        {done}
      </div>
    );
  }
  if (!result) return null;
  return (
    <ImportDialog
      result={result}
      onClose={(msg) => {
        useStore.setState({ pendingIcs: null });
        if (msg) {
          setDone(msg);
          setTimeout(() => setDone(null), 5000);
        }
      }}
    />
  );
}
