import { Route, Routes } from "react-router-dom";

import Layout from "@/components/Layout";
import AuditLog from "@/pages/AuditLog";
import CaptureInterview from "@/pages/CaptureInterview";
import CaseConsole from "@/pages/CaseConsole";
import PillLibrary from "@/pages/PillLibrary";
import TransferCheck from "@/pages/TransferCheck";

/**
 * Route table. `Layout` renders the shell and an `<Outlet />`; each page is self-contained and
 * fetches exactly what it needs, so a slow or failed request on one screen never blanks another.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<CaseConsole />} />
        <Route path="pills" element={<PillLibrary />} />
        <Route path="capture" element={<CaptureInterview />} />
        <Route path="transfer" element={<TransferCheck />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="*" element={<CaseConsole />} />
      </Route>
    </Routes>
  );
}
