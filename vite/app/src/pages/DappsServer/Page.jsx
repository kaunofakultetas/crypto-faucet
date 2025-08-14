import React from 'react';
import { Box, Button } from '@mui/material';
import PlayCircleFilledWhiteIcon from '@mui/icons-material/PlayCircleFilledWhite';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';

export default function DappsServerPage() {
  return (
    <Box className="flex items-center justify-center min-h-[calc(100vh-105px)]">
      <Box className="flex flex-wrap gap-12 justify-center">
        <Button
          href="/dapps/hosting"
          variant="contained"
          color="primary"
          className="h-60 w-96 rounded-lg shadow-md hover:shadow-lg flex flex-col items-center justify-center gap-4 normal-case"
          sx={{ fontSize: '20px', fontWeight: 600 }}
        >
          <PlayCircleFilledWhiteIcon sx={{ fontSize: 60 }} />
          <span className="text-center leading-tight text-white">
            DAPPS Applikacijos <br /> Paleidimas
          </span>
        </Button>

        <Button
          href="/dapps/files"
          variant="contained"
          color="primary"
          className="h-60 w-96 rounded-lg shadow-md hover:shadow-lg flex flex-col items-center justify-center gap-4 normal-case"
          sx={{ fontSize: '20px', fontWeight: 600 }}
        >
          <SettingsApplicationsIcon sx={{ fontSize: 60 }} />
          <span className="text-center leading-tight text-white">
            DAPPS Applikacijos <br /> Redagavimas
          </span>
        </Button>
      </Box>
    </Box>
  );
}