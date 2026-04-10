import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import App from './App';

/**
 * Light financial theme — inspirowany Bloomberg Terminal / FactSet:
 * - białe tło z lekkim szarym dla paneli
 * - granat dla nagłówków (typowy banking color)
 * - intensywna zieleń/czerwień dla up/down (klasyczne finance)
 * - akcent: petrol blue (głęboki niebieski)
 * - typografia: Inter dla UI, IBM Plex Mono dla liczb
 */
const financialTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1a3a6c',       // granat — banking primary
      light: '#4a6a9c',
      dark: '#0d2547',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#0288d1',       // petrol blue — accent
      light: '#5eb8ff',
      dark: '#005b9f',
    },
    success: {
      main: '#0a8754',       // głęboka zieleń (up)
      light: '#34a374',
      dark: '#065f3a',
    },
    error: {
      main: '#c41e3a',       // głęboka czerwień (down)
      light: '#e0405e',
      dark: '#8a0f23',
    },
    warning: {
      main: '#e8a317',       // złoto/amber (warning, neutral)
      light: '#f5c14e',
      dark: '#b07d0e',
    },
    info: {
      main: '#1a3a6c',
    },
    background: {
      default: '#f5f7fa',    // off-white (typical financial dashboards)
      paper: '#ffffff',      // czyste białe karty
    },
    text: {
      primary: '#1a1a1a',    // prawie czarny dla contrast
      secondary: '#5a6478',  // szary dla labelu
      disabled: '#9aa3b2',
    },
    divider: '#e1e5eb',
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontWeight: 700, letterSpacing: '-0.5px' },
    h2: { fontWeight: 700, letterSpacing: '-0.5px' },
    h3: { fontWeight: 600 },
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    subtitle1: { fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    body1: { fontSize: '0.875rem' },
    body2: { fontSize: '0.8125rem' },
    button: { fontWeight: 600, textTransform: 'none' },
  },
  shape: {
    borderRadius: 4,         // mniejsze niż domyślne (financial = bardziej kanciaste)
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid #e1e5eb',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#1a3a6c',
          color: '#ffffff',
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.08)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          boxShadow: 'none',
          '&:hover': {
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.12)',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid #e1e5eb',
          fontSize: '0.8125rem',
        },
        head: {
          fontWeight: 700,
          color: '#1a3a6c',
          backgroundColor: '#f5f7fa',
          textTransform: 'uppercase',
          fontSize: '0.7rem',
          letterSpacing: '0.5px',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          fontSize: '0.7rem',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          minHeight: 44,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 3,
          backgroundColor: '#0288d1',
        },
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={financialTheme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
