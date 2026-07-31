// -----------------------------------------------------------
//  [*] Pages — Dapps Server (route /dapps-server)
//
//  A launcher of two big buttons, both opening the DAPPS
//  server tools in a new tab: /dapps/hosting runs the
//  application, /dapps/files edits its files. Both paths are
//  served outside the SPA — hence plain href links instead of
//  router navigation.
// -----------------------------------------------------------

import { Box, Button } from '@mui/material';
import PlayCircleFilledWhiteIcon from '@mui/icons-material/PlayCircleFilledWhite';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';







// -----------------------------------------------------------
// DappsServerPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - main.jsx — route /dapps-server (imported as
//     DappsServerPage)
// -----------------------------------------------------------

export default function DappsServerPage() {
  return (
    <Box className="flex items-center justify-center min-h-[calc(100vh-105px)]">
      <Box className="flex flex-wrap gap-12 justify-center">

        {/* Run the DAPPS application */}
        <Button
          href="/dapps/hosting"
          target="_blank"
          rel="noopener noreferrer"
          variant="contained"
          color="primary"
          className="h-60 w-96 rounded-lg shadow-md hover:shadow-lg flex flex-col items-center justify-center gap-4 normal-case"
          sx={{ fontSize: '20px', fontWeight: 600 }}
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
          className="h-60 w-96 rounded-lg shadow-md hover:shadow-lg flex flex-col items-center justify-center gap-4 normal-case"
          sx={{ fontSize: '20px', fontWeight: 600 }}
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
