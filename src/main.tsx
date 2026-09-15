import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@radix-ui/themes/styles.css";
import App from "./App";
import { PlayerAutomation } from "./components/PlayerAutomation";
import "./App.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <PlayerAutomation />
    <App />
  </React.StrictMode>,
);
