import { useStore } from "../store";
import { Modal } from "./Modal";

/** "¿Solo este evento o todos los futuros?" al editar o borrar una repetición. */
export function ScopeDialog() {
  const prompt = useStore((s) => s.scopePrompt);
  if (!prompt) return null;
  const del = prompt.action === "delete";
  return (
    <Modal onClose={() => prompt.resolve(null)} width={380}>
      <div className="scope">
        <div className="scope-title">{del ? "Eliminar evento repetido" : "Cambiar evento repetido"}</div>
        <p className="scope-text">
          {del ? "¿Quieres eliminar solo este evento o también todos los futuros?" : "¿Quieres aplicar el cambio solo a este evento o también a todos los futuros?"}
        </p>
        <div className="scope-actions">
          <button className="btn" autoFocus onClick={() => prompt.resolve("this")}>
            {del ? "Eliminar solo este" : "Solo este evento"}
          </button>
          <button className={`btn ${del ? "danger-solid" : "primary"}`} onClick={() => prompt.resolve("future")}>
            {del ? "Eliminar todos los futuros" : "Todos los futuros"}
          </button>
          <button className="btn ghost" onClick={() => prompt.resolve(null)}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}
