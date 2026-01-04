// src/ui/AppLayout.tsx
import { AppBar, Box, Container, Toolbar, Typography, Button } from "@mui/material";
import { Link, Outlet } from "react-router-dom";

export default function AppLayout() {
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" >
            Race Result Management
          </Typography>
           {/* left-aligned buttons */}
          <Box sx={{ display: "flex", gap: 1, ml: 2 }}>
            <Button color="inherit" component={Link} to="/">
              Home
            </Button>
            <Button color="inherit" component={Link} to="/events">
              Events
            </Button>
          </Box>
          {/* spacer pushes the next items to the right */}
          <Box sx={{ flexGrow: 1 }} />

          {/* right-aligned button */}          
          <Button color="inherit" component={Link} to="/about">
            About
          </Button>
        </Toolbar>
      </AppBar>

      <Container sx={{ py: 4, flex: 1 }}>
        <Outlet />
      </Container>
    </Box>
  );
}

