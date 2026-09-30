// -----------------------------------------------------------
//  [*] Tests — UniversalModal (the shared dialog)
//
//  The dialog on its own inside the production frame — the
//  component the tracer's suite covers, ported with its
//  Lithuanian texts: its naming (aria-labelledby /
//  -describedby only when a title / description exists), the
//  variants' icons and confirm colours, the stock Patvirtinti
//  / Atšaukti pair against custom actions, the loading state,
//  the awaited async onConfirm (a rejection keeps it open),
//  closeOnConfirm and closeOnBackdropClick, the dirty guard's
//  "Atmesti pakeitimus?" alertdialog, the Enter-submit rules,
//  closeRef, the sizing props, and the flights' timing under
//  fake timers (400 ms; instant under reduced motion) — the
//  return flight played for every way a dialog closes, the
//  consumer flipping `open` itself included.
// -----------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import { renderPage } from '../support/render';
import { settle } from '../support/backend/contract';
import { mediaQueryMatches } from '../support/setup';
import UniversalModal from '@/components/UniversalModal';


const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';


// Flights are 0 ms under reduced motion — the dialogs open and
// close at once; the timing itself has its own tests below
beforeEach(() => {
  mediaQueryMatches(REDUCED_MOTION);
});







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// The backdrop is the Modal root's first child (aria-hidden,
// no role) — a click on it is what MUI reports as
// 'backdropClick'.
// -----------------------------------------------------------

const dialog = (name) => screen.getByRole('dialog', { name });

const backdropOf = (dialogEl) => dialogEl.parentElement.querySelector('.MuiBackdrop-root');

const confirmButton = () => screen.getByRole('button', { name: 'Patvirtinti' });
const cancelButton = () => screen.getByRole('button', { name: 'Atšaukti' });
const crossOf = (dialogEl) => within(dialogEl).getByRole('button', { name: 'Uždaryti' });







// -----------------------------------------------------------
// Naming and content
// -----------------------------------------------------------

describe('UniversalModal naming and content', () => {

  it('is a modal dialog named by its title and described by its description, with the body inside', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="Transakcija" description="Įvestys ir išvestys"><p>turinys</p></UniversalModal>);
    const box = dialog('Transakcija');
    expect(box).toHaveAttribute('aria-modal', 'true');
    expect(box).toHaveAccessibleDescription('Įvestys ir išvestys');
    expect(within(box).getByRole('heading', { level: 2, name: 'Transakcija' })).toBeInTheDocument();
    expect(within(box).getByText('turinys')).toBeInTheDocument();
    expect(crossOf(box)).toBeInTheDocument();
  });


  it('emits no aria-labelledby without a title and no aria-describedby without a description', () => {
    renderPage(<UniversalModal open onClose={() => {}}><p>be antraštės</p></UniversalModal>);
    const box = screen.getByRole('dialog');
    expect(box).not.toHaveAttribute('aria-labelledby');
    expect(box).not.toHaveAttribute('aria-describedby');
    expect(within(box).queryByRole('heading')).toBeNull();
  });


  it('a title alone names the dialog and describes nothing', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="Tik antraštė" />);
    const box = dialog('Tik antraštė');
    expect(box).not.toHaveAttribute('aria-describedby');
  });


  it('gives two dialogs on screen ids of their own', () => {
    renderPage(
      <>
        <UniversalModal open onClose={() => {}} title="Pirmas" description="pirmo aprašas" />
        <UniversalModal open onClose={() => {}} title="Antras" description="antro aprašas" />
      </>
    );
    const [first, second] = screen.getAllByRole('dialog', { hidden: true });
    expect(first.getAttribute('aria-labelledby')).not.toBe(second.getAttribute('aria-labelledby'));
    expect(first.getAttribute('aria-describedby')).not.toBe(second.getAttribute('aria-describedby'));
  });


  it('renders nothing while closed', () => {
    renderPage(<UniversalModal open={false} onClose={() => {}} title="Paslėptas" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });


  it('the close button can be hidden', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="Be kryželio" showCloseButton={false} />);
    expect(within(dialog('Be kryželio')).queryByRole('button', { name: 'Uždaryti' })).toBeNull();
  });


  it('speaks Lithuanian by default: Patvirtinti, Atšaukti and the close button', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="Langas" />);
    const box = dialog('Langas');
    expect(within(box).getByRole('button', { name: 'Patvirtinti' })).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Atšaukti' })).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: 'Uždaryti' })).toBeInTheDocument();
  });
});







// -----------------------------------------------------------
// Variants
// -----------------------------------------------------------
//
// The header icon and the confirm button's colour per
// variant — the colour has no accessible handle, MUI's colour
// class is the witness.
// -----------------------------------------------------------

describe('UniversalModal variants', () => {

  it.each([
    ['danger', 'ErrorOutlineIcon', 'MuiButton-colorError'],
    ['warning', 'WarningAmberIcon', 'MuiButton-colorWarning'],
    ['info', 'InfoOutlinedIcon', 'MuiButton-colorInfo'],
    ['success', 'CheckCircleOutlineIcon', 'MuiButton-colorSuccess'],
  ])('%s shows its icon and colours the confirm button', (variant, icon, colorClass) => {
    renderPage(<UniversalModal open onClose={() => {}} title="V" variant={variant} />);
    expect(within(dialog('V')).getByTestId(icon)).toBeInTheDocument();
    expect(confirmButton()).toHaveClass(colorClass);
  });


  it('the default variant (and an unknown one) has no icon and a primary confirm button', () => {
    const icons = ['ErrorOutlineIcon', 'WarningAmberIcon', 'InfoOutlinedIcon', 'CheckCircleOutlineIcon'];
    const { unmount } = renderPage(<UniversalModal open onClose={() => {}} title="D" />);
    expect(icons.some((icon) => screen.queryByTestId(icon))).toBe(false);
    expect(confirmButton()).toHaveClass('MuiButton-colorPrimary');
    unmount();

    renderPage(<UniversalModal open onClose={() => {}} title="U" variant="nesamonė" />);
    expect(icons.some((icon) => screen.queryByTestId(icon))).toBe(false);
    expect(confirmButton()).toHaveClass('MuiButton-colorPrimary');
  });
});







// -----------------------------------------------------------
// Actions
// -----------------------------------------------------------

describe('UniversalModal actions', () => {

  it('offers the stock Patvirtinti and Atšaukti pair by default, with custom texts when given', () => {
    const { unmount } = renderPage(<UniversalModal open onClose={() => {}} title="A" />);
    expect(confirmButton()).toBeInTheDocument();
    expect(cancelButton()).toBeInTheDocument();
    unmount();

    renderPage(<UniversalModal open onClose={() => {}} title="B" confirmText="Išsaugoti" cancelText="Atgal" />);
    expect(screen.getByRole('button', { name: 'Išsaugoti' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atgal' })).toBeInTheDocument();
  });


  it('custom actions replace the stock pair', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="C" actions={<button type="button">Savas mygtukas</button>} />);
    const box = dialog('C');
    expect(within(box).getByRole('button', { name: 'Savas mygtukas' })).toBeInTheDocument();
    expect(within(box).queryByRole('button', { name: 'Patvirtinti' })).toBeNull();
    expect(within(box).queryByRole('button', { name: 'Atšaukti' })).toBeNull();
  });


  it('showCancel / showConfirm hide each stock button; both off leaves only the close cross', () => {
    const { unmount } = renderPage(<UniversalModal open onClose={() => {}} title="S" showCancel={false} />);
    expect(confirmButton()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atšaukti' })).toBeNull();
    unmount();

    renderPage(<UniversalModal open onClose={() => {}} title="T" showCancel={false} showConfirm={false} />);
    expect(within(dialog('T')).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Uždaryti']);
  });


  it('Patvirtinti runs onConfirm and then closes; Atšaukti runs onCancel and closes without asking', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const onClose = vi.fn();
    const { user, unmount } = renderPage(<UniversalModal open onClose={onClose} onConfirm={onConfirm} onCancel={onCancel} title="Klausimas" dirty />);
    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onCancel).not.toHaveBeenCalled();
    unmount();

    const onClose2 = vi.fn();
    const second = renderPage(<UniversalModal open onClose={onClose2} onCancel={onCancel} title="Klausimas" dirty />);
    await second.user.click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose2).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });


  it('Atšaukti closes without an onCancel, and Patvirtinti without an onConfirm', async () => {
    const onClose = vi.fn();
    const { user, unmount } = renderPage(<UniversalModal open onClose={onClose} title="Be tvarkyklių" />);
    await user.click(cancelButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    unmount();

    const onClose2 = vi.fn();
    const second = renderPage(<UniversalModal open onClose={onClose2} title="Be tvarkyklių" />);
    await second.user.click(confirmButton());
    await waitFor(() => expect(onClose2).toHaveBeenCalledTimes(1));
  });


  it('confirmDisabled greys out Patvirtinti only', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="A" confirmDisabled />);
    expect(confirmButton()).toBeDisabled();
    expect(cancelButton()).toBeEnabled();
  });


  it('loading disables both buttons and spins inside Patvirtinti', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="A" loading />);
    expect(confirmButton()).toBeDisabled();
    expect(cancelButton()).toBeDisabled();
    expect(within(confirmButton()).getByRole('progressbar')).toBeInTheDocument();
  });


  it('awaits an async onConfirm before closing', async () => {
    let finish;
    const onConfirm = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const onClose = vi.fn();
    const { user } = renderPage(<UniversalModal open onClose={onClose} onConfirm={onConfirm} title="Laukti" />);
    await user.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await settle(50);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog('Laukti')).toBeInTheDocument();

    await act(async () => { finish(); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });


  it('a rejected onConfirm keeps the dialog open for another try', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('409'));
    const onClose = vi.fn();
    const { user } = renderPage(<UniversalModal open onClose={onClose} onConfirm={onConfirm} title="Dar kartą" />);
    await user.click(confirmButton());
    await settle(50);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog('Dar kartą')).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });


  it('closeOnConfirm=false runs onConfirm and stays open', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const { user } = renderPage(<UniversalModal open onClose={onClose} onConfirm={onConfirm} title="Lieka" closeOnConfirm={false} />);
    await user.click(confirmButton());
    await settle(50);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog('Lieka')).toBeInTheDocument();
  });


  it('closeRef hands the consumer the animated close; calling it twice still closes once', async () => {
    const onClose = vi.fn();
    const closeRef = { current: null };
    renderPage(<UniversalModal open onClose={onClose} closeRef={closeRef} title="Nuoroda" />);
    expect(typeof closeRef.current).toBe('function');
    act(() => {
      closeRef.current();
      closeRef.current();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await settle(50);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});







// -----------------------------------------------------------
// Dismissal and the dirty guard
// -----------------------------------------------------------

describe('UniversalModal dismissal', () => {

  it('the backdrop, Escape and the cross each close a clean dialog', async () => {
    const onClose = vi.fn();
    const { unmount } = renderPage(<UniversalModal open onClose={onClose} title="Švarus" />);
    fireEvent.click(backdropOf(dialog('Švarus')));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    unmount();

    const onClose2 = vi.fn();
    const second = renderPage(<UniversalModal open onClose={onClose2} title="Švarus" />);
    await second.user.keyboard('{Escape}');
    await waitFor(() => expect(onClose2).toHaveBeenCalledTimes(1));
    second.unmount();

    const onClose3 = vi.fn();
    const third = renderPage(<UniversalModal open onClose={onClose3} title="Švarus" />);
    await third.user.click(crossOf(dialog('Švarus')));
    await waitFor(() => expect(onClose3).toHaveBeenCalledTimes(1));
  });


  it('closeOnBackdropClick=false ignores the backdrop but Escape still closes', async () => {
    const onClose = vi.fn();
    const { user } = renderPage(<UniversalModal open onClose={onClose} title="Lipnus" closeOnBackdropClick={false} />);
    fireEvent.click(backdropOf(dialog('Lipnus')));
    await settle(50);
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });


  it('a dirty body asks before an implicit dismissal — backdrop, Escape and the cross — and "Tęsti redagavimą" keeps it', async () => {
    const onClose = vi.fn();
    const { user } = renderPage(<UniversalModal open onClose={onClose} title="Pakeista" dirty><input aria-label="Vardas" /></UniversalModal>);

    fireEvent.click(backdropOf(dialog('Pakeista')));
    const prompt = await screen.findByRole('alertdialog', { name: 'Atmesti pakeitimus?' });
    expect(prompt).toHaveAttribute('aria-modal', 'true');
    expect(prompt).toHaveAccessibleDescription('Viskas, kas įvesta šiame lange, bus prarasta.');
    const keep = within(prompt).getByRole('button', { name: 'Tęsti redagavimą' });
    expect(keep).toHaveFocus();
    await user.click(keep);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(dialog('Pakeista')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await screen.findByRole('alertdialog');
    // Escape on the prompt means "keep editing" — it never reaches the dialog
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(dialog('Pakeista')).toBeInTheDocument();

    await user.click(crossOf(dialog('Pakeista')));
    await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();
  });


  it('a click on the prompt\'s own backdrop keeps editing too', async () => {
    const onClose = vi.fn();
    const { user } = renderPage(<UniversalModal open onClose={onClose} title="Pakeista" dirty />);
    await user.keyboard('{Escape}');
    const prompt = await screen.findByRole('alertdialog');
    fireEvent.click(backdropOf(prompt));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(dialog('Pakeista')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });


  it('"Atmesti" on the prompt is the real close', async () => {
    const onClose = vi.fn();
    const { user } = renderPage(<UniversalModal open onClose={onClose} title="Pakeista" dirty />);
    await user.keyboard('{Escape}');
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'Atmesti' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });


  it('a dirty body with closeOnBackdropClick=false ignores the backdrop without asking', async () => {
    const onClose = vi.fn();
    renderPage(<UniversalModal open onClose={onClose} title="Pakeista" dirty closeOnBackdropClick={false} />);
    fireEvent.click(backdropOf(dialog('Pakeista')));
    await settle(50);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});







// -----------------------------------------------------------
// Enter submits
// -----------------------------------------------------------
//
// The form contract: Enter in a single-line text input runs
// onSubmit (or the stock confirm), and nothing else does.
// fireEvent returns false when the handler prevented the
// default — the Enter was consumed.
// -----------------------------------------------------------

describe('UniversalModal Enter-submit', () => {

  const Form = (props) => (
    <UniversalModal open onClose={() => {}} title="Forma" actions={<button type="button">Išsaugoti</button>} {...props}>
      <input aria-label="Vardas" type="text" />
      <input aria-label="El. paštas" type="email" />
      <input aria-label="Kiekis" type="number" />
      <input aria-label="Paieška" type="search" />
      <textarea aria-label="Pastabos" />
      <input aria-label="Sutinku" type="checkbox" />
      <input aria-label="Saugomas" type="text" onKeyDown={(e) => e.preventDefault()} />
    </UniversalModal>
  );


  it('Enter in a text, email, number or search input runs onSubmit once each and is consumed', () => {
    const onSubmit = vi.fn();
    renderPage(<Form onSubmit={onSubmit} />);
    for (const label of ['Vardas', 'El. paštas', 'Kiekis', 'Paieška']) {
      expect(fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' }), label).toBe(false);
    }
    expect(onSubmit).toHaveBeenCalledTimes(4);
  });


  it('Enter in a textarea, a checkbox or a button submits nothing', () => {
    const onSubmit = vi.fn();
    renderPage(<Form onSubmit={onSubmit} />);
    expect(fireEvent.keyDown(screen.getByLabelText('Pastabos'), { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(screen.getByLabelText('Sutinku'), { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Išsaugoti' }), { key: 'Enter' })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });


  it('an Enter already handled (defaultPrevented), with a modifier or mid-composition is left alone', () => {
    const onSubmit = vi.fn();
    renderPage(<Form onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByLabelText('Saugomas'), { key: 'Enter' });
    const name = screen.getByLabelText('Vardas');
    fireEvent.keyDown(name, { key: 'Enter', shiftKey: true });
    fireEvent.keyDown(name, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(name, { key: 'Enter', altKey: true });
    fireEvent.keyDown(name, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(name, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(name, { key: 'a' });
    expect(onSubmit).not.toHaveBeenCalled();
  });


  it('submitDisabled and loading block the submit', () => {
    const onSubmit = vi.fn();
    const { unmount } = renderPage(<Form onSubmit={onSubmit} submitDisabled />);
    expect(fireEvent.keyDown(screen.getByLabelText('Vardas'), { key: 'Enter' })).toBe(true);
    unmount();

    renderPage(<Form onSubmit={onSubmit} loading />);
    fireEvent.keyDown(screen.getByLabelText('Vardas'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });


  it('with the stock buttons and no onSubmit, Enter confirms — unless Patvirtinti is disabled', () => {
    const onConfirm = vi.fn();
    const { unmount } = renderPage(
      <UniversalModal open onClose={() => {}} title="Standartinis" onConfirm={onConfirm}><input aria-label="Vardas" type="text" /></UniversalModal>
    );
    fireEvent.keyDown(screen.getByLabelText('Vardas'), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    unmount();

    renderPage(
      <UniversalModal open onClose={() => {}} title="Standartinis" onConfirm={onConfirm} confirmDisabled><input aria-label="Vardas" type="text" /></UniversalModal>
    );
    fireEvent.keyDown(screen.getByLabelText('Vardas'), { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });


  it('onSubmit wins over the stock confirm, and runs even while Patvirtinti is disabled', () => {
    const onSubmit = vi.fn();
    const onConfirm = vi.fn();
    renderPage(
      <UniversalModal open onClose={() => {}} title="Abu" onSubmit={onSubmit} onConfirm={onConfirm} confirmDisabled>
        <input aria-label="Vardas" type="text" />
      </UniversalModal>
    );
    fireEvent.keyDown(screen.getByLabelText('Vardas'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });


  it('with custom actions and no onSubmit, or with Patvirtinti hidden, Enter does nothing', () => {
    const onConfirm = vi.fn();
    const { unmount } = renderPage(<Form onConfirm={onConfirm} />);
    expect(fireEvent.keyDown(screen.getByLabelText('Vardas'), { key: 'Enter' })).toBe(true);
    unmount();

    renderPage(
      <UniversalModal open onClose={() => {}} title="Be patvirtinimo" onConfirm={onConfirm} showConfirm={false}><input aria-label="Vardas" type="text" /></UniversalModal>
    );
    expect(fireEvent.keyDown(screen.getByLabelText('Vardas'), { key: 'Enter' })).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});







// -----------------------------------------------------------
// Sizing and styling
// -----------------------------------------------------------
//
// The paper's box is an sx rule — the computed style is the
// witness.
// -----------------------------------------------------------

describe('UniversalModal sizing', () => {

  it('sizes to its content by default: at most 500 px wide, at least 300 px, at most 90 % of the screen high', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="Dydis" />);
    const style = getComputedStyle(dialog('Dydis'));
    expect(style.width).toBe('auto');
    expect(style.maxWidth).toBe('500px');
    expect(style.minWidth).toBe('300px');
    // 90vh of jsdom's 768 px window
    expect(style.maxHeight).toBe('691.2px');
    expect(style.overflow).toBe('auto');
  });


  it('maxWidth widens it and fullWidth stretches it to 90 % of the screen', () => {
    renderPage(<UniversalModal open onClose={() => {}} title="Platus" maxWidth={900} fullWidth />);
    const style = getComputedStyle(dialog('Platus'));
    expect(style.maxWidth).toBe('900px');
    expect(style.width).toBe('90%');
  });


  it('the caller\'s sx has the last word on the paper, contentSx on the body', () => {
    renderPage(
      <UniversalModal open onClose={() => {}} title="Savas" sx={{ maxWidth: 1100 }} contentSx={{ padding: '7px' }}>
        <p>kūnas</p>
      </UniversalModal>
    );
    expect(getComputedStyle(dialog('Savas')).maxWidth).toBe('1100px');
    expect(getComputedStyle(screen.getByText('kūnas').parentElement).padding).toBe('7px');
  });
});







// -----------------------------------------------------------
// Flight timing
// -----------------------------------------------------------
//
// The return flight is FLIGHT_MS (400) long and onClose fires
// only after it; reduced motion makes it instant. The timing
// windows run under fake timers — a loaded machine stretches
// a real 400 ms window unpredictably — with the clicks and
// keys dispatched directly (userEvent would wait on the faked
// clock). Three consumer patterns: the dialog UNMOUNTED in
// onClose (UnmountingHost); kept mounted with `open` flipped
// in onClose (FlippingHost); `open` flipped by the consumer's
// own control, no onClose involved (ExternalHost).
// -----------------------------------------------------------

describe('UniversalModal flight timing', () => {

  function UnmountingHost({ onClose }) {
    const [open, setOpen] = useState(true);
    return open ? <UniversalModal open onClose={() => { onClose(); setOpen(false); }} title="Skrydis" /> : <p>uždaryta</p>;
  }

  function FlippingHost({ onClose }) {
    const [open, setOpen] = useState(true);
    return <UniversalModal open={open} onClose={() => { onClose(); setOpen(false); }} title="Skrydis" />;
  }

  function ExternalHost() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(false)}>uždaryti iš išorės</button>
        <UniversalModal open={open} onClose={() => setOpen(false)} title="Skrydis" />
      </>
    );
  }


  // setTimeout carries the flight and the unmount, the
  // animation frames the entry pose
  const FLIGHT_TIMERS = ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'];

  const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });


  it('without reduced motion onClose fires exactly 400 ms after Atšaukti, the dialog flying back until then', () => {
    mediaQueryMatches(REDUCED_MOTION, false);
    vi.useFakeTimers({ toFake: FLIGHT_TIMERS });
    const onClose = vi.fn();
    renderPage(<UnmountingHost onClose={onClose} />);
    // the entry flight lands first
    advance(1000);

    fireEvent.click(cancelButton());
    advance(399);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog('Skrydis')).toBeInTheDocument();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('uždaryta')).toBeInTheDocument();
  });


  it('under reduced motion onClose fires at once', () => {
    vi.useFakeTimers({ toFake: FLIGHT_TIMERS });
    const onClose = vi.fn();
    renderPage(<UnmountingHost onClose={onClose} />);
    advance(0);

    fireEvent.click(cancelButton());
    // a 0 ms flight: due on the very next timer turn, no time passing
    advance(0);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });


  it('a second close request during the flight is ignored: onClose fires once, still at 400 ms', () => {
    mediaQueryMatches(REDUCED_MOTION, false);
    vi.useFakeTimers({ toFake: FLIGHT_TIMERS });
    const onClose = vi.fn();
    renderPage(<UnmountingHost onClose={onClose} />);
    advance(1000);

    fireEvent.click(cancelButton());
    advance(100);
    fireEvent.click(crossOf(dialog('Skrydis')));
    advance(100);
    fireEvent.keyDown(dialog('Skrydis'), { key: 'Escape' });
    // neither request restarted the flight: it lands 400 ms after Atšaukti
    advance(199);
    expect(onClose).not.toHaveBeenCalled();
    advance(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    advance(1000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });


  it('a consumer flipping `open` off itself still gets the return flight: the dialog leaves 400 ms later', () => {
    mediaQueryMatches(REDUCED_MOTION, false);
    vi.useFakeTimers({ toFake: FLIGHT_TIMERS });
    renderPage(<ExternalHost />);
    advance(1000);

    fireEvent.click(screen.getByText('uždaryti iš išorės'));
    advance(399);
    expect(screen.getByRole('dialog', { hidden: true, name: 'Skrydis' })).toBeInTheDocument();
    advance(1);
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });


  it('a modal kept mounted and closed by flipping `open` gets exactly one onClose from Atšaukti', async () => {
    const onClose = vi.fn();
    const { user } = renderPage(<FlippingHost onClose={onClose} />);
    await user.click(cancelButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await settle(100);
    expect(onClose).toHaveBeenCalledTimes(1);
  });


  it('a modal kept mounted and closed by flipping `open` in onClose leaves the DOM after the flight', async () => {
    const onClose = vi.fn();
    const { user } = renderPage(<FlippingHost onClose={onClose} />);
    await user.click(cancelButton());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 1500 });
  });


  it('flipping `open` back to true reopens a modal the same consumer closed', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>atidaryti</button>
          <UniversalModal open={open} onClose={() => setOpen(false)} title="Vėl" />
        </>
      );
    }
    const { user } = renderPage(<Host />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'atidaryti' }));
    expect(await screen.findByRole('dialog', { name: 'Vėl' })).toBeInTheDocument();

    await user.click(cancelButton());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'atidaryti' }));
    expect(await screen.findByRole('dialog', { name: 'Vėl' })).toBeInTheDocument();
  });


  it('grows out of the screen centre: it starts transparent and slightly small, then lands', () => {
    mediaQueryMatches(REDUCED_MOTION, false);
    vi.useFakeTimers({ toFake: FLIGHT_TIMERS });
    renderPage(<UniversalModal open onClose={() => {}} title="Centras" />);
    const paper = dialog('Centras');
    advance(16);
    expect(getComputedStyle(paper).transform).toBe('scale(0.92)');
    expect(getComputedStyle(paper).opacity).toBe('0');
    advance(16);
    expect(getComputedStyle(paper).transform).toBe('none');
    expect(getComputedStyle(paper).opacity).toBe('1');
  });


  it('with a sourceRect the paper starts over the trigger, uniformly scaled to it, and lands centred', () => {
    mediaQueryMatches(REDUCED_MOTION, false);
    vi.useFakeTimers({ toFake: FLIGHT_TIMERS });
    // jsdom has no layout — give the paper a 400×300 box
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(300);
    renderPage(<UniversalModal open onClose={() => {}} title="Iš mygtuko" sourceRect={{ left: 10, top: 20, width: 100, height: 30 }} />);
    const paper = dialog('Iš mygtuko');

    // First frame: the start pose. The trigger's centre (60, 35)
    // sits 452 px left of and 349 px above the centre of jsdom's
    // 1024×768 window; the smaller ratio (30/300, not 100/400)
    // keeps the paper's proportions
    advance(16);
    expect(getComputedStyle(paper).transform).toBe('translate(-452px, -349px) scale(0.1)');
    expect(getComputedStyle(paper).opacity).toBe('0');

    // Second frame: released into the resting pose, the flight plays
    advance(16);
    expect(getComputedStyle(paper).transform).toBe('none');
    expect(getComputedStyle(paper).opacity).toBe('1');
  });
});
