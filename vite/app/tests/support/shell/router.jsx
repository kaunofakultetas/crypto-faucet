// -----------------------------------------------------------
//  [*] Test support — where the router is, and moving it
//
//  The shell's components navigate (the navbar's jumps, the
//  picker's rows, the not-found page's links); a test needs to
//  see where a click took the student — the address bar:
//
//    LocationProbe / currentPath — for renderPage (a memory
//                   router): the probe renders the router's
//                   pathname + search where currentPath()
//                   reads it
//    navigateTo   — for renderApp (App's own BrowserRouter):
//                   what the browser's Back / Forward / an
//                   address typed does — the History API plus
//                   the popstate the router listens to
//    goBack       — history.back(), inside act
//
//  Under renderApp the address bar is window.location itself.
//
//  Used by:
//    - components/navbar.test.jsx, faucet-picker.test.jsx
//    - pages/not-found.test.jsx
//    - core/app.test.jsx, core/error-boundary.test.jsx
// -----------------------------------------------------------

import { act, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';







// -----------------------------------------------------------
// LocationProbe / currentPath
// -----------------------------------------------------------
//
//   renderPage(<><Navbar /><LocationProbe /></>, { route })
//   expect(currentPath()).toBe('/faucet/evm/hoodi')
//
// Used by:
//   - the component tests that render with renderPage
// -----------------------------------------------------------

export function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location" hidden>{pathname + search}</output>;
}

export const currentPath = () => screen.getByTestId('location').textContent;







// -----------------------------------------------------------
// navigateTo / goBack
// -----------------------------------------------------------
//
//   await navigateTo('/presentations')   — push + popstate
//   await goBack()                       — history.back()
//
// jsdom delivers history.back()'s popstate on a later task,
// so a test waits for the location after goBack.
//
// Used by:
//   - core/app.test.jsx, core/error-boundary.test.jsx
// -----------------------------------------------------------

export async function navigateTo(path) {
  await act(async () => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
}

export async function goBack() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
