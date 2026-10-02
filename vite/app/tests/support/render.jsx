// -----------------------------------------------------------
//  [*] Test support — rendering with the app's providers
//
//  Pages and components are rendered the way App.jsx frames
//  them in production, so nothing in a test is fed a context
//  the real app would not provide:
//
//    QueryClientProvider  — one TanStack client per render,
//                           retries off and no cache kept (the
//                           retry policy of main.jsx is not the
//                           subject of a page test)
//    StyledEngineProvider + ThemeProvider + CssBaseline
//                         — the same MUI stack and theme as
//                           App.jsx
//    MemoryRouter         — for renderPage: starts at `route`,
//                           with the page mounted on the route
//                           PATTERN (`path`) so useParams gives
//                           it its :network / :token
//
//  renderPage puts the frame above around any element;
//  renderApp mounts the REAL App.jsx instead — its own
//  BrowserRouter, navbar, footer, error boundaries and every
//  route — started at a route through the History API.
//
//  Used by:
//    - every component and page test
// -----------------------------------------------------------

import { Component } from 'react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { StyledEngineProvider } from '@mui/material/styles';
import theme from '@/theme';
import App from '@/App';







// -----------------------------------------------------------
// makeQueryClient
// -----------------------------------------------------------
//
// A client whose failures surface at once: no retries (a page
// under test must show its error state on the first answer),
// zero retry delay for queries that set their own retry count,
// no garbage-collection wait so a test leaves nothing behind.
//
// Used by:
//   - renderPage, renderApp (below)
// -----------------------------------------------------------

export function makeQueryClient(overrides = {}) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0, ...overrides },
      mutations: { retry: false },
    },
  });
}







// -----------------------------------------------------------
// TestErrorBoundary
// -----------------------------------------------------------
//
// Catches a render-time throw of the element under test and
// shows it as "render crashed: <message>" — so a page that
// cannot cope with a backend answer fails its test with the
// real message instead of an unhandled exception from deep
// inside React (contract.js' expectNoCrash reads it).
//
// Used by:
//   - renderPage (below)
// -----------------------------------------------------------

export class TestErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return <div data-testid="render-crashed">render crashed: {String(this.state.error?.message ?? this.state.error)}</div>;
    }
    return this.props.children;
  }
}







// -----------------------------------------------------------
// Providers
// -----------------------------------------------------------
//
// App.jsx's MUI stack around `children`, inside the query
// client.
//
// Used by:
//   - renderPage (below)
// -----------------------------------------------------------

function Providers({ client, children }) {
  return (
    <QueryClientProvider client={client}>
      <StyledEngineProvider injectFirst>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </ThemeProvider>
      </StyledEngineProvider>
    </QueryClientProvider>
  );
}







// -----------------------------------------------------------
// renderPage
// -----------------------------------------------------------
//
// Renders an element inside the production frame (see the
// header) and returns Testing Library's result plus the query
// client and a userEvent instance. The frame is Testing
// Library's `wrapper`, so a rerender keeps it — and the page's
// state — and only swaps the element.
//
// `route` is the memory router's initial entry, "/" unless
// the test names another. `path` is the route pattern the
// element is mounted on, so useParams reads its params from
// the route; without it the element is rendered directly
// inside the router. `client` is a prepared QueryClient — a
// fresh makeQueryClient one otherwise.
//
// Used by:
//   - component and page tests
// -----------------------------------------------------------

export function renderPage(ui, { route = '/', path, client } = {}) {
  const queryClient = client ?? makeQueryClient();
  const user = userEvent.setup();

  const Frame = ({ children }) => (
    <Providers client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <TestErrorBoundary>{children}</TestErrorBoundary>
      </MemoryRouter>
    </Providers>
  );
  const mounted = (element) => (path ? <Routes><Route path={path} element={element} /></Routes> : element);

  const result = render(mounted(ui), { wrapper: Frame });

  return { ...result, rerender: (next) => result.rerender(mounted(next)), queryClient, user };
}







// -----------------------------------------------------------
// renderApp
// -----------------------------------------------------------
//
// The whole application: App.jsx with its own BrowserRouter,
// navbar, footer and error boundaries, the location moved to
// `route` first (history.replaceState — jsdom keeps the
// origin). Only the query client comes from here, as main.jsx
// provides it in production.
//
// Used by:
//   - App / routing / title tests, the route sweep, page
//     smoke tests
// -----------------------------------------------------------

export function renderApp({ route = '/', client } = {}) {
  window.history.replaceState(null, '', route);
  const queryClient = client ?? makeQueryClient();
  const user = userEvent.setup();

  const result = render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );

  return { ...result, queryClient, user };
}
