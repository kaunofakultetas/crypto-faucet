// -----------------------------------------------------------
//  [*] WalletFlow — shared wallet flow UI
//
//  The pieces every faucet page puts around its claim button:
//  the step progress bar, the gate button that walks the
//  student through install → connect → switch network, and
//  the self-fading outcome alerts.
//
//  Wallet-agnostic. Everything here is driven by the `step`
//  the page's wallet hook derives (hooks/useMetamaskWallet.js
//  for MetaMask, Faucet_SVM/usePhantomWallet.js for Phantom,
//  Faucet_MOVE/useSuiWallet.js for Sui wallets);
//  nothing in this file talks to a wallet itself. What differs
//  between wallets arrives as props: the install link and
//  name, the last step's icon, and any extra help rendered
//  under the switch button.
//
//  The install step also waits for the wallet it sent the
//  student after: a browser shows a newly installed extension
//  only to pages loaded afterwards, so the page reloads itself
//  when the student comes back and the wallet is still
//  missing (useReloadAfterInstall) — otherwise it sat on
//  "Susidiegti …" until somebody said to press reload.
//
//  Split into (last used first is fine here — no root
//  component, this is a toolbox):
//
//    ALERT_VISIBLE_MS/…   — alert lifetime + fade length
//    METAMASK_*           — the default wallet's name + link
//    ColorlibConnector    — gradient connector line (styled)
//    ColorlibStepIconRoot — gradient step bubble (styled)
//    ColorlibStepIcon     — icon inside a step bubble
//    WalletStepper        — the step progress bar
//    useReloadAfterInstall — the reload on the student's
//                           return from installing the wallet
//    WalletGateButton     — install / connect / switch button
//    FadingAlert          — one self-fading outcome row
//    useAlerts            — the alert list + addAlert
//
//  Used by:
//    - pages/Faucet_EVM/Page.jsx
//    - pages/Faucet_ERC20/Page.jsx
//    - pages/Faucet_SVM/Page.jsx
//    - pages/Faucet_MOVE/Page.jsx
// -----------------------------------------------------------

import { useCallback, useEffect, useState } from 'react';

import { Button, Stack, Stepper, Step, StepLabel, StepConnector, stepConnectorClasses, Alert as MuiAlert } from '@mui/material';
import { styled } from '@mui/material/styles';
import HubIcon from '@mui/icons-material/Hub';
import InstallDesktopIcon from '@mui/icons-material/InstallDesktop';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import CheckIcon from '@mui/icons-material/Check';

import { noteInstallStarted, installUnderWay, forgetInstall } from '@/utils/walletInstall';


// How long an outcome alert stays fully visible
const ALERT_VISIBLE_MS = 8000;

// How long it then fades out before its row is dropped from
// the list
const ALERT_FADE_MS = 500;

// WalletGateButton's default wallet name — the EVM-family
// pages never pass one, the SVM page passes Phantom's and the
// MOVE page the discovered Sui wallet's
const METAMASK_NAME = 'MetaMask';

// The default wallet's install link, overridden the same way
// as its name
const METAMASK_DOWNLOAD_URL = 'https://metamask.io/download/';







// -----------------------------------------------------------
// ColorlibConnector
// -----------------------------------------------------------
//
// The stepper's connector line: a thin grey bar that switches
// to the brand orange→pink→purple gradient once the step it
// leads to is active or completed.
//
// Used by:
//   - WalletStepper (below)
// -----------------------------------------------------------

const ColorlibConnector = styled(StepConnector)(({ theme }) => ({
  [`&.${stepConnectorClasses.alternativeLabel}`]: {
    top: 22,
  },
  [`&.${stepConnectorClasses.active}`]: {
    [`& .${stepConnectorClasses.line}`]: {
      backgroundImage:
        'linear-gradient( 95deg,rgb(242,113,33) 0%,rgb(233,64,87) 50%,rgb(138,35,135) 100%)',
    },
  },
  [`&.${stepConnectorClasses.completed}`]: {
    [`& .${stepConnectorClasses.line}`]: {
      backgroundImage:
        'linear-gradient( 95deg,rgb(242,113,33) 0%,rgb(233,64,87) 50%,rgb(138,35,135) 100%)',
    },
  },
  [`& .${stepConnectorClasses.line}`]: {
    height: 3,
    border: 0,
    backgroundColor:
      theme.palette.mode === 'dark' ? theme.palette.grey[800] : '#eaeaf0',
    borderRadius: 1,
  },
}));







// -----------------------------------------------------------
// ColorlibStepIconRoot
// -----------------------------------------------------------
//
// One round step bubble: grey until reached, the brand
// gradient (plus a drop shadow while active) once the step is
// active or completed — ownerState carries the two flags in.
//
// Used by:
//   - ColorlibStepIcon (below)
// -----------------------------------------------------------

const ColorlibStepIconRoot = styled('div')(({ theme, ownerState }) => ({
  backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[700] : '#ccc',
  zIndex: 1,
  color: '#fff',
  width: 50,
  height: 50,
  display: 'flex',
  borderRadius: '50%',
  justifyContent: 'center',
  alignItems: 'center',
  ...(ownerState.active && {
    backgroundImage:
      'linear-gradient( 136deg, rgb(242,113,33) 0%, rgb(233,64,87) 50%, rgb(138,35,135) 100%)',
    boxShadow: '0 4px 10px 0 rgba(0,0,0,.25)',
  }),
  ...(ownerState.completed && {
    backgroundImage:
      'linear-gradient( 136deg, rgb(242,113,33) 0%, rgb(233,64,87) 50%, rgb(138,35,135) 100%)',
  }),
}));







// -----------------------------------------------------------
// ColorlibStepIcon
// -----------------------------------------------------------
//
// The icon inside a step bubble, picked by position so the
// bar works at any length: install, power, the Ethereum
// diamond for the LAST step, hub for anything between. An
// `override` element (from WalletStepper's icons prop) beats
// the position logic — the ERC-20 page slots a gas pump into
// its gas step this way, the SVM page a coin into its last
// one. A COMPLETED step shows a check instead: the gradient
// alone is the same for done and current, so colour-blind
// students could not tell them apart. A visually hidden
// word carries the same state to screen readers.
//
// Used by:
//   - WalletStepper (below)
// -----------------------------------------------------------

function ColorlibStepIcon({ icon, total, override, active, completed, className }) {

  const index = Number(icon);

  let node = <HubIcon />;
  if (completed) {
    node = <CheckIcon />;
  } else if (override) {
    node = override;
  } else if (index === 1) {
    node = <InstallDesktopIcon />;
  } else if (index === 2) {
    node = <PowerSettingsNewIcon />;
  } else if (index === total) {
    node = <svg xmlns="http://www.w3.org/2000/svg" width="2em" height="2em" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 1.75l-6.25 10.5L12 16l6.25-3.75zM5.75 13.5L12 22.25l6.25-8.75L12 17.25z"/></svg>;
  }

  return (
    <ColorlibStepIconRoot ownerState={{ completed, active }} className={className}>
      {node}
      <span className="sr-only">
        {completed ? 'atlikta' : active ? 'dabartinis žingsnis' : 'dar neatlikta'}
      </span>
    </ColorlibStepIconRoot>
  );
}







// -----------------------------------------------------------
// WalletStepper
// -----------------------------------------------------------
//
// The flow bar, given the labels: the EVM and SVM faucets run
// install → connect → switch network → claim, the MOVE one
// skips the network step (Sui wallets need no hop), the
// ERC-20 one adds a gas step — install → connect → token
// network → have gas → claim. Purely presentational. `icons` is an optional
// sparse index→element map that overrides the position-based
// defaults for steps the defaults can't know about (the
// ERC-20 gas step, the SVM claim step).
//
// Used by:
//   - every faucet page (see the file header)
// -----------------------------------------------------------

export function WalletStepper({ activeStep, steps, icons }) {
  return (
    <Stack sx={{ width: '100%' }} spacing={4}>
      <Stepper alternativeLabel activeStep={activeStep} connector={<ColorlibConnector />}>
        {steps.map((label, i) => (
          <Step key={label}>
            {/* total/override go through slotProps, NOT an inline
                arrow slot — an inline component is a new type
                every render and would remount the icons each
                second (the pages re-render on every balance
                poll) */}
            <StepLabel
              slots={{ stepIcon: ColorlibStepIcon }}
              slotProps={{ stepIcon: { total: steps.length, override: icons?.[i] } }}
              aria-current={i === activeStep ? 'step' : undefined}
            >
              {label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>
    </Stack>
  );
}







// -----------------------------------------------------------
// useReloadAfterInstall
// -----------------------------------------------------------
//
// While the wallet is missing: reloads the page when the
// student comes BACK to it after an install of that wallet
// was started (the install link's press, remembered by
// utils/walletInstall.js). A reload is the only way a page
// gets to see an extension installed after it was opened, and
// at the install step there is nothing typed to lose.
//
// The reload needs the student to have left this very page
// load first — the tab hidden or the window out of focus —
// and then to be back. A page that has only just loaded
// never reloads itself, so there is no way into a loop: every
// reload costs one going away and coming back. A return with
// the wallet still missing (the install not finished) reloads
// into the same step, and the next return counts again, for
// as long as the note does.
//
// Once the wallet is found the note is dropped.
//
// Used by:
//   - WalletGateButton (below)
// -----------------------------------------------------------

function useReloadAfterInstall(missing, walletName) {
  useEffect(() => {
    if (!missing) {
      forgetInstall(walletName);
      return undefined;
    }

    let away = false;
    let reloading = false;

    const leave = () => {
      away = true;
    };
    const comeBack = () => {
      if (!away || reloading || !installUnderWay(walletName)) return;
      reloading = true;
      window.location.reload();
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? leave() : comeBack());

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', comeBack);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', comeBack);
    };
  }, [missing, walletName]);
}







// -----------------------------------------------------------
// WalletGateButton
// -----------------------------------------------------------
//
// The one action standing between the student and claiming:
// the wallet download link (step 0), the connect prompt
// (step 1) or the network switch (step 2). Renders NOTHING at
// step 3 and above — the pages put their own gas/claim UI
// there.
//
// The download link opens the store in a new tab and notes
// that an install was started — a middle click included —
// so the page can reload itself when the student comes back
// (useReloadAfterInstall).
//
// walletName / installUrl default to MetaMask. switchHelp is
// an optional node shown under the switch button, for wallets
// whose network hop needs manual clicks the page can only
// describe (Phantom's Testnet Mode).
//
// Used by:
//   - every faucet page (see the file header)
// -----------------------------------------------------------

export function WalletGateButton({
  step, networkInfo, onConnect, onSwitch, onError,
  walletName = METAMASK_NAME, installUrl = METAMASK_DOWNLOAD_URL, switchHelp = null,
}) {

  useReloadAfterInstall(step === 0, walletName);

  if (step === 0) {
    return (
      <Button
        component="a"
        href={installUrl}
        target="_blank"
        rel="noopener noreferrer"
        variant="contained"
        fullWidth
        onClick={() => noteInstallStarted(walletName)}
        onAuxClick={() => noteInstallStarted(walletName)}
      >
        Susidiegti {walletName}
      </Button>
    );
  }

  if (step === 1) {
    return (
      <Button variant="contained" fullWidth onClick={() => onConnect().catch((e) => onError(e.message))}>
        Prijungti piniginę
      </Button>
    );
  }

  if (step === 2) {
    return (
      <>
        <Button
          variant="contained"
          fullWidth
          onClick={() => onSwitch(networkInfo).catch((e) => onError(e.message))}
        >
          Persijungti į {networkInfo.full_name} tinklą
        </Button>
        {switchHelp}
      </>
    );
  }

  return null;
}







// -----------------------------------------------------------
// FadingAlert
// -----------------------------------------------------------
//
// One outcome row: fully visible for 8 s, then fades out over
// 0.5 s, then `onDone` (the alert's own dismiss from useAlerts)
// drops it. The clock STOPS while the pointer or the keyboard
// focus is on the row and restarts from zero when it leaves —
// a slow reader, or a screen-reader user still hearing the
// cooldown message, is not raced by the timer — and the close
// button dismisses at once. The whole lifetime lives here;
// useAlerts only holds the list.
//
// Used by:
//   - every faucet page (see the file header)
// -----------------------------------------------------------

export function FadingAlert({ severity, children, onDone }) {

  const [opacity, setOpacity] = useState(1);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return undefined;
    const fade = setTimeout(() => setOpacity(0), ALERT_VISIBLE_MS);
    const done = setTimeout(() => onDone?.(), ALERT_VISIBLE_MS + ALERT_FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, [paused, onDone]);

  const pause = () => {
    setOpacity(1);
    setPaused(true);
  };

  return (
    <MuiAlert
      severity={severity}
      onClose={onDone}
      onMouseEnter={pause}
      onMouseLeave={() => setPaused(false)}
      onFocus={pause}
      onBlur={() => setPaused(false)}
      sx={{ mt: 2, transition: `opacity ${ALERT_FADE_MS}ms` }}
      style={{ opacity }}
    >
      {children}
    </MuiAlert>
  );
}







// -----------------------------------------------------------
// useAlerts
// -----------------------------------------------------------
//
// The outcome list behind FadingAlert. A page adds a success
// or an error row with its message — a sentence, or words
// with a link in them — and may tag it. Every entry carries
// its own `dismiss`, which the row calls when its clock runs
// out or its close button is pressed (pass it as onDone). The
// optional tag lets a page with actions spread across many
// cards route each row to the card that caused it — the
// ERC-20 page tags by network; untagged rows are the page's
// own to place (the EVM and SVM pages ignore tags entirely).
// clearAlerts drops every row at once — the single-network
// pages call it on a network switch, so an outcome issued for
// the previous chain never sits on the new chain's page.
//
// Used by:
//   - every faucet page (see the file header)
// -----------------------------------------------------------

export function useAlerts() {

  const [alerts, setAlerts] = useState([]);

  const addAlert = (severity, message, tag = null) => {
    const id = Date.now() + Math.random();
    const dismiss = () => setAlerts((prev) => prev.filter((a) => a.id !== id));
    setAlerts((prev) => [...prev, { id, severity, message, tag, dismiss }]);
  };

  // Stable identity, so a page can list it as an effect dep
  const clearAlerts = useCallback(() => setAlerts([]), []);

  return { alerts, addAlert, clearAlerts };
}
