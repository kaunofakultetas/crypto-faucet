// -----------------------------------------------------------
//  [*] Tests — DAPPS server launcher (route /dapps-server)
//
//  The two big buttons of the launcher: "DAPPS aplikacijos
//  paleidimas" (/dapps/hosting — runs the student's app) and
//  "DAPPS aplikacijos redagavimas" (/dapps/files — edits its
//  files), in that order, under the "DAPPS serveris" heading.
//  Both are plain links into paths served outside the SPA —
//  a new tab with no opener and no referrer, no router
//  navigation, no window.open — named by their text alone
//  (the icons are decorative). The page asks the backend
//  nothing; the real App titles its tab.
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import { given } from '../support/backend/server';
import { settle } from '../support/backend/contract';
import DappsServerPage from '@/pages/DappsServer/Page';


const RUN = 'DAPPS aplikacijos paleidimas';
const EDIT = 'DAPPS aplikacijos redagavimas';







// -----------------------------------------------------------
// The launcher
// -----------------------------------------------------------
//
// The heading, the two links and where they go.
// -----------------------------------------------------------

describe('The launcher', () => {

  it('shows the "DAPPS serveris" heading and exactly two launch links — run first, edit second', () => {
    renderPage(<DappsServerPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'DAPPS serveris' })).toBeInTheDocument();
    expect(screen.getAllByRole('link').map((link) => link.textContent.replace(/\s+/g, ' ').trim())).toEqual([RUN, EDIT]);
  });


  it('"DAPPS aplikacijos paleidimas" opens the hosting in a new tab, with no opener and no referrer', () => {
    renderPage(<DappsServerPage />);
    const run = screen.getByRole('link', { name: RUN });
    expect(run).toHaveAttribute('href', '/dapps/hosting');
    expect(run).toHaveAttribute('target', '_blank');
    expect(run).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it('"DAPPS aplikacijos redagavimas" opens the file editor in a new tab, with no opener and no referrer', () => {
    renderPage(<DappsServerPage />);
    const edit = screen.getByRole('link', { name: EDIT });
    expect(edit).toHaveAttribute('href', '/dapps/files');
    expect(edit).toHaveAttribute('target', '_blank');
    expect(edit).toHaveAttribute('rel', 'noopener noreferrer');
  });


  it('names each link by its words alone — the icons are decorative', () => {
    renderPage(<DappsServerPage />);
    for (const name of [RUN, EDIT]) {
      const link = screen.getByRole('link', { name });
      const icons = link.querySelectorAll('svg');
      expect(icons).toHaveLength(1);
      expect(icons[0]).toHaveAttribute('aria-hidden', 'true');
    }
    expect(within(screen.getByRole('link', { name: RUN })).getByTestId('PlayCircleFilledWhiteIcon')).toBeInTheDocument();
    expect(within(screen.getByRole('link', { name: EDIT })).getByTestId('SettingsApplicationsIcon')).toBeInTheDocument();
  });


  it('asks the backend nothing', async () => {
    const calls = given.capture('get', '/api/*');
    renderPage(<DappsServerPage />);
    await settle(100);
    expect(calls).toEqual([]);
  });
});







// -----------------------------------------------------------
// In the real App
// -----------------------------------------------------------
//
// The route, the tab title, and links that leave the SPA
// alone: a click neither moves the router nor calls
// window.open.
// -----------------------------------------------------------

describe('In the real App', () => {

  it('/dapps-server shows the launcher and titles the tab "DAPPS serveris"', async () => {
    renderApp({ route: '/dapps-server' });
    expect(await screen.findByRole('heading', { level: 1, name: 'DAPPS serveris' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("DAPPS serveris — VU KNF Faucet'as"));
  });


  it('clicking a launch link leaves the SPA where it is — no router navigation, no window.open', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { user } = renderApp({ route: '/dapps-server' });
    const run = await screen.findByRole('link', { name: RUN });
    // jsdom cannot open a tab: the browser's own navigation is
    // stopped, anything the app does on the click still runs
    const stop = (event) => event.preventDefault();
    document.addEventListener('click', stop);
    try {
      await user.click(run);
      await user.click(screen.getByRole('link', { name: EDIT }));
    } finally {
      document.removeEventListener('click', stop);
    }
    await settle(50);
    expect(window.location.pathname).toBe('/dapps-server');
    expect(screen.getByRole('heading', { level: 1, name: 'DAPPS serveris' })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});
