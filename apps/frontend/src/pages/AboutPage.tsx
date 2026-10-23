// src/pages/AboutPage.tsx
import { Stack, Typography } from "@mui/material";

import { APP_VERSION, BUILD_TIME } from "../buildInfo";

export default function AboutPage() {
  return (
    <Stack spacing={1}>
      <Typography variant="h4">About</Typography>
      <Typography>Version: {APP_VERSION}</Typography>
      <Typography color="text.secondary">Build: {new Date(BUILD_TIME).toLocaleString()}</Typography>
    </Stack>
  );
}
