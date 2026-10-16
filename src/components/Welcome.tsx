import { useStore } from "../store";
import { backend } from "../lib/backend";
import { Modal } from "./Modal";

const TIPS = [
  { icon: "🗓", title: "Tu semana en el escritorio", text: "El widget se queda en el fondo, incluso al pulsar Win+D. Ajústalo en ⚙️ Ajustes." },
  { icon: "⚡️", title: "Añadir rápido", text: "Ctrl+K y escribe «Entrega práctica viernes 23:59 #uni» o «Grabación villa martes 10-13 #trabajo»." },
  { icon: "☁️", title: "Con tu iPhone", text: "Conecta iCloud en Ajustes para ver aquí lo que apuntas en el móvil, y al revés." },
  { icon: "⌨️", title: "Atajos", text: "N nuevo evento · T hoy · ← → navegar · 1 2 3 4 día, semana, mes y año · Ctrl+F buscar." },
];

/** Bienvenida la primera vez que se abre Agenda. */
export function Welcome() {
  const show = useStore((s) => s.welcome);
  if (!show) return null;
  const close = () => {
    useStore.setState({ welcome: false });
    void backend.setSetting("welcomed", true);
  };
  return (
    <Modal onClose={close} width={460}>
      <div className="welcome">
        <img src="/icon.png" alt="" width={72} height={72} />
        <h2>Bienvenido a Agenda</h2>
        <div className="welcome-tips">
          {TIPS.map((t) => (
            <div key={t.title} className="welcome-tip">
              <span className="welcome-icon">{t.icon}</span>
              <div>
                <b>{t.title}</b>
                <p>{t.text}</p>
              </div>
            </div>
          ))}
        </div>
        <button className="btn primary welcome-go" autoFocus onClick={close}>Empezar</button>
      </div>
    </Modal>
  );
}
