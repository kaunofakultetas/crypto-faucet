import { createTheme } from '@mui/material/styles'

// Central theme tokens
export const tokens = {
  colors: {
    primary: '#78003F',
    primaryHover: '#E64164',
    surface: '#ffffff',
    textBody: '#374151',
  },
  shape: {
    borderRadius: 8,
  },
}

// MUI theme configured to match CSS variable tokens
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: tokens.colors.primary,
      dark: tokens.colors.primaryHover, // Use primaryHover for hover state
      light: '#a60057',
      contrastText: '#ffffff',
    },
    secondary: {
      main: tokens.colors.primaryHover,
    },
    background: {
      default: tokens.colors.surface,
      paper: tokens.colors.surface,
    },
    text: {
      primary: tokens.colors.textBody,
    },
  },
  shape: {
    borderRadius: tokens.shape.borderRadius,
  },
  components: {
    MuiButton: {
      defaultProps: {
        variant: 'contained',
        color: 'primary',
      },
      styleOverrides: {
        contained: {
          '&:hover': {
            backgroundColor: tokens.colors.primaryHover,
          },
        },
      },
    },
  },
})

export default theme


