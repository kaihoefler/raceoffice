// src/App.tsx
import { AppBar, Box, Container, Toolbar, Typography, Button } from "@mui/material";

export default function App() {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            My SPA
          </Typography>
          <Button color="inherit">Action</Button>
        </Toolbar>
      </AppBar>

      <Container sx={{ py: 4, flex: 1 }}>
        <Typography variant="h4" gutterBottom>
          Vite + React + TypeScript + MUI
        </Typography>
        <Typography>
          Project is set up. Next step: routing and feature pages.
        </Typography>
      </Container>
    </Box>
  );
}

