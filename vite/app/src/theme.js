// -----------------------------------------------------------
//  [*] Theme — the brand colours as an MUI theme
//
//  The brand colours as an MUI theme: burgundy primary with
//  the pink hover, white surfaces, gray-700 body text, 8 px
//  corners, and every Button contained + primary by default.
//  The same colours live as CSS custom properties in
//  index.css for the hand-written Tailwind classes — keep
//  the two in step by hand, nothing links them.
//
//  Split into:
//
//    tokens — the brand colours and corner radius (exported)
//    theme  — the MUI theme built from them (default export)
//
//  Used by:
//    - App.jsx — ThemeProvider
// -----------------------------------------------------------

import { createTheme } from '@mui/material/styles'







// -----------------------------------------------------------
// tokens
// -----------------------------------------------------------
//
// The brand colours and the corner radius in one place, so
// the theme below reads them by name. Exported, though
// nothing imports it at the moment — the CSS side keeps its
// own copy in index.css.
//
// Used by:
//   - theme (below)
// -----------------------------------------------------------

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







// -----------------------------------------------------------
// theme (default export)
// -----------------------------------------------------------
//
// The MUI theme built from the tokens: burgundy primary with
// the pink as its hover shade, white surfaces, gray-700
// text, and every Button contained and primary unless it
// says otherwise — the contained ones turning pink on hover.
//
// Used by:
//   - App.jsx — ThemeProvider
// -----------------------------------------------------------

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
