// -----------------------------------------------------------
//  [*] Tests — Footer (the burgundy bottom bar)
//
//  The one copyright line: on its own, the page's contentinfo
//  landmark with nothing interactive in it; inside the App
//  shell, the last thing on every page — after the routed
//  page, also when the page area shows the not-found card.
//  (The route sweep checks it survives every backend failure
//  of every route.)
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import Footer from '@/components/Footer';


const COPYRIGHT = '© VU Kauno fakultetas. Visos teisės saugomos.';

// DOM order is reading order: a before b
const precedes = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);







// -----------------------------------------------------------
// On its own
// -----------------------------------------------------------

describe('Footer', () => {

  it('is the contentinfo landmark carrying the copyright line', () => {
    renderPage(<Footer />);
    expect(screen.getByRole('contentinfo')).toHaveTextContent(COPYRIGHT);
  });


  it('says exactly the copyright line, with nothing to click', () => {
    renderPage(<Footer />);
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent.trim()).toBe(COPYRIGHT);
    expect(within(footer).queryAllByRole('link')).toEqual([]);
    expect(within(footer).queryAllByRole('button')).toEqual([]);
  });
});







// -----------------------------------------------------------
// In the App shell
// -----------------------------------------------------------

describe('Footer in the App shell', () => {

  it('closes the page: one footer, after the page area', async () => {
    renderApp({ route: '/presentations' });
    const footer = await screen.findByRole('contentinfo');
    expect(footer).toHaveTextContent(COPYRIGHT);
    expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
    expect(precedes(screen.getByRole('main'), footer)).toBe(true);
  });


  it('stays under the not-found card too', async () => {
    renderApp({ route: '/no/such/page' });
    expect(await screen.findByText('Tokio puslapio nėra.')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent(COPYRIGHT);
  });
});
