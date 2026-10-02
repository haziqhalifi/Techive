import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { RoleProvider } from "@/hooks/use-role";
import App from "@/App";
import "@/index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root container #root is missing from index.html.");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <RoleProvider>
        <App />
      </RoleProvider>
    </BrowserRouter>
  </StrictMode>,
);
