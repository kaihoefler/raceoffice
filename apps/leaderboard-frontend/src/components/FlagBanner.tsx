// Full-width flag banner: colour + text, FINISH as checkered pattern, YELLOW/RED blink gently.

import { Box, Typography, keyframes } from "@mui/material";

const blink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
`;

const FLAG_STYLES: Record<string, { bg: string; fg: string; label: string; animate?: boolean }> = {
  GREEN: { bg: "#2e7d32", fg: "#fff", label: "GREEN" },
  YELLOW: { bg: "#fbc02d", fg: "#000", label: "YELLOW", animate: true },
  RED: { bg: "#c62828", fg: "#fff", label: "RED", animate: true },
  PURPLE: { bg: "#7b1fa2", fg: "#fff", label: "PURPLE · Startaufstellung" },
  FINISH: { bg: "#000", fg: "#fff", label: "FINISH" },
  NONE: { bg: "#757575", fg: "#fff", label: "—" },
};

export function flagStyle(flag: string | null | undefined) {
  return FLAG_STYLES[String(flag ?? "NONE").toUpperCase()] ?? { bg: "#757575", fg: "#fff", label: String(flag ?? "—") };
}

export function FlagBanner({ flag, children }: { flag: string | null | undefined; children?: React.ReactNode }) {
  const style = flagStyle(flag);
  const finish = String(flag ?? "").toUpperCase() === "FINISH";
  return (
    <Box
      role="banner"
      aria-label={`Flagge ${style.label}`}
      sx={{
        px: 2,
        py: 1,
        display: "flex",
        alignItems: "center",
        gap: 2,
        color: style.fg,
        bgcolor: style.bg,
        ...(finish
          ? {
              backgroundImage: "repeating-conic-gradient(#000 0% 25%, #fff 0% 50%)",
              backgroundSize: "28px 28px",
            }
          : {}),
        ...(style.animate ? { animation: `${blink} 1.6s ease-in-out infinite` } : {}),
      }}
    >
      <Typography
        component="span"
        sx={{
          fontWeight: 800,
          letterSpacing: 1,
          fontSize: "1.1em",
          px: finish ? 1 : 0,
          bgcolor: finish ? "rgba(0,0,0,0.75)" : undefined,
          color: style.fg,
        }}
      >
        {style.label}
      </Typography>
      <Box sx={{ minWidth: 0, flex: 1, ...(finish ? { bgcolor: "rgba(0,0,0,0.75)", px: 1 } : {}) }}>{children}</Box>
    </Box>
  );
}
