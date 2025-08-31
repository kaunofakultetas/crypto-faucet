import React from 'react';
import { IconButton } from '@mui/material';
import { MdSettings } from "react-icons/md";

const ToggleButton = ({ isPanelOpen, setIsPanelOpen }) => (
  <IconButton
    onClick={() => setIsPanelOpen(!isPanelOpen)}
    sx={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      backgroundColor: 'primary.main',
      color: 'white',
      zIndex: 1001,
      width: 56,
      height: 56,
      '&:hover': {
        backgroundColor: 'primary.dark',
      },
      boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
    }}
  >
    <MdSettings size={28} />
  </IconButton>
);

export default ToggleButton;
