import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../styles/tokens.css";
import "./widget.css";
import { Widget } from "./Widget";

createRoot(document.getElementById("root")!).render(<Widget />);
