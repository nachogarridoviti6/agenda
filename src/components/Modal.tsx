import { useEffect, useRef, type ReactNode } from "react";

/** Pila de modales abiertos: Esc solo cierra el de arriba. */
const stack: symbol[] = [];

/** Hoja modal centrada estilo macOS. Esc cierra. */
export function Modal({ title, onClose, children, width = 420 }: { title?: string; onClose(): void; children: ReactNode; width?: number }) {
  const id = useRef(Symbol("modal")).current;
  useEffect(() => {
    stack.push(id);
    return () => void stack.splice(stack.indexOf(id), 1);
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, id]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        {title && <div className="modal-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
