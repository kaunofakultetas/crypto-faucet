// -----------------------------------------------------------
//  [*] Tests — WalletFlow (the shared wallet flow UI)
//
//  The pieces every faucet page puts around its claim button,
//  each rendered on its own inside the production frame:
//  WalletStepper (the labels in order, the current step for
//  assistive tech, the spoken state words, the icons by
//  position, the per-step overrides, a completed step's check,
//  icons that survive a re-render), WalletGateButton (the
//  install link, connect and switch with their refusals routed
//  to onError, another wallet's name / link / switch help,
//  nothing from step 3 on), FadingAlert (8 s visible, a 0.5 s
//  fade, the pause on pointer and focus, the close button,
//  measured on fake timers) and useAlerts (the list, the tags,
//  a dismiss per row, clearAlerts' stable identity, and each
//  row's own clock).
// -----------------------------------------------------------

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { screen, within, fireEvent, act, renderHook } from '@testing-library/react';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import { renderPage } from '../support/render';
import * as f from '../support/backend/fixtures';
import { WalletStepper, WalletGateButton, FadingAlert, useAlerts } from '@/components/WalletFlow';


const EVM_STEPS = ['Susidiegti MetaMask', 'Prijungti MetaMask', 'Įsijungti Ethereum Sepolia tinklą', 'Atsisiųsti Ethereum Sepolia'];
const ERC20_STEPS = ['Susidiegti MetaMask', 'Prijungti MetaMask', 'Įsijungti Ethereum Sepolia tinklą', 'Gauti tinklo valiutos', 'Atsisiųsti Chainlink žetoną'];
const MOVE_STEPS = ['Susidiegti Slush', 'Prijungti piniginę', 'Atsisiųsti Sui Testnet'];

const STATE_WORDS = /^(atlikta|dabartinis žingsnis|dar neatlikta)$/;

const sepolia = f.evmNetworksMap.sepolia;







// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------
//
// readSteps reads the stepper's text the way a screen reader
// does, linearly: each step's spoken state word, then its
// label. iconOf(i) is the bubble of step i (the state word's
// parent) — the icon is what tells a sighted student done
// from current. The Ethereum diamond is the one inline SVG
// that is not an MUI icon (those carry a data-testid).
// -----------------------------------------------------------

function readSteps(container) {
  const parts = container.textContent.split(/(atlikta|dabartinis žingsnis|dar neatlikta)/).slice(1);
  const steps = [];
  for (let i = 0; i < parts.length; i += 2) steps.push({ state: parts[i], label: parts[i + 1] });
  return steps;
}

const iconOf = (i) => screen.getAllByText(STATE_WORDS)[i].parentElement;

const iconName = (i) => {
  const svg = iconOf(i).querySelector('svg');
  return svg.getAttribute('data-testid') ?? 'diamond';
};

const renderStepper = (props) => renderPage(<WalletStepper {...props} />);

// A page around the stepper: "Toliau" moves the flow on,
// "Perpiešti" re-renders with the same step (a balance poll)
function SteppingPage({ steps, icons, start = 0 }) {
  const [step, setStep] = useState(start);
  const [, setPolls] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setStep((s) => s + 1)}>Toliau</button>
      <button type="button" onClick={() => setPolls((n) => n + 1)}>Perpiešti</button>
      <WalletStepper activeStep={step} steps={[...steps]} icons={icons && { ...icons }} />
    </>
  );
}







// -----------------------------------------------------------
// WalletStepper
// -----------------------------------------------------------

describe('WalletStepper', () => {

  it('reads every step in order with its state — done, current, not yet', () => {
    const { container } = renderStepper({ activeStep: 1, steps: EVM_STEPS });
    expect(readSteps(container)).toEqual([
      { state: 'atlikta', label: 'Susidiegti MetaMask' },
      { state: 'dabartinis žingsnis', label: 'Prijungti MetaMask' },
      { state: 'dar neatlikta', label: 'Įsijungti Ethereum Sepolia tinklą' },
      { state: 'dar neatlikta', label: 'Atsisiųsti Ethereum Sepolia' },
    ]);
  });


  it('marks only the active step as the current step for assistive tech', () => {
    renderStepper({ activeStep: 2, steps: EVM_STEPS });
    const current = document.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Įsijungti Ethereum Sepolia tinklą');
  });


  it('picks the icons by position: install, power, hub in between, the Ethereum diamond last', () => {
    renderStepper({ activeStep: 0, steps: ERC20_STEPS });
    expect([0, 1, 2, 3, 4].map(iconName)).toEqual(['InstallDesktopIcon', 'PowerSettingsNewIcon', 'HubIcon', 'HubIcon', 'diamond']);
  });


  it('puts the diamond on the last step of a shorter flow (the MOVE faucet has three)', () => {
    renderStepper({ activeStep: 0, steps: MOVE_STEPS });
    expect([0, 1, 2].map(iconName)).toEqual(['InstallDesktopIcon', 'PowerSettingsNewIcon', 'diamond']);
  });


  it('shows a check on every completed step, so done and current differ without colour', () => {
    renderStepper({ activeStep: 3, steps: EVM_STEPS });
    expect([0, 1, 2, 3].map(iconName)).toEqual(['CheckIcon', 'CheckIcon', 'CheckIcon', 'diamond']);
    expect(within(iconOf(3)).getByText('dabartinis žingsnis')).toBeInTheDocument();
  });


  it('lets an icons override replace a position icon — the ERC-20 gas pump — until that step is done', async () => {
    const { user } = renderPage(<SteppingPage steps={ERC20_STEPS} icons={{ 3: <LocalGasStationIcon /> }} start={3} />);
    expect(iconName(3)).toBe('LocalGasStationIcon');
    expect(iconName(4)).toBe('diamond');
    await user.click(screen.getByRole('button', { name: 'Toliau' }));
    expect(iconName(3)).toBe('CheckIcon');
  });


  it('counts every step done once the active step runs past the last', () => {
    const { container } = renderStepper({ activeStep: EVM_STEPS.length, steps: EVM_STEPS });
    expect(readSteps(container).map((step) => step.state)).toEqual(['atlikta', 'atlikta', 'atlikta', 'atlikta']);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });


  it('keeps its icons mounted across a re-render — a page re-rendering on every balance poll does not restart them', async () => {
    const { user } = renderPage(<SteppingPage steps={ERC20_STEPS} icons={{ 3: <LocalGasStationIcon /> }} start={1} />);
    const bubbles = [0, 1, 2, 3, 4].map(iconOf);
    const svgs = bubbles.map((bubble) => bubble.querySelector('svg'));
    await user.click(screen.getByRole('button', { name: 'Perpiešti' }));
    await user.click(screen.getByRole('button', { name: 'Perpiešti' }));
    bubbles.forEach((bubble, i) => expect(iconOf(i)).toBe(bubble));
    svgs.forEach((svg, i) => expect(iconOf(i).querySelector('svg')).toBe(svg));
  });
});







// -----------------------------------------------------------
// WalletGateButton
// -----------------------------------------------------------
//
// The one action between the student and claiming, per step;
// a refusal's message goes to onError.
// -----------------------------------------------------------

describe('WalletGateButton', () => {

  it('is the MetaMask download link at step 0, opening in a new tab', () => {
    renderPage(<WalletGateButton step={0} networkInfo={sepolia} onConnect={vi.fn()} onSwitch={vi.fn()} onError={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'Susidiegti MetaMask' });
    expect(link).toHaveAttribute('href', 'https://metamask.io/download/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('button')).toBeNull();
  });


  it("names another wallet and links to its download when given (Phantom's page)", () => {
    renderPage(<WalletGateButton step={0} walletName="Phantom" installUrl="https://phantom.com/download" onConnect={vi.fn()} onSwitch={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Susidiegti Phantom' })).toHaveAttribute('href', 'https://phantom.com/download');
  });


  it('connects at step 1: "Prijungti piniginę" calls onConnect and a connect that succeeds reports nothing', async () => {
    const onConnect = vi.fn(() => Promise.resolve());
    const onError = vi.fn();
    const { user } = renderPage(<WalletGateButton step={1} networkInfo={sepolia} onConnect={onConnect} onSwitch={vi.fn()} onError={onError} />);
    await user.click(screen.getByRole('button', { name: 'Prijungti piniginę' }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });


  it("hands a refused connect's message to onError", async () => {
    const onError = vi.fn();
    const onConnect = () => Promise.reject(new Error('User rejected the request.'));
    const { user } = renderPage(<WalletGateButton step={1} networkInfo={sepolia} onConnect={onConnect} onSwitch={vi.fn()} onError={onError} />);
    await user.click(screen.getByRole('button', { name: 'Prijungti piniginę' }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('User rejected the request.'));
  });


  it("switches at step 2: the button names the network's full name and hands the network to onSwitch", async () => {
    const onSwitch = vi.fn(() => Promise.resolve());
    const onError = vi.fn();
    const { user } = renderPage(<WalletGateButton step={2} networkInfo={sepolia} onConnect={vi.fn()} onSwitch={onSwitch} onError={onError} />);
    await user.click(screen.getByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' }));
    expect(onSwitch).toHaveBeenCalledWith(sepolia);
    expect(onError).not.toHaveBeenCalled();
  });


  it("hands a refused switch's message to onError", async () => {
    const onError = vi.fn();
    const onSwitch = () => Promise.reject(new Error('Nepavyko persijungti į tinklą: User rejected the request.'));
    const { user } = renderPage(<WalletGateButton step={2} networkInfo={sepolia} onConnect={vi.fn()} onSwitch={onSwitch} onError={onError} />);
    await user.click(screen.getByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Nepavyko persijungti į tinklą: User rejected the request.'));
  });


  it("shows a wallet's switch help under the switch button (Phantom's Testnet Mode)", () => {
    renderPage(<WalletGateButton step={2} networkInfo={sepolia} onConnect={vi.fn()} onSwitch={vi.fn()} onError={vi.fn()} switchHelp={<p>Įjunkite Testnet Mode nustatymuose.</p>} />);
    const button = screen.getByRole('button', { name: 'Persijungti į Ethereum Sepolia tinklą' });
    const help = screen.getByText('Įjunkite Testnet Mode nustatymuose.');
    expect(button.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });


  it('renders nothing at step 3 and beyond — the page puts its own claim there', () => {
    for (const step of [3, 4]) {
      const { unmount } = renderPage(<WalletGateButton step={step} networkInfo={sepolia} onConnect={vi.fn()} onSwitch={vi.fn()} onError={vi.fn()} />);
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
      unmount();
    }
  });
});







// -----------------------------------------------------------
// FadingAlert
// -----------------------------------------------------------
//
// Fake timers throughout: 8 s fully visible, the fade to
// opacity 0, onDone at 8.5 s; pointer and focus stop the
// clock, leaving restarts it from zero. The events are fired
// directly — the timing is the subject, not the pointer.
// -----------------------------------------------------------

describe('FadingAlert', () => {

  const advance = (ms) => act(() => { vi.advanceTimersByTime(ms); });


  it('shows the message as an alert of its severity, fully visible', () => {
    const { unmount } = renderPage(<FadingAlert severity="success" onDone={vi.fn()}>Ethereum Sepolia išsiųstas į jūsų piniginę.</FadingAlert>);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Ethereum Sepolia išsiųstas į jūsų piniginę.');
    expect(within(alert).getByTestId('SuccessOutlinedIcon')).toBeInTheDocument();
    expect(alert).toHaveStyle({ opacity: '1' });
    unmount();

    renderPage(<FadingAlert severity="error" onDone={vi.fn()}>{f.COOLDOWN_MESSAGE}</FadingAlert>);
    expect(within(screen.getByRole('alert')).getByTestId('ErrorOutlineIcon')).toBeInTheDocument();
  });


  it('stays fully visible for 8 s, fades out over half a second, then asks to be dropped', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    renderPage(<FadingAlert severity="success" onDone={onDone}>Išsiųsta.</FadingAlert>);
    const alert = screen.getByRole('alert');

    advance(7999);
    expect(alert).toHaveStyle({ opacity: '1' });
    advance(1);
    expect(alert).toHaveStyle({ opacity: '0' });
    advance(499);
    expect(onDone).not.toHaveBeenCalled();
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });


  it('holds while the pointer is on it and restarts the full 8 s when the pointer leaves', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    renderPage(<FadingAlert severity="error" onDone={onDone}>{f.COOLDOWN_MESSAGE}</FadingAlert>);
    const alert = screen.getByRole('alert');

    advance(7000);
    fireEvent.mouseEnter(alert);
    advance(60000);
    expect(alert).toHaveStyle({ opacity: '1' });
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.mouseLeave(alert);
    advance(7999);
    expect(alert).toHaveStyle({ opacity: '1' });
    advance(1);
    expect(alert).toHaveStyle({ opacity: '0' });
    advance(500);
    expect(onDone).toHaveBeenCalledTimes(1);
  });


  it('comes back to full visibility when the pointer arrives during the fade', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    renderPage(<FadingAlert severity="error" onDone={onDone}>{f.EMPTY_FAUCET_MESSAGE}</FadingAlert>);
    const alert = screen.getByRole('alert');

    advance(8200);
    expect(alert).toHaveStyle({ opacity: '0' });
    fireEvent.mouseEnter(alert);
    expect(alert).toHaveStyle({ opacity: '1' });
    advance(5000);
    expect(onDone).not.toHaveBeenCalled();
  });


  it('holds while the keyboard focus is inside it and restarts when the focus leaves', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    renderPage(<FadingAlert severity="error" onDone={onDone}>{f.COOLDOWN_MESSAGE}</FadingAlert>);
    const close = screen.getByRole('button', { name: 'Close' });

    advance(6000);
    fireEvent.focus(close);
    advance(30000);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.blur(close);
    advance(8499);
    expect(onDone).not.toHaveBeenCalled();
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });


  it('drops at once from its close button', async () => {
    const onDone = vi.fn();
    const { user } = renderPage(<FadingAlert severity="success" onDone={onDone}>Išsiųsta.</FadingAlert>);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });


  it('runs out quietly without an onDone', () => {
    vi.useFakeTimers();
    renderPage(<FadingAlert severity="success">Išsiųsta.</FadingAlert>);
    advance(10000);
    expect(screen.getByRole('alert')).toHaveStyle({ opacity: '0' });
  });
});







// -----------------------------------------------------------
// useAlerts
// -----------------------------------------------------------
//
// The list behind FadingAlert. The last two tests render it
// the way the pages do — each row a FadingAlert whose onDone
// is the row's own dismiss — to show the wiring and that one
// row's clock is not restarted by another row arriving.
// -----------------------------------------------------------

function AlertList({ tag = null }) {
  const { alerts, addAlert } = useAlerts();
  return (
    <>
      <button type="button" onClick={() => addAlert('success', `Išsiųsta #${alerts.length + 1}`, tag)}>Pridėti</button>
      {alerts.map((a) => (
        <FadingAlert key={a.id} severity={a.severity} onDone={a.dismiss}>{a.message}</FadingAlert>
      ))}
    </>
  );
}


describe('useAlerts', () => {

  it('adds rows in order with their severity, message and tag — null when untagged', () => {
    const { result } = renderHook(() => useAlerts());
    act(() => result.current.addAlert('success', 'Ethereum Sepolia išsiųstas į jūsų piniginę.'));
    act(() => result.current.addAlert('error', f.COOLDOWN_MESSAGE, 'sepolia'));
    expect(result.current.alerts.map(({ severity, message, tag }) => ({ severity, message, tag }))).toEqual([
      { severity: 'success', message: 'Ethereum Sepolia išsiųstas į jūsų piniginę.', tag: null },
      { severity: 'error', message: f.COOLDOWN_MESSAGE, tag: 'sepolia' },
    ]);
  });


  it('gives every row its own dismiss, which drops only that row', () => {
    const { result } = renderHook(() => useAlerts());
    act(() => {
      result.current.addAlert('success', 'A');
      result.current.addAlert('error', 'B');
      result.current.addAlert('error', 'C');
    });
    act(() => result.current.alerts[1].dismiss());
    expect(result.current.alerts.map((a) => a.message)).toEqual(['A', 'C']);
    act(() => result.current.alerts[0].dismiss());
    expect(result.current.alerts.map((a) => a.message)).toEqual(['C']);
  });


  it('keeps the ids apart for rows added in the same millisecond', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-30T10:00:00Z') });
    const { result } = renderHook(() => useAlerts());
    act(() => {
      result.current.addAlert('error', 'A');
      result.current.addAlert('error', 'B');
      result.current.addAlert('error', 'C');
    });
    expect(new Set(result.current.alerts.map((a) => a.id)).size).toBe(3);
  });


  it('clearAlerts drops every row and keeps its identity across renders', () => {
    const { result } = renderHook(() => useAlerts());
    const clearAlerts = result.current.clearAlerts;
    act(() => {
      result.current.addAlert('success', 'A');
      result.current.addAlert('error', 'B', 'hoodi');
    });
    expect(result.current.clearAlerts).toBe(clearAlerts);
    act(() => result.current.clearAlerts());
    expect(result.current.alerts).toEqual([]);
    expect(result.current.clearAlerts).toBe(clearAlerts);
  });


  it('drops a row rendered through FadingAlert once its 8.5 s are up', () => {
    vi.useFakeTimers();
    renderPage(<AlertList />);
    fireEvent.click(screen.getByRole('button', { name: 'Pridėti' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Išsiųsta #1');
    act(() => { vi.advanceTimersByTime(8500); });
    expect(screen.queryByRole('alert')).toBeNull();
  });


  it("does not restart one row's clock when another row arrives", () => {
    vi.useFakeTimers();
    renderPage(<AlertList tag="sepolia" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pridėti' }));
    act(() => { vi.advanceTimersByTime(5000); });
    fireEvent.click(screen.getByRole('button', { name: 'Pridėti' }));
    expect(screen.getAllByRole('alert')).toHaveLength(2);

    act(() => { vi.advanceTimersByTime(3500); });
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Išsiųsta #2']);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
