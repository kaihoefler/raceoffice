// Small reusable dialogs and the collapsible JSON debug view.

import { useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

/** Confirmation for destructive actions. */
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  text: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="xs" fullWidth aria-labelledby="confirm-title">
      <DialogTitle id="confirm-title">{props.title}</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">{props.text}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Abbrechen</Button>
        <Button
          variant="contained"
          color={props.danger ? "error" : "primary"}
          onClick={() => {
            props.onConfirm();
            props.onClose();
          }}
        >
          {props.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function NewEntryDialog(props: { open: boolean; title: string; onConfirm: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const close = () => {
    setName("");
    props.onClose();
  };
  const confirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    props.onConfirm(trimmed);
    close();
  };
  return (
    <Dialog open={props.open} onClose={close} maxWidth="xs" fullWidth>
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          size="small"
          label="Name"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirm()}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Abbrechen</Button>
        <Button variant="contained" onClick={confirm} disabled={!name.trim()}>
          Anlegen
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function ManageListDialog(props: {
  open: boolean;
  title: string;
  entries: Array<{ id: string; name: string }>;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  const save = (id: string) => {
    const name = (editing[id] ?? "").trim();
    if (name) props.onRename(id, name);
    setEditing(({ [id]: _drop, ...rest }) => rest);
  };
  return (
    <Dialog open={props.open} onClose={props.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{props.title}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {props.entries.length === 0 ? (
          <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>
            Noch keine Einträge.
          </Typography>
        ) : (
          <List dense disablePadding>
            {props.entries.map((entry) => (
              <ListItem
                key={entry.id}
                divider
                secondaryAction={
                  entry.id in editing ? (
                    <Button size="small" onClick={() => save(entry.id)}>
                      Speichern
                    </Button>
                  ) : (
                    <>
                      <IconButton size="small" aria-label={`${entry.name} umbenennen`} onClick={() => setEditing((p) => ({ ...p, [entry.id]: entry.name }))}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" aria-label={`${entry.name} löschen`} onClick={() => props.onDelete(entry.id)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </>
                  )
                }
              >
                {entry.id in editing ? (
                  <TextField
                    size="small"
                    autoFocus
                    value={editing[entry.id]}
                    onChange={(e) => setEditing((p) => ({ ...p, [entry.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && save(entry.id)}
                    sx={{ mr: 8 }}
                  />
                ) : (
                  <ListItemText primary={entry.name} />
                )}
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={props.onClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Collapsible JSON view of a document. Unmounted while collapsed: status documents change several
 * times per second, stringifying them while nobody looks is wasted work.
 */
export function JsonAccordion({ title, value }: { title: string; value: unknown }) {
  return (
    <Accordion disableGutters variant="outlined" slotProps={{ transition: { unmountOnExit: true } }} sx={{ mt: 1 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2">{title}</Typography>
      </AccordionSummary>
      <AccordionDetails>
        <JsonView value={value} />
      </AccordionDetails>
    </Accordion>
  );
}

function JsonView({ value }: { value: unknown }) {
  const json = useMemo(() => (value ? JSON.stringify(value, null, 2) : "—"), [value]);
  return (
    <Box component="pre" sx={{ m: 0, p: 1, borderRadius: 1, bgcolor: "action.hover", fontFamily: "monospace", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {json}
    </Box>
  );
}
