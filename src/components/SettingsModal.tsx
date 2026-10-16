import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { backend, isTauri } from "../lib/backend";
import type { Corner, MonitorInfo, ThemePref, WidgetConfig } from "../lib/types";
import { Modal } from "./Modal";
import { Row, Switch } from "./fields";
import { ImportExportSection } from "./ImportExport";
import { ICloudSection } from "./ICloudSection";

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "Automático" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

const CORNERS: { value: Corner; label: string }[] = [
  { value: "tl", label: "↖" },
  { value: "tr", label: "↗" },
  { value: "bl", label: "↙" },
  { value: "br", label: "↘" },
];

function ThemePicker({ value, onChange }: { value: ThemePref; onChange(t: ThemePref): void }) {
  return (
    <div className="segmented small">
      {THEMES.map((t) => (
        <button key={t.value} className={value === t.value ? "is-active" : ""} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose(): void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const [widget, setWidget] = useState<WidgetConfig | null>(null);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    void backend.getWidgetConfig().then(setWidget);
    void backend.listMonitors().then(setMonitors);
    void backend.getAutostart().then(setAutostartState).catch(() => setAutostartState(null));
    // Si se mueve el widget arrastrándolo, reflejar la nueva posición/tamaño.
    const off = backend.onChange((k) => k === "settings" && void backend.getWidgetConfig().then(setWidget));
    return () => void off.then((f) => f());
  }, []);

  /** Aplica al momento; con `debounce` (deslizadores) espera a que se pare de mover. */
  const update = (patch: Partial<WidgetConfig>, debounce = false) => {
    if (!widget) return;
    const next = { ...widget, ...patch };
    setWidget(next);
    clearTimeout(timer.current);
    const send = () => void backend.setWidgetConfig(next).catch((e) => useStore.setState({ error: String(e) }));
    if (debounce) timer.current = setTimeout(send, 150);
    else send();
  };

  const toggleAutostart = async (v: boolean) => {
    setAutostartState(v);
    try {
      await backend.setAutostart(v);
    } catch (e) {
      useStore.setState({ error: String(e) });
    }
  };

  const currentMonitor = monitors.find((m) => m.name === widget?.monitor) ?? monitors.find((m) => m.primary) ?? monitors[0];

  return (
    <Modal onClose={onClose} title="Ajustes" width={500}>
      <div className="form">
        <div className="f-section">General</div>
        <div className="f-group">
          <Row label="Tema de la app">
            <ThemePicker value={theme} onChange={setTheme} />
          </Row>
          <Row label="Abrir al iniciar Windows">
            {autostart == null ? <span className="f-muted">—</span> : <Switch checked={autostart} onChange={toggleAutostart} label="Abrir al iniciar Windows" />}
          </Row>
        </div>

        <div className="f-section">Widget de escritorio</div>
        {widget && (
          <div className="f-group">
            <Row label="Mostrar">
              <Switch checked={widget.visible} onChange={(visible) => update({ visible })} label="Mostrar widget" />
            </Row>
            <Row label="Bloquear posición">
              <Switch checked={widget.locked} onChange={(locked) => update({ locked })} label="Bloquear posición" />
            </Row>
            {monitors.length > 1 && (
              <Row label="Pantalla">
                <select value={currentMonitor?.name ?? ""} onChange={(e) => update({ monitor: e.target.value, positionSet: false })} aria-label="Pantalla">
                  {monitors.map((m) => (
                    <option key={m.name} value={m.name}>{m.label}</option>
                  ))}
                </select>
              </Row>
            )}
            <Row label="Colocar en">
              <div className="segmented small">
                {CORNERS.map((c) => (
                  <button key={c.value} onClick={() => void backend.snapWidget(c.value)} title="Esquina de la pantalla" aria-label={`Esquina ${c.value}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </Row>
            <Row label="Ancho">
              <input
                type="range"
                min={320}
                max={Math.round(currentMonitor?.width ?? 1920)}
                step={10}
                value={widget.width}
                onChange={(e) => update({ width: Number(e.target.value) }, true)}
                aria-label="Ancho"
              />
              <span className="f-value">{Math.round(widget.width)} px</span>
            </Row>
            <Row label="Alto">
              <input
                type="range"
                min={180}
                max={Math.round(currentMonitor?.height ?? 1080)}
                step={10}
                value={widget.height}
                onChange={(e) => update({ height: Number(e.target.value) }, true)}
                aria-label="Alto"
              />
              <span className="f-value">{Math.round(widget.height)} px</span>
            </Row>
            <Row label="Opacidad">
              <input
                type="range"
                min={0.15}
                max={1}
                step={0.01}
                value={widget.opacity}
                onChange={(e) => update({ opacity: Number(e.target.value) }, true)}
                aria-label="Opacidad"
              />
              <span className="f-value">{Math.round(widget.opacity * 100)} %</span>
            </Row>
            <Row label="Desenfoque">
              <Switch checked={widget.acrylic} onChange={(acrylic) => update({ acrylic })} label="Desenfoque acrílico" />
            </Row>
            <Row label="Tema">
              <ThemePicker value={widget.theme} onChange={(t) => update({ theme: t })} />
            </Row>
          </div>
        )}
        <p className="f-help">
          {widget?.locked
            ? "Desbloquéalo para moverlo arrastrando la cabecera o cambiar su tamaño desde los bordes."
            : "Arrastra la cabecera del widget para moverlo y sus bordes para cambiar el tamaño."}
          {!isTauri() && " (En el navegador el widget se abre en /widget.html.)"}
        </p>

        <div className="f-section">iCloud</div>
        <ICloudSection />

        <div className="f-section">Importar y exportar</div>
        <ImportExportSection />

        <div className="f-actions">
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>Listo</button>
        </div>
      </div>
    </Modal>
  );
}
