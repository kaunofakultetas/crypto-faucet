import React, { useState, useEffect } from 'react';
import { Alert as MuiAlert, AlertProps, styled } from "@mui/material";

const StyledAlert = styled(MuiAlert)(({ theme }) => ({
  marginTop: theme.spacing(2),
  transition: 'opacity 0.5s',
  opacity: 1,
}));

interface ExtendedAlertProps extends AlertProps {
  fadeOut?: boolean;
  duration?: number;
}

export const Alert: React.FC<ExtendedAlertProps> = ({ children, severity, fadeOut = true, duration = 8000 }) => {
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    if (fadeOut) {
      // Start fade out after duration
      timeoutId = setTimeout(() => {
        setOpacity(0);
        // Wait for the transition to finish before setting the component to null
        setTimeout(() => {
          setOpacity(null);
        }, 500); // This matches the transition duration
      }, duration);
    }
    return () => {
      clearTimeout(timeoutId);
    };
  }, [fadeOut, duration]);

  if (opacity === null) {
    return (
      <div style={{height: 50}}></div>
    );
  }

  return <StyledAlert style={{ opacity: opacity }} severity={severity}>{children}</StyledAlert>;
}

export default Alert;