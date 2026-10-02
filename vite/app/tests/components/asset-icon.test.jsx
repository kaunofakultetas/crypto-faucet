// -----------------------------------------------------------
//  [*] Tests — AssetIcon (a network's or token's mark)
//
//  The mark on its own: the backend's icon as a decorative
//  image of the asked size; without one — or once it failed to
//  load — the round hash-dot, a colour derived from the
//  catalog KEY alone (the same for the same key everywhere,
//  different keys telling apart, a vivid 65 % / 55 % tone, the
//  theme's grey with no key at all); a new icon URL clearing a
//  failed one's latch; the inline placement page titles use.
//  Then the promise of the header in the real App: the picker
//  and the page title show the SAME mark for the same asset,
//  as images and, when the icon file is missing, as dots.
//
//  The dot has no accessible handle — its computed style is
//  the witness (jsdom resolves the HSL to rgb).
// -----------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { renderPage, renderApp } from '../support/render';
import AssetIcon from '@/components/AssetIcon';


// The mark rendered into a named slot of its own render, so
// the test can hold the element whatever it turned out to be
// (an img or a dot) — several renders may share one test.
// New props reach the SAME instance through the host's state
// (a bare rerender would drop renderPage's frame and remount
// the mark, hiding what its latch does)
function MarkHost({ initial, control }) {
  const [props, setProps] = useState(initial);
  control.setProps = setProps;
  return <div data-testid="slot"><AssetIcon {...props} /></div>;
}

const renderMark = (props) => {
  const control = {};
  const view = renderPage(<MarkHost initial={props} control={control} />);
  const mark = () => within(view.container).getByTestId('slot').firstElementChild;
  const rerender = (next) => act(() => control.setProps(next));
  return { mark, rerender };
};

const colourOf = (element) => getComputedStyle(element).backgroundColor;

// A dot's colour — its hue at 65 % saturation and 55 %
// lightness — in rgb: the strongest channel is always 215 and
// the weakest 66, whatever the hue
const channels = (rgb) => rgb.match(/\d+/g).map(Number);







// -----------------------------------------------------------
// The icon
// -----------------------------------------------------------

describe('AssetIcon with an icon', () => {

  it('shows the backend\'s icon as a decorative image of the asked size', () => {
    const { mark } = renderMark({ assetKey: 'sepolia', icon: '/api/icons/evm/sepolia', size: 24 });
    const img = mark();
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', '/api/icons/evm/sepolia');
    expect(img).toHaveAttribute('alt', '');
    expect(getComputedStyle(img).width).toBe('24px');
    expect(getComputedStyle(img).height).toBe('24px');
    expect(getComputedStyle(img).objectFit).toBe('contain');
  });


  it('is 10 px when no size is asked', () => {
    const { mark } = renderMark({ assetKey: 'sepolia', icon: '/api/icons/evm/sepolia' });
    expect(getComputedStyle(mark()).width).toBe('10px');
    expect(getComputedStyle(mark()).height).toBe('10px');
  });


  it('falls back to the key\'s dot when the image fails to load', () => {
    const { mark } = renderMark({ assetKey: 'sepolia', icon: '/api/icons/evm/sepolia', size: 24 });
    const dotColour = colourOf(renderMark({ assetKey: 'sepolia', size: 24 }).mark());

    fireEvent.error(mark());
    expect(mark().tagName).toBe('DIV');
    expect(colourOf(mark())).toBe(dotColour);
    expect(getComputedStyle(mark()).width).toBe('24px');
  });


  it('stays the dot while the failed icon URL stays the same', () => {
    const { mark, rerender } = renderMark({ assetKey: 'sepolia', icon: '/api/icons/evm/sepolia', size: 24 });
    fireEvent.error(mark());
    rerender({ assetKey: 'sepolia', icon: '/api/icons/evm/sepolia', size: 40 });
    expect(mark().tagName).toBe('DIV');
    expect(getComputedStyle(mark()).width).toBe('40px');
  });


  it('tries again when a new icon URL arrives — one failed icon never blanks the next asset', () => {
    const { mark, rerender } = renderMark({ assetKey: 'sepolia', icon: '/api/icons/evm/sepolia', size: 40 });
    fireEvent.error(mark());
    expect(mark().tagName).toBe('DIV');

    // A page title keeps its instance across network switches
    rerender({ assetKey: 'hoodi', icon: '/api/icons/evm/hoodi', size: 40 });
    expect(mark().tagName).toBe('IMG');
    expect(mark()).toHaveAttribute('src', '/api/icons/evm/hoodi');
  });
});







// -----------------------------------------------------------
// The dot
// -----------------------------------------------------------

describe('AssetIcon without an icon', () => {

  it('is a round dot of the asked size', () => {
    const { mark } = renderMark({ assetKey: 'btc4', size: 24 });
    const style = getComputedStyle(mark());
    expect(mark().tagName).toBe('DIV');
    expect(style.width).toBe('24px');
    expect(style.height).toBe('24px');
    expect(style.borderRadius).toBe('50%');
  });


  it('an icon of null is the dot too', () => {
    const { mark } = renderMark({ assetKey: 'btc4', icon: null, size: 24 });
    expect(mark().tagName).toBe('DIV');
  });


  it('colours the same key the same, in every instance', () => {
    const first = colourOf(renderMark({ assetKey: 'solanaDevnet', size: 10 }).mark());
    const second = colourOf(renderMark({ assetKey: 'solanaDevnet', size: 40, inline: true }).mark());
    expect(first).toBe(second);
  });


  it('tells the catalog\'s keys apart by colour', () => {
    const keys = ['sepolia', 'hoodi', 'arbitrumSepolia', 'btc4', 'knf', 'ltc4', 'solanaDevnet', 'suiTestnet', 'LINK', 'FOLD'];
    const colours = keys.map((assetKey) => colourOf(renderMark({ assetKey }).mark()));
    expect(new Set(colours).size).toBe(keys.length);
  });


  it('is always a vivid mid tone — only the hue follows the key', () => {
    for (const assetKey of ['sepolia', 'LINK', 'x', 'Ąžuolas 💾', 'k'.repeat(5000)]) {
      const rgb = channels(colourOf(renderMark({ assetKey }).mark()));
      expect(Math.max(...rgb), assetKey).toBe(215);
      expect(Math.min(...rgb), assetKey).toBe(66);
    }
  });


  it('is the theme\'s neutral grey when there is no key to colour by', () => {
    expect(colourOf(renderMark({}).mark())).toBe('rgb(158, 158, 158)');
    expect(colourOf(renderMark({ assetKey: '' }).mark())).toBe('rgb(158, 158, 158)');
  });
});







// -----------------------------------------------------------
// Placement
// -----------------------------------------------------------
//
// Beside a flex row the mark keeps its size (never squeezed);
// inline in a title it rides the first line, lifted onto the
// capitals' centre, with a gap before the text.
// -----------------------------------------------------------

describe('AssetIcon placement', () => {

  it.each([
    ['the image', { icon: '/api/icons/evm/sepolia' }],
    ['the dot', {}],
  ])('%s never shrinks beside a flex row', (_, props) => {
    const { mark } = renderMark({ assetKey: 'sepolia', size: 20, ...props });
    expect(getComputedStyle(mark()).flex).toBe('0 0 auto');
  });


  it.each([
    ['the image', { icon: '/api/icons/evm/sepolia' }],
    ['the dot', {}],
  ])('%s rides a title\'s first line when inline', (_, props) => {
    const { mark } = renderMark({ assetKey: 'sepolia', size: 40, inline: true, ...props });
    const style = getComputedStyle(mark());
    expect(style.display).toBe('inline-block');
    expect(style.verticalAlign).toBe('middle');
    expect(style.transform).toBe('translateY(-0.1em)');
    expect(style.marginRight).toBe('12px');
  });
});







// -----------------------------------------------------------
// One mark per asset, everywhere
// -----------------------------------------------------------
//
// The EVM faucet page: the navbar picker's trigger (20 px) and
// the page title (40 px) show the same network.
// -----------------------------------------------------------

describe('AssetIcon across the App', () => {

  const marksOfSepolia = async () => {
    const title = await screen.findByRole('heading', { level: 1, name: "Ethereum Sepolia faucet'as" });
    const trigger = await screen.findByRole('button', { name: 'Ethereum Sepolia' });
    return { inTitle: () => title.firstElementChild, inPicker: () => within(trigger).getByText('Ethereum Sepolia').previousElementSibling };
  };


  it('the picker and the page title show the same icon for the same network', async () => {
    renderApp({ route: '/faucet/evm/sepolia' });
    const { inTitle, inPicker } = await marksOfSepolia();
    expect(inTitle()).toHaveAttribute('src', '/api/icons/evm/sepolia');
    expect(inPicker()).toHaveAttribute('src', '/api/icons/evm/sepolia');
  });


  it('with the icon file missing, both fall back to the same dot', async () => {
    renderApp({ route: '/faucet/evm/sepolia' });
    const { inTitle, inPicker } = await marksOfSepolia();
    fireEvent.error(inTitle());
    fireEvent.error(inPicker());
    expect(inTitle().tagName).toBe('DIV');
    expect(inPicker().tagName).toBe('DIV');
    expect(colourOf(inTitle())).toBe(colourOf(inPicker()));
  });
});
