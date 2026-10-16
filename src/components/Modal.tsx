import { useEffect, type ReactNode } from "react";

/** Hoja modal centrada estilo macOS. Esc cierra. */
export function Modal({ title, onClose, children, width = 420 }: { title?: string; onClose(): void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-label={title}>
        {title && <div className="modal-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
