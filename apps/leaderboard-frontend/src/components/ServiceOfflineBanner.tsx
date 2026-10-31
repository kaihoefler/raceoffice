// Shown behind RaceOffice when the managed leaderboard service is not running: the UI itself is
// served by the RaceOffice server, so users can start the service right here.

import { Alert, Button } from "@mui/material";
import { useIntegration } from "../hooks/useIntegration";

export function ServiceOfflineBanner() {
  const { status, starting, error, start } = useIntegration();
  if (!status || status.mode !== "managed" || status.available) return null;

  const processStarting = starting || status.process.state === "starting";
  const problem = error ?? (status.process.state === "crashed" ? status.process.lastError : null);
  return (
    <Alert
      severity={problem ? "error" : "warning"}
      square
      action={
        <Button color="inherit" size="small" variant="outlined" disabled={processStarting} onClick={() => void start()}>
          {processStarting ? "Startet …" : "Service starten"}
        </Button>
      }
    >
      Der Leaderboard-Service läuft nicht. Ohne ihn gibt es keine Live-Daten und keine Steuerung.
      {problem ? ` Letzter Fehler: ${problem}` : ""}
    </Alert>
  );
}
