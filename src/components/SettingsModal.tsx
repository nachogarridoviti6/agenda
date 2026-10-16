import { useStore } from "../store";
import type { ThemePref } from "../lib/types";
import { Modal } from "./Modal";
import { Row } from "./fields";

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "Automático" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

export function SettingsModal({ onClose }: { onClose(): void }) {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  return (
    <Modal onClose={onClose} title="Ajustes" width={460}>
      <div className="form">
        <div className="f-section">Apariencia</div>
        <div className="f-group">
          <Row label="Tema">
            <div className="segmented small">
              {THEMES.map((t) => (
                <button key={t.value} className={theme === t.value ? "is-active" : ""} onClick={() => setTheme(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </Row>
        </div>
        <div className="f-actions">
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>Listo</button>
        </div>
      </div>
    </Modal>
  );
}
