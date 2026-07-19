import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import FirstAndTen from "../app/FirstAndTen";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><FirstAndTen /></StrictMode>,
);
