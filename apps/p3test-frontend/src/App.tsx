import { useCallback, useEffect, useMemo, useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Container,
  Divider,
  FormControlLabel,
    Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";


type P3Event = {
  id: number;
  ts: string;
  kind: "record" | "request" | "socket" | "warning";
  payload: unknown;
};

type P3DiscoveredDecoder = {
  key: string;
  host: string;
  port: number;
  decoderId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  responseCount: number;
  torNames: string[];
  lastRecordKind: string;
  decoderType: string | null;
  firmwareVersion: string | null;
  timelineName: string | null;
  networkIps: string[];
};

type P3DiscoveryState = {
  status: "idle" | "running" | "completed" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  timeoutMs: number;
  lastError: string | null;
  responsesReceived: number;
  decoders: P3DiscoveredDecoder[];
};

type P3ClientState = {

  connection: {
    status: "disconnected" | "connecting" | "connected" | "error";
    host: string | null;
    port: number | null;
    connectedAt: string | null;
    disconnectedAt: string | null;
    lastError: string | null;
  };
  transport: {
    bytesReceived: number;
    bytesSent: number;
    bufferedHex: string;
  };
    history: {
    nextEventId: number;
    events: P3Event[];
  };
  discovery: P3DiscoveryState;
};


type ApiStateResponse = {
  ok: boolean;
  state: P3ClientState;
};

type ApiResult = {
  ok: boolean;
  message: string;
};

function toWireOrderDecoderId(input: string): string {
  const clean = input.replace(/[^a-fA-F0-9]/g, "").toUpperCase();
  if (clean.length !== 8) return input;

  const bytes = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6), clean.slice(6, 8)];
  return bytes.reverse().join("-");
}

function summarizeEvent(event: P3Event): string {
  if (event.kind === "record") {
    const payload = event.payload as {
      record?: {
        kind?: unknown;
        torName?: unknown;
        crcValid?: unknown;
        temperature?: unknown;
        noise?: unknown;
        decoderId?: unknown;
        transponderId?: unknown;
        passingNumber?: unknown;
        passingTime?: unknown;
      };
    };

    const kind = String(payload?.record?.kind ?? "unknown");
    const torName = String(payload?.record?.torName ?? "UNKNOWN");
    const details: string[] = [torName];

    if (kind === "status") {
      const temperature = payload?.record?.temperature;
      const noise = payload?.record?.noise;
      const decoderId = payload?.record?.decoderId;
      if (typeof temperature === "number") details.push(`temp=${temperature}`);
      if (typeof noise === "number") details.push(`noise=${noise}`);
      if (typeof decoderId === "string" && decoderId.trim()) details.push(`dec=${decoderId}`);
    }

    if (kind === "passing") {
      const passingNumber = payload?.record?.passingNumber;
      const passingTime = payload?.record?.passingTime;
      const transponderId = payload?.record?.transponderId;

      if (typeof passingNumber === "number") details.push(`#${passingNumber}`);
      if (typeof passingTime === "string" && passingTime.trim()) details.push(`time=${passingTime}`);
      if (typeof transponderId === "string" && transponderId.trim()) details.push(`tran=${transponderId}`);
    }

    if (payload?.record?.crcValid === false) {
      details.push("crc-mismatch");
    }

    return `${kind} (${details.join(", ")})`;
  }

  if (event.kind === "request") {
    const payload = event.payload as { request?: { name?: unknown } };
    return `request: ${String(payload?.request?.name ?? "unknown")}`;
  }

  if (event.kind === "socket") {
    const payload = event.payload as { action?: unknown };
    return `socket: ${String(payload?.action ?? "event")}`;
  }

  return "warning";
}

async function parseJsonOrThrow(response: Response) {
  const raw = await response.text();

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const preview = raw.slice(0, 180).replace(/\s+/g, " ").trim();
    throw new Error(`Expected JSON response but received non-JSON body (HTTP ${response.status}): ${preview}`);
  }
}

async function getState(): Promise<P3ClientState> {
  const response = await fetch("/p3-test/state");
  const body = (await parseJsonOrThrow(response)) as Partial<ApiStateResponse> & { message?: unknown };

  if (!response.ok) {
    throw new Error(String(body.message ?? `HTTP ${response.status}`));
  }

  if (body.ok !== true || !body.state) {
    throw new Error("State endpoint returned invalid payload.");
  }

  return body.state;
}

async function postJson(path: string, body: unknown): Promise<ApiResult> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const parsed = (await parseJsonOrThrow(response)) as Partial<ApiResult>;
  const ok = response.ok && parsed.ok === true;
  return {
    ok,
    message: String(parsed.message ?? (ok ? "ok" : `HTTP ${response.status}`)),
  };
}

export default function App() {
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("5403");
    const [decoderId, setDecoderId] = useState("40-24-04-00");
  const [decoderIdManuallyEdited, setDecoderIdManuallyEdited] = useState(false);
  const [resendFrom, setResendFrom] = useState("0");
  const [resendTo, setResendTo] = useState("10");
  const [resendLastNValue, setResendLastNValue] = useState("10");
  const [discoveryTimeoutMs, setDiscoveryTimeoutMs] = useState("4000");



  const [state, setState] = useState<P3ClientState | null>(null);
  const [busy, setBusy] = useState(false);
  const [showStatusEvents, setShowStatusEvents] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const refreshState = useCallback(async () => {
    try {
      const next = await getState();
      setState(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load state.";
      setFeedback({ kind: "error", message });
    }
  }, []);

  useEffect(() => {
    void refreshState();

    const timer = setInterval(() => {
      void refreshState();
    }, 1_000);

    return () => clearInterval(timer);
  }, [refreshState]);

  const eventsNewestFirst = useMemo(() => {
    return [...(state?.history.events ?? [])].reverse();
  }, [state?.history.events]);

  const visibleEvents = useMemo(() => {
    if (showStatusEvents) return eventsNewestFirst;

    return eventsNewestFirst.filter((event) => {
      if (event.kind !== "record") return true;
      const payload = event.payload as { record?: { kind?: unknown } };
      return payload?.record?.kind !== "status";
    });
  }, [eventsNewestFirst, showStatusEvents]);

  const detectedDecoderId = useMemo(() => {
    for (const event of eventsNewestFirst) {
      if (event.kind !== "record") continue;
      const payload = event.payload as { record?: { decoderId?: unknown } };
      const candidate = payload?.record?.decoderId;
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return null;
  }, [eventsNewestFirst]);

  const latestKnownPassingNumber = useMemo(() => {
    let maxPassingNumber: number | null = null;

    for (const event of eventsNewestFirst) {
      if (event.kind !== "record") continue;
      const payload = event.payload as { record?: { passingNumber?: unknown; lastPassingIndex?: unknown } };
      const passingNumber = payload?.record?.passingNumber;
      const lastPassingIndex = payload?.record?.lastPassingIndex;

      if (typeof passingNumber === "number") {
        maxPassingNumber = maxPassingNumber == null ? passingNumber : Math.max(maxPassingNumber, passingNumber);
      }

      if (typeof lastPassingIndex === "number") {
        maxPassingNumber = maxPassingNumber == null ? lastPassingIndex : Math.max(maxPassingNumber, lastPassingIndex);
      }
    }

    return maxPassingNumber;
  }, [eventsNewestFirst]);

  useEffect(() => {
    if (!detectedDecoderId || decoderIdManuallyEdited) return;
    if (decoderId !== detectedDecoderId) {
      setDecoderId(detectedDecoderId);
    }
  }, [detectedDecoderId, decoderIdManuallyEdited, decoderId]);

    async function runAction(path: string, body: unknown) {
    setBusy(true);
    setFeedback(null);

    try {
      const result = await postJson(path, body);
      setFeedback({ kind: result.ok ? "success" : "error", message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed.";
      setFeedback({ kind: "error", message });
    } finally {
      setBusy(false);
      await refreshState();
    }
  }

  function startDiscovery() {
    const timeoutMs = Number(discoveryTimeoutMs);
    void runAction("/p3-test/discovery/start", {
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 4000,
    });
  }

  function connectToDiscoveredDecoder(decoder: P3DiscoveredDecoder) {
    setHost(decoder.host);
    setPort(String(decoder.port));

    if (decoder.decoderId && decoder.decoderId.trim()) {
      setDecoderId(decoder.decoderId);
      setDecoderIdManuallyEdited(false);
    }

    void runAction("/p3-test/connect", { host: decoder.host, port: decoder.port });
  }


    function sendRequest(kind: "get-time" | "session" | "resend") {

    if (kind === "session") {
      void runAction("/p3-test/request", {
        kind,
        decoderId: toWireOrderDecoderId(decoderId),
      });
      return;
    }

    if (kind === "resend") {
      void runAction("/p3-test/request", {
        kind,
        decoderId: toWireOrderDecoderId(decoderId),
        fromPassingNumber: Number(resendFrom),
        toPassingNumber: Number(resendTo),
      });
      return;
    }

    void runAction("/p3-test/request", { kind });
  }

    function resendLastN() {
    const n = Number(resendLastNValue);
    if (!Number.isInteger(n) || n <= 0) {
      setFeedback({ kind: "error", message: "Last N must be a positive integer." });
      return;
    }


    if (latestKnownPassingNumber == null) {
      setFeedback({ kind: "error", message: "No known passing/session index yet. Send SESSION first or wait for passings." });
      return;
    }

    const toPassingNumber = latestKnownPassingNumber;
    const fromPassingNumber = Math.max(0, toPassingNumber - n + 1);

    setResendFrom(String(fromPassingNumber));
    setResendTo(String(toPassingNumber));

    void runAction("/p3-test/request", {
      kind: "resend",
      decoderId: toWireOrderDecoderId(decoderId),
      fromPassingNumber,
      toPassingNumber,
    });
  }

            const status = state?.connection.status ?? "disconnected";
  const canSend = status === "connected";
  const canResendLastN = canSend && !busy && latestKnownPassingNumber != null;
  const canConnect = !busy && (status === "disconnected" || status === "error");
  const canDisconnect = !busy && (status === "connected" || status === "connecting");
  const discovery = state?.discovery;


    const discoveryStatus = discovery?.status ?? "idle";
  const discoveredDecoders = discovery?.decoders ?? [];

  function renderNetworkInfo(decoder: P3DiscoveredDecoder) {
    const [ipAddress, netmask, gateway, dns] = decoder.networkIps;

    return (
      <Stack spacing={0.25}>
        <Typography variant="caption">IP: {ipAddress ?? "—"}</Typography>
        <Typography variant="caption">Netmask: {netmask ?? "—"}</Typography>
        <Typography variant="caption">Gateway: {gateway ?? "—"}</Typography>
        <Typography variant="caption">DNS: {dns ?? "—"}</Typography>
      </Stack>
    );
  }

  return (


    <Container sx={{ py: 3, display: "grid", gap: 2 }}>
      <Typography variant="h4">P3 Test Client</Typography>
      <Typography variant="body2" color="text.secondary">
        Standalone diagnostic app for the server-side P3 parser. TCP connection and decoding run in the backend.
      </Typography>

      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}

      <Card variant="outlined">
        <CardHeader title="UDP Discovery" subheader="Broadcast discovery is handled server-side and independent from TCP connect/session." />
        <Divider />
        <CardContent>
          <Stack spacing={1}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField
                size="small"
                label="Discovery timeout (ms)"
                type="number"
                value={discoveryTimeoutMs}
                onChange={(e) => setDiscoveryTimeoutMs(e.target.value)}
                sx={{ maxWidth: 220 }}
              />
              <Button variant="contained" disabled={busy || discoveryStatus === "running"} onClick={startDiscovery}>
                {discoveryStatus === "running" ? "Discovery running..." : "Start Discovery"}
              </Button>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Chip label={`Discovery: ${discoveryStatus}`} color={discoveryStatus === "completed" ? "success" : discoveryStatus === "running" ? "warning" : discoveryStatus === "error" ? "error" : "default"} variant="outlined" />
              <Chip label={`Responses: ${discovery?.responsesReceived ?? 0}`} variant="outlined" />
              <Chip label={`Decoders: ${discoveredDecoders.length}`} variant="outlined" />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Last discovery error: {discovery?.lastError ?? "—"}
            </Typography>

            {discoveredDecoders.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No decoders discovered yet.</Typography>
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                                            <TableCell>Responder IP</TableCell>

                      <TableCell>Decoder ID</TableCell>
                      <TableCell>Type / Firmware</TableCell>
                      <TableCell>TORs</TableCell>
                                            <TableCell>Reported Decoder Network IPs</TableCell>

                      <TableCell align="right">Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {discoveredDecoders.map((decoder) => (
                      <TableRow key={decoder.key}>
                        <TableCell>{decoder.host}:{decoder.port}</TableCell>
                        <TableCell>{decoder.decoderId ?? "—"}</TableCell>
                        <TableCell>{decoder.decoderType ?? "—"} / {decoder.firmwareVersion ?? "—"}</TableCell>
                        <TableCell>{decoder.torNames.join(", ") || "—"}</TableCell>
                                                <TableCell>{renderNetworkInfo(decoder)}</TableCell>

                        <TableCell align="right">
                                                    <Button size="small" variant="outlined" disabled={!canConnect} onClick={() => connectToDiscoveredDecoder(decoder)}>

                            Connect
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">

        <CardHeader title="Connection" />
        <Divider />
        <CardContent>
          <Stack spacing={1}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField size="small" label="Host" value={host} onChange={(e) => setHost(e.target.value)} fullWidth />
              <TextField size="small" label="Port" value={port} onChange={(e) => setPort(e.target.value)} sx={{ minWidth: 140 }} />
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
                            <Button
                variant="contained"
                color={canConnect ? "primary" : "inherit"}
                disabled={!canConnect}
                onClick={() => {
                  setDecoderIdManuallyEdited(false);
                  void runAction("/p3-test/connect", { host, port: Number(port) });
                }}
              >
                Connect
              </Button>
              <Button
                variant="outlined"
                color={canDisconnect ? "warning" : "inherit"}
                disabled={!canDisconnect}
                onClick={() => void runAction("/p3-test/disconnect", { reason: "operator request" })}
              >
                Disconnect
              </Button>

              <Button variant="outlined" disabled={busy} onClick={() => void runAction("/p3-test/clear", {})}>
                Clear History
              </Button>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Chip label={`Status: ${status}`} color={status === "connected" ? "success" : status === "connecting" ? "warning" : status === "error" ? "error" : "default"} variant="outlined" />
              <Chip label={`RX: ${state?.transport.bytesReceived ?? 0} bytes`} variant="outlined" />
              <Chip label={`TX: ${state?.transport.bytesSent ?? 0} bytes`} variant="outlined" />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Last error: {state?.connection.lastError ?? "—"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Buffered tail: {state?.transport.bufferedHex || "—"}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

            <Card variant="outlined">
        <CardHeader title="Requests" subheader="Direct decoder queries (GET_TIME / SESSION / RESEND). Discovery is handled in the UDP Discovery section." />

        <Divider />
        <CardContent>
          <Stack spacing={1}>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <Button variant="contained" disabled={!canSend || busy} onClick={() => sendRequest("get-time")}>
                GET_TIME
              </Button>
            </Stack>

                        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems="flex-start">
              <TextField
                size="small"
                label="Decoder ID"
                value={decoderId}
                onChange={(e) => {
                  setDecoderId(e.target.value);
                  setDecoderIdManuallyEdited(true);
                }}
                helperText="Auto-detected from decoder status."
              />
              <Button variant="contained" disabled={!canSend || busy} onClick={() => sendRequest("session")}>
                SESSION
              </Button>
            </Stack>


            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField size="small" type="number" label="RESEND from" value={resendFrom} onChange={(e) => setResendFrom(e.target.value)} sx={{ minWidth: 130 }} />
              <TextField size="small" type="number" label="RESEND to" value={resendTo} onChange={(e) => setResendTo(e.target.value)} sx={{ minWidth: 130 }} />
              <Button variant="contained" disabled={!canSend || busy} onClick={() => sendRequest("resend")}>
                RESEND Range
              </Button>
            </Stack>

            <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
              <TextField
                size="small"
                type="number"
                label="Last N"
                value={resendLastNValue}
                onChange={(e) => setResendLastNValue(e.target.value)}
                sx={{ minWidth: 130 }}
              />
                            <Button variant="contained" disabled={!canResendLastN} onClick={resendLastN}>
                RESEND last N
              </Button>

            </Stack>

            <Typography variant="caption" color="text.secondary">
              Latest known passing index: {latestKnownPassingNumber ?? "—"}
            </Typography>
          </Stack>
        </CardContent>
      </Card>


      <Card variant="outlined">
        <CardHeader
          title="Protocol Events"
          subheader="Known records are typed; unknown/partial records stay raw for analysis."
          action={(
            <FormControlLabel
              control={<Switch checked={showStatusEvents} onChange={(e) => setShowStatusEvents(e.target.checked)} />}
              label="Show status"
            />
          )}
        />
        <Divider />
        <CardContent>
          <Stack spacing={1}>
            {visibleEvents.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No events yet.</Typography>
            ) : (
              visibleEvents.map((event) => {
                const recordPayload = event.kind === "record"
                  ? (event.payload as { receivedAt?: unknown; record?: Record<string, unknown> })
                  : null;
                const record = recordPayload?.record;
                const recordKind = typeof record?.kind === "string" ? record.kind : "";
                const isStatusRecord = recordKind === "status";
                const isPassingRecord = recordKind === "passing";
                const unknownFields = Array.isArray(record?.unknownFields) ? record.unknownFields : [];

                const payloadWithoutTlvArrays = record
                  ? {
                      ...recordPayload,
                      record: {
                        ...record,
                        tlvs: undefined,
                        unknownFields: undefined,
                      },
                    }
                  : event.payload;

                return (
                  <Box key={event.id} sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, p: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      #{event.id} • {event.ts} • {summarizeEvent(event)}
                    </Typography>

                    {record ? (
                      <>
                        <Accordion disableGutters elevation={0} defaultExpanded={!isStatusRecord && !isPassingRecord} sx={{ mt: 1, border: "1px solid", borderColor: "divider", borderRadius: 1, "&:before": { display: "none" } }}>
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Typography variant="body2">
                              Record details {isStatusRecord ? "(status collapsed by default)" : isPassingRecord ? "(passing collapsed by default)" : ""}
                            </Typography>
                          </AccordionSummary>
                          <AccordionDetails>
                            <Box
                              component="pre"
                              sx={{
                                m: 0,
                                p: 1,
                                borderRadius: 1,
                                bgcolor: "grey.100",
                                fontFamily: "monospace",
                                fontSize: 12,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {JSON.stringify(payloadWithoutTlvArrays, null, 2)}
                            </Box>
                          </AccordionDetails>
                        </Accordion>

                        {unknownFields.length > 0 ? (
                          <Accordion disableGutters elevation={0} defaultExpanded={false} sx={{ mt: 1, border: "1px solid", borderColor: "divider", borderRadius: 1, "&:before": { display: "none" } }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="body2">Unknown fields ({unknownFields.length})</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Box
                                component="pre"
                                sx={{
                                  m: 0,
                                  p: 1,
                                  borderRadius: 1,
                                  bgcolor: "grey.100",
                                  fontFamily: "monospace",
                                  fontSize: 12,
                                  whiteSpace: "pre-wrap",
                                  wordBreak: "break-word",
                                }}
                              >
                                {JSON.stringify({ unknownFields }, null, 2)}
                              </Box>
                            </AccordionDetails>
                          </Accordion>
                        ) : null}
                      </>
                    ) : (
                      <Box
                        component="pre"
                        sx={{
                          m: 0,
                          mt: 1,
                          p: 1,
                          borderRadius: 1,
                          bgcolor: "grey.100",
                          fontFamily: "monospace",
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {JSON.stringify(event.payload, null, 2)}
                      </Box>
                    )}
                  </Box>
                );
              })
            )}
          </Stack>
        </CardContent>
      </Card>
    </Container>
  );
}
