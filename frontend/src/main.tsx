import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/fonts.css";
import "./styles.css";
import "./styles/mapWorkspace.css";

ReactDOM.createRoot(document.getElementById("root")!, {
  // Caught render errors may contain locations or API bodies. The boundary offers recovery;
  // do not send the exception to React's default browser-console reporter or telemetry.
  onCaughtError: () => {},
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
