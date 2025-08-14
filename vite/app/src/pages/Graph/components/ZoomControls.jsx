import React from 'react'
import Box from '@mui/material/Box'
import Slider from '@mui/material/Slider'
import IconButton from '@mui/material/IconButton'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import { DIMENSIONS } from '../constants'

/**
 * ZoomControls - Floating zoom control panel for the graph
 * 
 * Provides a vertical slider and +/- buttons for controlling graph zoom level.
 * Positioned absolutely in the top-right corner of the graph container.
 * 
 * @param {number} scale - Current zoom scale (0.2 to 2.0)
 * @param {number} min - Minimum zoom scale allowed
 * @param {number} max - Maximum zoom scale allowed  
 * @param {number} step - Step size for slider precision
 * @param {Function} onScaleChange - Handler for slider changes
 * @param {Function} onZoomIn - Handler for zoom in button
 * @param {Function} onZoomOut - Handler for zoom out button
 * @returns {React.Component} The zoom controls component
 */
const ZoomControls = ({
  scale,
  min = 0.2,
  max = 2,
  step = 0.01,
  onScaleChange,
  onZoomIn,
  onZoomOut,
}) => {
  return (
    <Box
      sx={{
        position: 'absolute',
        right: 12,
        top: 12,
        backgroundColor: 'rgba(255,255,255,0.9)',
        border: '1px solid #ddd',
        borderRadius: 2,
        p: 0.5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
      }}
    >
      <IconButton
        size="small"
        onClick={onZoomIn}
        aria-label="Priartinti"
        sx={{
          bgcolor: 'primary.main',
          color: 'common.white',
          '&:hover': { bgcolor: 'primary.dark' },
          width: 24,
          height: 24,
          borderRadius: '50%',
        }}
      >
        <AddIcon fontSize="small" />
      </IconButton>
      <Slider
        orientation="vertical"
        value={scale}
        min={min}
        max={max}
        step={step}
        onChange={(_, value) => onScaleChange(Array.isArray(value) ? value[0] : value)}
        sx={{ height: DIMENSIONS.ZOOM_SLIDER_HEIGHT, mx: 0.5 }}
      />
      <IconButton
        size="small"
        onClick={onZoomOut}
        aria-label="Nutolinti"
        sx={{
          bgcolor: 'primary.main',
          color: 'common.white',
          '&:hover': { bgcolor: 'primary.dark' },
          width: 24,
          height: 24,
          borderRadius: '50%',
        }}
      >
        <RemoveIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

export default ZoomControls


