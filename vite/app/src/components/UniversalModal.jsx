// -----------------------------------------------------------
//  [*] UniversalModal — the shared modal dialog
//
//  One configurable dialog: a title/description header with
//  an optional variant icon, arbitrary children as the body,
//  and either the standard Confirm/Cancel pair or custom
//  action buttons. Variants ("default" | "danger" | "warning"
//  | "info" | "success") pick the header icon and the confirm
//  button colour.
//
//  Every modal opens with a flight: by default the dialog
//  grows out of the screen centre; pass `sourceRect` (the
//  trigger element's getBoundingClientRect()) and it flies
//  out of that element instead — and back into it on close.
//  The paper is centred by LAYOUT (the Modal root is a flex
//  box) and the transform carries only the flight, so content
//  that changes height at any moment — mid-flight included —
//  re-centres instantly instead of sliding into place. The
//  transform transition is live only during the two flights.
//  The backdrop blurs the page behind. Under
//  `prefers-reduced-motion: reduce` every flight and fade is
//  0 ms — the dialog simply appears.
//
//  The form contract:
//    - `dirty` — the consumer says whether the body holds
//      unsaved input. While it does, an IMPLICIT dismissal
//      (backdrop click, Esc, the header ×) does not close the
//      dialog outright: a small "Atmesti pakeitimus?" prompt
//      opens on top of it and the input is lost only on an
//      explicit Atmesti. The stock Cancel button is explicit
//      and always closes
//    - `onSubmit` / `submitDisabled` — Enter in a single-line
//      text field of the body submits, the way a <form> would.
//      Only Enter inside an <input> of a text type counts, and
//      only while the event is still unhandled — a field that
//      handles its own Enter calls preventDefault. With the
//      stock buttons and no onSubmit, Enter confirms
//
//  Accessibility: the paper is the dialog (role="dialog",
//  aria-modal), named by the title and described by the
//  description — the ids come from useId, and each attribute
//  is emitted only when its element is rendered. The × has an
//  aria-label; the discard prompt is an alertdialog with
//  "Tęsti redagavimą" focused first.
//
//  Split into (root component last):
//
//    FLIGHT_MS / TEXT_INPUT_TYPES / VARIANTS — constants
//    prefersReducedMotion — the OS motion preference
//    ModalHeader          — icon, title, description, close (×)
//    StandardActions      — the Confirm/Cancel button bar
//    DiscardPrompt        — the "Atmesti pakeitimus?" alertdialog
//    UniversalModal       — the modal itself (default export)
// -----------------------------------------------------------

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { Modal, Paper, Box, Typography, Button, IconButton, CircularProgress, Divider } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';


// One duration for everything the flight moves — the paper,
// both fades AND the unmount delay. Keep them identical or
// the close flight gets cut off before it lands
const FLIGHT_MS = 400;

// The <input> types whose Enter submits — the same set HTML's
// implicit form submission honours. Checkboxes, switches and
// radios keep Enter to themselves
const TEXT_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'tel', 'url', 'number']);

// Variant configurations — header icon, confirm button colour
const VARIANTS = {
  default: { icon: null, confirmColor: 'primary', iconColor: 'primary' },
  danger: { icon: ErrorOutlineIcon, confirmColor: 'error', iconColor: 'error' },
  warning: { icon: WarningAmberIcon, confirmColor: 'warning', iconColor: 'warning' },
  info: { icon: InfoOutlinedIcon, confirmColor: 'info', iconColor: 'info' },
  success: { icon: CheckCircleOutlineIcon, confirmColor: 'success', iconColor: 'success' },
};







// -----------------------------------------------------------
// prefersReducedMotion
// -----------------------------------------------------------
//
// True when the OS asks for reduced motion. Read on every
// render rather than once — it is one matchMedia call, and
// the setting can change while the page is open.
//
// Used by:
//   - UniversalModal (below) — the flight duration
// -----------------------------------------------------------

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}







// -----------------------------------------------------------
// ModalHeader
// -----------------------------------------------------------
//
// Top section: the variant icon, title and description on the
// left, the close (×) button on the right. Bottom padding is
// tighter when something follows underneath. `titleId` /
// `descriptionId` are the ids the paper's aria-labelledby /
// aria-describedby point at.
//
// Used by:
//   - UniversalModal (below)
// -----------------------------------------------------------

function ModalHeader({ icon: Icon, iconColor, title, titleId, description, descriptionId, hasBody, showCloseButton, onClose }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        p: 3,
        pb: description || hasBody ? 2 : 3,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, marginBottom: 1 }}>
        {Icon && (
          <Icon color={iconColor} sx={{ fontSize: 28 }} />
        )}
        <Box>
          {title && (
            <Typography id={titleId} variant="h6" component="h2" sx={{ fontWeight: 600 }}>
              {title}
            </Typography>
          )}
          {description && (
            <Typography id={descriptionId} variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {description}
            </Typography>
          )}
        </Box>
      </Box>

      {showCloseButton && (
        <IconButton
          onClick={onClose}
          size="small"
          aria-label="Uždaryti"
          sx={{ ml: 1, color: 'text.secondary', '&:hover': { color: 'error.main' } }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </Box>
  );
}







// -----------------------------------------------------------
// StandardActions
// -----------------------------------------------------------
//
// The default footer: right-aligned Cancel + Confirm buttons.
// While `loading` both are disabled and the confirm button
// shows a spinner.
//
// Used by:
//   - UniversalModal (below) — when no custom `actions` given
// -----------------------------------------------------------

function StandardActions({ showCancel, cancelText, onCancel, showConfirm, confirmText, confirmColor, onConfirm, confirmDisabled, loading }) {
  return (
    <>
      <Divider />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, p: 2, px: 3 }}>
        {showCancel && (
          <Button variant="outlined" onClick={onCancel} disabled={loading}>
            {cancelText}
          </Button>
        )}
        {showConfirm && (
          <Button
            variant="contained"
            color={confirmColor}
            onClick={onConfirm}
            disabled={confirmDisabled || loading}
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {confirmText}
          </Button>
        )}
      </Box>
    </>
  );
}







// -----------------------------------------------------------
// DiscardPrompt
// -----------------------------------------------------------
//
// The "Atmesti pakeitimus?" question, a second MUI Modal
// stacked over the dialog (MUI stacks modals in the order they
// register: the last one owns the focus trap and Esc, so Esc
// here means "keep editing" and never reaches the dialog
// underneath). Nothing flies — it fades in with MUI's own
// backdrop; "Tęsti redagavimą" is the safe default and takes
// the focus.
//
// Used by:
//   - UniversalModal (below) — while `askingDiscard`,
//     rendered AFTER the dialog's Modal so it stacks on top
// -----------------------------------------------------------

function DiscardPrompt({ open, onKeep, onDiscard }) {

  const titleId = useId();
  const textId = useId();


  return (
    <Modal
      open={open}
      onClose={onKeep}
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      slotProps={{ backdrop: { sx: { backgroundColor: 'rgba(0, 0, 0, 0.25)' } } }}
    >
      <Paper
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        sx={{ width: 380, maxWidth: '90vw', p: 3, borderRadius: 2, boxShadow: 24, outline: 'none' }}
      >
        <Typography id={titleId} variant="h6" component="h2" sx={{ fontWeight: 600 }}>
          Atmesti pakeitimus?
        </Typography>
        <Typography id={textId} variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Viskas, kas įvesta šiame lange, bus prarasta.
        </Typography>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 3 }}>
          <Button variant="outlined" onClick={onKeep} autoFocus>
            Tęsti redagavimą
          </Button>
          <Button variant="contained" color="error" onClick={onDiscard}>
            Atmesti
          </Button>
        </Box>
      </Paper>
    </Modal>
  );
}







// -----------------------------------------------------------
// UniversalModal (default export)
// -----------------------------------------------------------
//
// The dialog itself: a MUI Modal whose paper carries the
// ModalHeader, the caller's children and either the stock
// Confirm/Cancel pair or the caller's `actions`. Owns the
// flight state (entered / exiting / landed, timed by
// FLIGHT_MS), awaits an async onConfirm before closing and
// keeps the dialog open when that confirm rejects, exposes
// requestClose through closeRef so the caller's own buttons
// close it with the return flight, guards a `dirty` body
// behind the DiscardPrompt and submits on Enter (see the file
// header).
//
// Used by:
//   - pages/Graph_UTXO/components/TransactionModal.jsx — a
//     transaction's details (custom `actions`, `dirty` while a
//     name edit is unsaved)
// -----------------------------------------------------------

export default function UniversalModal({
  // Control
  open,
  onClose,

  // Content
  title,
  description,
  children,

  // Custom action buttons — replace the Confirm/Cancel pair
  actions,

  // Standard action buttons (used when `actions` is not given)
  confirmText = 'Patvirtinti',
  cancelText = 'Atšaukti',
  onConfirm,
  onCancel,
  showCancel = true,
  showConfirm = true,
  confirmDisabled = false,

  // Variants: "default" | "danger" | "warning" | "info" | "success"
  variant = 'default',

  // Sizing
  maxWidth = 500,
  fullWidth = false,

  // Loading state
  loading = false,

  // Behaviour
  closeOnConfirm = true,
  closeOnBackdropClick = true,
  showCloseButton = true,

  // Form contract (see the file header): unsaved input to
  // protect, and what Enter in a text field runs
  dirty = false,
  onSubmit = null,
  submitDisabled = false,

  // Flight origin — the trigger element's screen rectangle;
  // without it the modal grows from the centre
  sourceRect = null,

  // Animated close for the caller's OWN handlers: pass a ref
  // and call closeRef.current() instead of closing directly —
  // the return flight plays first, onClose fires after it lands
  closeRef = null,

  // Custom styling
  sx = {},
  contentSx = {},
}) {

  const variantConfig = VARIANTS[variant] || VARIANTS.default;

  // The dialog's accessible name and description — one id pair
  // per instance, so a closing modal overlapping an opening one
  // never duplicates an id
  const titleId = useId();
  const descriptionId = useId();

  // Reduced motion: the flights and fades collapse to 0 ms —
  // the state machine below is unchanged, its timers just fire
  // at once
  const flightMs = prefersReducedMotion() ? 0 : FLIGHT_MS;


  // ---- Flight ----
  // `entered` drives the transition (start pose → resting
  // pose); `exiting` keeps the modal mounted while the reverse
  // flight plays after `open` goes false
  const paperRef = useRef(null);
  const [entered, setEntered] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [landed, setLanded] = useState(false);
  const [flightFrom, setFlightFrom] = useState('scale(0.92)');

  // The close must start IN THE SAME RENDER that receives
  // open=false — waiting for an effect would leave one frame
  // with mounted=false, and MUI would unmount the paper before
  // the return flight can play (the derive-state-during-render
  // pattern). Skipped when the close came from requestClose
  // (closingRef, set until the next opening): that flight has
  // already played, and the open=false a consumer answers
  // onClose with is only its acknowledgement
  const closingRef = useRef(false);
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open && !closingRef.current) {
      setExiting(true);
      setEntered(false);
    }
  }

  const mounted = open || exiting;

  // Animated close for every internal trigger (backdrop, Esc,
  // the header ×, Cancel, closeOnConfirm): fly back FIRST, call
  // onClose only after landing — a consumer that unmounts the
  // modal on close would otherwise cut the flight off. Exposed
  // through closeRef for the consumer's own buttons too
  const requestClose = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setExiting(true);
    setEntered(false);
    setTimeout(() => onClose?.(), flightMs);
  };

  if (closeRef) {
    closeRef.current = requestClose;
  }

  // Entering: derive the start pose — over the source element
  // when given (offsetWidth/Height ignore transforms, and the
  // paper's centre always rests at the viewport centre), a
  // plain centre scale otherwise — then release it a frame
  // later so the transition has something to play. The
  // measurement waits one frame because MUI mounts the modal
  // through a portal, so the paper does not exist yet when
  // this effect first runs; the paper stays at opacity 0 until
  // `entered`, which hides that frame
  useLayoutEffect(() => {
    if (!open) return;
    closingRef.current = false;
    setExiting(false);

    let raf2;
    const raf1 = requestAnimationFrame(() => {
      let start = 'scale(0.92)';
      const paper = paperRef.current;
      if (sourceRect && paper) {
        const dx = (sourceRect.left + sourceRect.width / 2) - window.innerWidth / 2;
        const dy = (sourceRect.top + sourceRect.height / 2) - window.innerHeight / 2;
        // UNIFORM scale (the smaller ratio) — the modal keeps its
        // own proportions while flying instead of being stretched
        // into the source's shape
        const scale = Math.min(sourceRect.width / paper.offsetWidth, sourceRect.height / paper.offsetHeight);
        start = `translate(${dx}px, ${dy}px) scale(${scale})`;
      }
      setFlightFrom(start);
      raf2 = requestAnimationFrame(() => setEntered(true));
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [open, sourceRect]);

  // Leaving: the render-phase block above put us in the exit
  // pose — here we only unmount once the return flight landed
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => setExiting(false), flightMs);
    return () => clearTimeout(timer);
  }, [exiting, flightMs]);

  // Landed: the entry flight is over, so the transform
  // transition goes off (see the header). Re-armed for the
  // next flight when `entered` drops
  useEffect(() => {
    if (!entered) {
      setLanded(false);
      return;
    }
    const timer = setTimeout(() => setLanded(true), flightMs);
    return () => clearTimeout(timer);
  }, [entered, flightMs]);


  // onConfirm is awaited so closeOnConfirm doesn't shut the
  // modal before an async confirm has finished; a rejection
  // keeps the modal open so the user can retry
  const handleConfirm = async () => {
    if (onConfirm) {
      try {
        await onConfirm();
      } catch {
        return;
      }
    }
    if (closeOnConfirm) {
      requestClose();
    }
  };

  // Cancel is an explicit choice — no discard prompt
  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    requestClose();
  };


  // ---- Dirty guard ----
  // An implicit dismissal of a dirty body opens the prompt
  // instead of closing; Atmesti there is the real close
  const [askingDiscard, setAskingDiscard] = useState(false);

  const dismiss = () => {
    if (dirty) {
      setAskingDiscard(true);
      return;
    }
    requestClose();
  };

  const discard = () => {
    setAskingDiscard(false);
    requestClose();
  };

  // MUI reports why the modal wants to close; backdrop clicks
  // are ignored when closeOnBackdropClick is off (Esc still
  // dismisses — through the dirty guard like the backdrop)
  const handleModalClose = (event, reason) => {
    if (reason === 'backdropClick' && !closeOnBackdropClick) {
      return;
    }
    dismiss();
  };


  // ---- Enter submits ----
  // What Enter runs: the consumer's onSubmit, else the stock
  // confirm when the stock buttons are shown. Nothing while
  // the button itself would be disabled
  const submit = onSubmit ?? (!actions && showConfirm ? handleConfirm : null);
  const submitBlocked = submitDisabled || loading || (!onSubmit && confirmDisabled);

  const handleKeyDown = (event) => {
    if (event.key !== 'Enter' || !submit || submitBlocked) return;
    // Already consumed, a modifier chord, or an IME
    // composition — not a submit
    if (event.defaultPrevented || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !TEXT_INPUT_TYPES.has(target.type)) return;
    event.preventDefault();
    submit();
  };


  const showActionBar = actions || showConfirm || showCancel;


  return (
    <>
      <Modal
        open={mounted}
        onClose={handleModalClose}
        // Centring by layout, not by transform — see the header
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        slotProps={{
          backdrop: {
            sx: {
              backgroundColor: 'rgba(0, 0, 0, 0.15)',
              // The blur is animated explicitly — backdrop-filter
              // ignores the element's own opacity, so fading alone
              // would leave the page blurred until unmount
              backdropFilter: entered ? 'blur(6px)' : 'blur(0px)',
              opacity: entered ? 1 : 0,
              transition: `opacity ${flightMs}ms ease, backdrop-filter ${flightMs}ms ease`,
            },
          },
        }}
      >
        <Paper
          ref={paperRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descriptionId : undefined}
          onKeyDown={handleKeyDown}
          sx={{
            transform: entered ? 'none' : flightFrom,
            opacity: entered ? 1 : 0,
            // No transition while the start pose is set up — the
            // paper must TELEPORT there, then animate out of it
            // (and back into it while exiting) — and none once it
            // has landed, so a height change re-centres instantly
            transition: exiting || (entered && !landed)
              ? `transform ${flightMs}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${flightMs}ms ease`
              : 'none',
            width: fullWidth ? '90%' : 'auto',
            maxWidth: maxWidth,
            minWidth: 300,
            maxHeight: '90vh',
            overflow: 'auto',
            borderRadius: 2,
            boxShadow: 24,
            outline: 'none',   // Modal focuses the Paper; hide the focus ring
            ...sx,
          }}
        >
          <ModalHeader
            icon={variantConfig.icon}
            iconColor={variantConfig.iconColor}
            title={title}
            titleId={titleId}
            description={description}
            descriptionId={descriptionId}
            hasBody={Boolean(children)}
            showCloseButton={showCloseButton}
            onClose={dismiss}
          />

          {children && (
            <Box sx={{ px: 3, pb: showActionBar ? 2 : 3, ...contentSx }}>
              {children}
            </Box>
          )}

          {/* Custom actions — block layout so callers can lay out
              their own bar */}
          {actions && (
            <>
              <Divider />
              <Box sx={{ p: 2, px: 3 }}>
                {actions}
              </Box>
            </>
          )}

          {/* Standard Confirm/Cancel bar — only when no custom actions */}
          {!actions && (showConfirm || showCancel) && (
            <StandardActions
              showCancel={showCancel}
              cancelText={cancelText}
              onCancel={handleCancel}
              showConfirm={showConfirm}
              confirmText={confirmText}
              confirmColor={variantConfig.confirmColor}
              onConfirm={handleConfirm}
              confirmDisabled={confirmDisabled}
              loading={loading}
            />
          )}
        </Paper>
      </Modal>

      {/* The dirty guard's question — a sibling AFTER the
          dialog's Modal, so MUI stacks it on top */}
      <DiscardPrompt
        open={askingDiscard}
        onKeep={() => setAskingDiscard(false)}
        onDiscard={discard}
      />
    </>
  );
}
