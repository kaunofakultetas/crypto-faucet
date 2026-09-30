// -----------------------------------------------------------
//  [*] Tests — Presentations page (route /presentations)
//
//  The lecture decks catalog, defined in the page's source:
//  one card per deck in catalog order — the burgundy title,
//  the Lithuanian explanation verbatim, the entry's own extra
//  buttons (their labels, links and MUI variants, in their
//  order, above the poster), and the open action: a poster
//  link over the thumbnail with a centred Play badge (named
//  "Atidaryti prezentaciją: <title>", the image itself
//  decorative), the plain "Atidaryti prezentaciją" button
//  hidden while a thumbnail exists. Every link opens the deck
//  in a new tab (the deck is a standalone page outside the
//  SPA) with no opener, never through window.open, and stays
//  inside /served/presentations/. The page asks the backend
//  nothing; the real App titles its tab.
//
//  The catalog as shipped has a thumbnail and contained
//  buttons on every entry, so the card's documented fallbacks
//  — the text-only card with the plain open button, a button
//  without a variant (outlined), an entry without buttons —
//  are exercised on the card component itself, taken from a
//  rendered card (tests/support/teaching/component-of.js).
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { screen, within, waitFor, cleanup } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import { given } from '../support/backend/server';
import { settle } from '../support/backend/contract';
import { componentOf } from '../support/teaching/component-of';
import PresentationsPage from '@/pages/Presentations/Page';


const RBF = {
  title: 'Dvigubo apmokėjimo ataka naudojant Replace by Fee (RBF)',
  description: 'Replace by Fee (RBF) yra mechanizmas, kuris leidžia naudotojams pakeisti transakciją. Šis mechanizmas buvo sukurtas tam, kad kriptovaliutos naudotojai galėtų atnaujinti užstrigusias transakcijas ir pakelti kasėjams mokamą transakcijos mokestį, taip paspartinant transakcijos patvirtinimą blokų grandinėje. Interaktyvi 3D simuliacija žingsnis po žingsnio parodo mokesčių rinką, mempool\'ą, transakcijos pakeitimą ir kaip apsisaugoti nuo dvigubo apmokėjimo atakos.',
  href: '/served/presentations/rbf/rbf.html',
  thumbnail: '/served/presentations/rbf/Thumbnail.png',
};

const FORK = {
  title: 'Blokų grandinės skilimas',
  description: 'Kriptovaliutos grandinės skilimas yra procesas, kai panašiu metu tinkle iškasami du blokai ir abu paskleidžiami visame tinkle. Blokų grandinės dalyviai toliau bando iškasti naują bloką ant to, kurį gavo pirmiau. Kai atrandamas tolimesnis blokas, jis taip pat paskelbiamas visame tinkle, ir tie dalyviai, kurie buvo kitoje atšakoje, persiorientuoja ir tęsia darbus ilgiausioje grandinėje. Interaktyvi 3D simuliacija parodo skilimą, ilgiausios grandinės taisyklę, pasenusius (stale) blokus, reorganizacijas ir 51% ataką.',
  href: '/served/presentations/fork/fork.html',
  thumbnail: '/served/presentations/fork/Thumbnail.png',
};







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// A card is reached through its title (a level-2 heading);
// its content is the heading's parent. The poster is the link
// named after the deck. MUI's Button variant shows only in
// its class — the one handle there is.
// -----------------------------------------------------------

const renderPresentations = () => renderPage(<PresentationsPage />);

const cardOf = (title) => screen.getByRole('heading', { level: 2, name: title }).parentElement;
const posterOf = (title) => screen.getByRole('link', { name: `Atidaryti prezentaciją: ${title}` });

const variantOf = (link) => ['contained', 'outlined', 'text'].find((variant) => link.classList.contains(`MuiButton-${variant}`));

// The card component, taken from a rendered card (see the
// header)
function presentationCard() {
  renderPresentations();
  const Card = componentOf(screen.getByRole('heading', { level: 2, name: FORK.title }), 'PresentationCard');
  cleanup();
  return Card;
}







// -----------------------------------------------------------
// The catalog
// -----------------------------------------------------------
//
// Every deck, its words, its poster, its buttons.
// -----------------------------------------------------------

describe('The catalog', () => {

  it('titles the page "Prezentacijos" and lists one card per deck, in catalog order', () => {
    renderPresentations();
    expect(screen.getByRole('heading', { level: 1, name: 'Prezentacijos' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([RBF.title, FORK.title]);
  });


  it.each([RBF, FORK])('explains each deck in Lithuanian, word for word — $title', (deck) => {
    renderPresentations();
    expect(within(cardOf(deck.title)).getByText(deck.description)).toBeInTheDocument();
  });


  it.each([RBF, FORK])('shows the thumbnail as a poster link to the deck, opening a new tab — $title', (deck) => {
    renderPresentations();
    const poster = posterOf(deck.title);
    expect(poster).toHaveAttribute('href', deck.href);
    expect(poster).toHaveAttribute('target', '_blank');
    expect(poster).toHaveAttribute('rel', 'noopener');
    expect(within(cardOf(deck.title)).getByRole('link', { name: `Atidaryti prezentaciją: ${deck.title}` })).toBe(poster);
  });


  it('the thumbnail is decorative — the link carries the name — with a Play badge centred on it', () => {
    renderPresentations();
    const poster = posterOf(RBF.title);
    const image = within(poster).getByRole('presentation');
    expect(image.tagName).toBe('IMG');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('src', RBF.thumbnail);
    // The badge is an icon — its test id is MUI's own handle
    expect(within(poster).getByTestId('PlayArrowRoundedIcon')).toHaveAttribute('aria-hidden', 'true');
    expect(within(posterOf(FORK.title)).getByRole('presentation')).toHaveAttribute('src', FORK.thumbnail);
    expect(within(posterOf(FORK.title)).getByTestId('PlayArrowRoundedIcon')).toBeInTheDocument();
  });


  it('hides the plain "Atidaryti prezentaciją" button on a card that has a thumbnail', () => {
    renderPresentations();
    expect(screen.queryByRole('link', { name: 'Atidaryti prezentaciją' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Atidaryti prezentaciją' })).toBeNull();
  });


  it('gives the RBF deck its two extra buttons in order — the recorded attack and the deck — both contained', () => {
    renderPresentations();
    const card = cardOf(RBF.title);
    const buttons = within(card).getAllByRole('link').filter((link) => link !== posterOf(RBF.title));
    expect(buttons.map((link) => [link.textContent, link.getAttribute('href'), variantOf(link)])).toEqual([
      ['Atliktos atakos pavyzdys', '/served/presentations/rbf/RBFVideo_vosr2_1440p.mp4', 'contained'],
      ['Prezentacija', '/served/presentations/rbf/rbf.html', 'contained'],
    ]);
  });


  it('gives the fork deck its one extra button — the deck — contained', () => {
    renderPresentations();
    const card = cardOf(FORK.title);
    const buttons = within(card).getAllByRole('link').filter((link) => link !== posterOf(FORK.title));
    expect(buttons.map((link) => [link.textContent, link.getAttribute('href'), variantOf(link)])).toEqual([
      ['Prezentacija', '/served/presentations/fork/fork.html', 'contained'],
    ]);
  });


  it('puts the extra buttons above the poster', () => {
    renderPresentations();
    const [attack] = within(cardOf(RBF.title)).getAllByRole('link', { name: 'Atliktos atakos pavyzdys' });
    const poster = posterOf(RBF.title);
    expect(attack.compareDocumentPosition(poster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });


  it('opens every link in a new tab without an opener, and none leaves /served/presentations/', () => {
    renderPresentations();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(5);
    for (const link of links) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toMatch(/\bnoopener\b/);
      expect(link.getAttribute('href')).toMatch(/^\/served\/presentations\//);
    }
  });


  it('opening a deck is a plain link — no window.open', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { user } = renderPresentations();
    // jsdom cannot open a tab: the navigation itself is stopped
    const stop = (event) => event.preventDefault();
    document.addEventListener('click', stop);
    try {
      await user.click(posterOf(FORK.title));
      await user.click(within(cardOf(RBF.title)).getByRole('link', { name: 'Atliktos atakos pavyzdys' }));
    } finally {
      document.removeEventListener('click', stop);
    }
    expect(open).not.toHaveBeenCalled();
  });


  it('asks the backend nothing — the catalog lives in the page', async () => {
    const calls = given.capture('get', '/api/*');
    renderPresentations();
    await settle(100);
    expect(calls).toEqual([]);
  });


  it('the /presentations route of the real App shows the catalog and titles the tab', async () => {
    renderApp({ route: '/presentations' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Prezentacijos' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Prezentacijos — VU KNF Faucet'as"));
  });
});







// -----------------------------------------------------------
// The card's fallbacks
// -----------------------------------------------------------
//
// What a future catalog entry without a thumbnail, without
// buttons or without a variant gets — the card component
// rendered with such an entry.
// -----------------------------------------------------------

describe('The card\'s fallbacks', () => {

  const DRAFT = {
    title: 'Merkle medžiai',
    description: 'Kaip vienas maišos kodas patvirtina tūkstančius transakcijų.',
    href: '/served/presentations/merkle/merkle.html',
  };


  it('a deck without a thumbnail gets the plain "Atidaryti prezentaciją" button to the deck — no poster, no image', () => {
    const PresentationCard = presentationCard();
    renderPage(<PresentationCard {...DRAFT} />);
    expect(screen.getByRole('heading', { level: 2, name: DRAFT.title })).toBeInTheDocument();
    expect(screen.getByText(DRAFT.description)).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Atidaryti prezentaciją' });
    expect(open).toHaveAttribute('href', DRAFT.href);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener');
    expect(variantOf(open)).toBe('contained');
    expect(screen.queryByRole('presentation')).toBeNull();
    expect(screen.queryByTestId('PlayArrowRoundedIcon')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });


  it('a button without a variant is outlined; the other variants are taken as given', () => {
    const PresentationCard = presentationCard();
    renderPage(
      <PresentationCard
        {...DRAFT}
        buttons={[
          { label: 'Užduotis', href: '/served/presentations/merkle/task.pdf' },
          { label: 'Šaltiniai', href: '/served/presentations/merkle/sources.html', variant: 'text' },
          { label: 'Vaizdo įrašas', href: '/served/presentations/merkle/video.mp4', variant: 'contained' },
        ]}
      />,
    );
    const labelled = (name) => screen.getByRole('link', { name });
    expect(variantOf(labelled('Užduotis'))).toBe('outlined');
    expect(variantOf(labelled('Šaltiniai'))).toBe('text');
    expect(variantOf(labelled('Vaizdo įrašas'))).toBe('contained');
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Užduotis', 'Šaltiniai', 'Vaizdo įrašas', 'Atidaryti prezentaciją']);
    for (const link of screen.getAllByRole('link')) expect(link).toHaveAttribute('target', '_blank');
  });


  it('an empty button list draws no button row — just the open action', () => {
    const PresentationCard = presentationCard();
    renderPage(<PresentationCard {...DRAFT} thumbnail="/served/presentations/merkle/Thumbnail.png" buttons={[]} />);
    expect(screen.getAllByRole('link')).toEqual([screen.getByRole('link', { name: `Atidaryti prezentaciją: ${DRAFT.title}` })]);
  });
});
