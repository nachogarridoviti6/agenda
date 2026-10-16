import { useState, type CSSProperties } from "react";
import { useStore } from "../store";
import type { Calendar } from "../lib/types";
import { PALETTE } from "../lib/defaults";
import { Modal } from "./Modal";
import { DeleteButton, Row, Switch } from "./fields";

export function CalendarEditor({ calendar, isNew }: { calendar: Calendar; isNew: boolean }) {
  const count = useStore((s) => s.calendars.length);
  const { saveCalendar, deleteCalendar, closeEditor } = useStore.getState();
  const [name, setName] = useState(calendar.name);
  const [color, setColor] = useState(calendar.color);
  const [visible, setVisible] = useState(calendar.visible);
  const [armed, setArmed] = useState(false);

  const submit = () => name.trim() && void saveCalendar({ ...calendar, name: name.trim(), color, visible });

  return (
    <Modal onClose={closeEditor} title={isNew ? "Nuevo calendario" : "Editar calendario"} width={380}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input className="f-title" autoFocus placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="f-group">
          <Row label="Color">
            <div className="swatches">
              {PALETTE.map((p) => (
                <button
                  type="button"
                  key={p.hex}
                  className={`swatch ${color.toLowerCase() === p.hex.toLowerCase() ? "is-active" : ""}`}
                  style={{ "--c": p.hex } as CSSProperties}
                  onClick={() => setColor(p.hex)}
                  aria-label={p.name}
                  title={p.name}
                />
              ))}
            </div>
          </Row>
          <Row label="Visible">
            <Switch checked={visible} onChange={setVisible} label="Visible" />
          </Row>
        </div>
        {!isNew && armed && <div className="f-error">Se borrarán también todos sus eventos y tareas.</div>}
        <div className="f-actions">
          {!isNew && count > 1 && (
            <DeleteButton label="Eliminar calendario" armed={armed} onArm={() => setArmed(true)} onConfirm={() => deleteCalendar(calendar.id)} />
          )}
          <span className="spacer" />
          <button type="button" className="btn" onClick={closeEditor}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>{isNew ? "Crear" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
