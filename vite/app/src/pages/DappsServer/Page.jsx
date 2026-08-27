// -----------------------------------------------------------
//  [*] Pages — Dapps Server (route /dapps-server)
//
//  A launcher of two big buttons, both opening the DAPPS
//  server tools in a new tab: /dapps/hosting runs the
//  application, /dapps/files edits its files. Both paths are
//  served outside the SPA — hence plain href links instead of
//  router navigation.
//
//  KNOWN EXPOSURE, an ingress decision rather than this
//  page's: both tools sit on the faucet's OWN origin behind
//  the shared class password, and the CSP is off for them
//  (endpoint/Caddyfile), so a page a student uploads runs as
//  the faucet app — with the class cookie, against every
//  claim endpoint. Containing it means serving the hosting
//  from its own origin (a separate site block) and pointing
//  the first button there absolutely.
//
//  Styling note: the buttons' text case is set in sx, not a
//  Tailwind class — MUI's emotion rules are unlayered and
//  beat Tailwind v4's layered utilities on the same element.
// -----------------------------------------------------------

import { Box, Button } from '@mui/material';
import PlayCircleFilledWhiteIcon from '@mui/icons-material/PlayCircleFilledWhite';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';







// -----------------------------------------------------------
// DappsServerPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — route /dapps-server (imported as
//     DappsServerPage)
// -----------------------------------------------------------

export default function DappsServerPage() {
  return (
    <Box className="flex flex-1 items-center justify-center">
      <Box className="flex flex-wrap gap-12 justify-center">

        {/* Run the DAPPS application */}
        <Button
          href="/dapps/hosting"
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          color="primary"
          className="h-60 w-96 rounded-lg shadow-md hover:shadow-lg flex flex-col items-center justify-center gap-4"
          sx={{ fontSize: '20px', fontWeight: 600, textTransform: 'none' }}
        >
          <PlayCircleFilledWhiteIcon sx={{ fontSize: 60 }} />
          <span className="text-center leading-tight text-white">
            DAPPS Aplikacijos <br /> Paleidimas
          </span>
        </Button>

        {/* Edit the DAPPS application files */}
        <Button
          href="/dapps/files"
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          color="primary"
          className="h-60 w-96 rounded-lg shadow-md hover:shadow-lg flex flex-col items-center justify-center gap-4"
          sx={{ fontSize: '20px', fontWeight: 600, textTransform: 'none' }}
        >
          <SettingsApplicationsIcon sx={{ fontSize: 60 }} />
          <span className="text-center leading-tight text-white">
            DAPPS Aplikacijos <br /> Redagavimas
          </span>
        </Button>

      </Box>
    </Box>
  );
}
