import React from 'react';
import { Box } from '@mui/material';
import { SiHackaday } from "react-icons/si";
import { BiWorld } from "react-icons/bi";

const TipIcon = ({ type, position, top }) => {
  const isPublic = type === 'public';
  
  return (
    <Box sx={{ 
      position: 'absolute', 
      top: `${top}px`, 
      left: position, 
      transform: 'translate(-50%, -50%)', 
      width: 40, 
      height: 40, 
      borderRadius: '9999px', 
      backgroundColor: isPublic ? '#2e7d32' : '#c62828', 
      color: '#fff', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      boxShadow: '0 0 0 2px rgba(255,255,255,0.9), 0 2px 6px rgba(0,0,0,0.2)', 
      zIndex: 4, 
      pointerEvents: 'none' 
    }}>
      {isPublic ? <BiWorld size={28} /> : <SiHackaday size={24} />}
    </Box>
  );
};

export default TipIcon;
