// -----------------------------------------------------------
//  [*] Pages — Presentations (route /presentations)
//
//  Interactive lecture presentations: one titled card per
//  deck, each with a short Lithuanian explanation and a
//  button that opens the deck in a new tab. The decks are
//  self-contained HTML files served statically from
//  /served/presentations/ (outside the SPA, cookie-gated by
//  the endpoint like the SPA itself); their three.js and
//  fonts live in /served/presentations/_lib, so they work
//  without internet access. Adding a deck means dropping its
//  folder into presentations/ and adding one PRESENTATIONS
//  entry — with an optional thumbnail path, set explicitly in
//  the entry; a card without one is text-only. This page
//  replaced the old /videos page — the mp4 files it served
//  are retired.
//
//  Split into (root component last):
//
//    PRESENTATIONS     — the catalog (title, description, href,
//                        optional thumbnail, optional buttons)
//    PresentationCard  — one titled card with the open button
//    PresentationsPage — layout (default export)
// -----------------------------------------------------------

import { Box, Typography, Card, CardContent, Button } from '@mui/material';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';








// -----------------------------------------------------------
// PRESENTATIONS
// -----------------------------------------------------------
//
// The catalog, in display order. href (and thumbnail, when a
// deck has one) point into the statically served
// /served/presentations/ folder. An entry may also carry
// buttons — an arbitrary list of { label, href, variant }
// shown as a row above the poster (deep links into the deck's
// steps, related pages, anything). variant is optional and
// takes any MUI Button variant — 'outlined' (the default),
// 'contained' or 'text'.
//
// Used by:
//   - PresentationsPage (below) — one PresentationCard per entry
// -----------------------------------------------------------

const PRESENTATIONS = [
  {
    title: 'Dvigubo apmokėjimo ataka naudojant Replace by Fee (RBF)',
    description: 'Replace by Fee (RBF) yra mechanizmas, kuris leidžia naudotojams pakeisti transakciją. Šis '
      + 'mechanizmas buvo sukurtas tam, kad kriptovaliutos naudotojai galėtų atnaujinti užstrigusias transakcijas '
      + 'ir pakelti kasėjams mokamą transakcijos mokestį, taip paspartinant transakcijos patvirtinimą '
      + 'blokų grandinėje. Interaktyvi 3D simuliacija žingsnis po žingsnio parodo mokesčių rinką, '
      + 'mempool\'ą, transakcijos pakeitimą ir kaip apsisaugoti nuo dvigubo apmokėjimo.',
    href: '/served/presentations/rbf/rbf.html',
    thumbnail: '/served/presentations/rbf/Thumbnail.png',
    buttons: [
      { 
        label: 'Atliktos atakos pavyzdys', 
        href: '/served/presentations/rbf/RBFVideo_vosr2_1440p.mp4',
        variant: "contained",
      },
      { 
        label: 'Prezentacija', 
        href: '/served/presentations/rbf/rbf.html',
        variant: "contained",
      },
    ],
  },
  {
    title: 'Blokų grandinės skilimas',
    description: 'Kriptovaliutos grandinės skilimas yra procesas, kai panašiu metu tinkle iškasami '
      + 'du blokai ir abu paskleidžiami visame tinkle. Blokų grandinės dalyviai toliau '
      + 'bando iškasti naują bloką ant to, kurį gavo pirmiau. Kai atrandamas '
      + 'tolimesnis blokas, jis taip pat paskelbiamas visame tinkle, ir tie dalyviai, kurie '
      + 'buvo kitoje atšakoje, persiorientuoja ir tęsia darbus ilgiausioje grandinėje. '
      + 'Interaktyvi 3D simuliacija parodo skilimą, ilgiausios grandinės taisyklę, '
      + 'pasenusius (stale) blokus, reorganizacijas ir 51% ataką.',
    href: '/served/presentations/fork/fork.html',
  },
];








// -----------------------------------------------------------
// PresentationCard
// -----------------------------------------------------------
//
// One deck: burgundy title, the explanation paragraph, the
// entry's extra buttons (when it has any), then the action —
// a poster with a centred Play badge when the entry sets a
// thumbnail (sitting where the old video player used to, one
// link over the whole image), or the plain "Atidaryti
// prezentaciją" button when it does not. Everything opens in
// a new tab — the deck is a standalone full-screen page
// outside the SPA, with no way back, so the faucet stays open
// in this tab.
//
// Used by:
//   - PresentationsPage (below) — one per PRESENTATIONS entry
// -----------------------------------------------------------

function PresentationCard({ title, description, href, thumbnail, buttons }) {
  return (
    <Card className="shadow-lg">
      <CardContent className="p-6">
        <Typography
          variant="h5"
          component="h2"
          className="mb-4"
          sx={{ color: 'var(--color-primary)', fontWeight: 'bold' }}
        >
          {title}
        </Typography>

        <Typography variant="body1" className="text-gray-600 pb-4 pt-2">
          {description}
        </Typography>

        {/* The entry's own buttons — whatever links the catalog
            entry declares, in its order */}
        {buttons?.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-6">
            {buttons.map((button) => (
              <Button
                key={button.href}
                variant={button.variant || 'outlined'}
                component="a"
                href={button.href}
                target="_blank"
                rel="noopener"
              >
                {button.label}
              </Button>
            ))}
          </div>
        )}

        {/* The poster IS the open action — the old <video> slot,
            slightly narrower and centred. The image is decorative
            (alt=""); the link carries the accessible name. Cards
            without a thumbnail fall back to the button. */}
        {thumbnail ? (
          <a
            href={href}
            target="_blank"
            rel="noopener"
            aria-label={`Atidaryti prezentaciją: ${title}`}
            className="group relative mx-auto block max-w-2xl"
          >
            <img
              src={thumbnail}
              alt=""
              className="w-full rounded-lg object-cover shadow-md"
              style={{ maxHeight: '400px' }}
            />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-full bg-black/50 p-3 transition group-hover:bg-black/70">
                <PlayArrowRoundedIcon sx={{ fontSize: 64, color: 'white', display: 'block' }} />
              </span>
            </span>
          </a>
        ) : (
          <Button
            variant="contained"
            component="a"
            href={href}
            target="_blank"
            rel="noopener"
          >
            Atidaryti prezentaciją
          </Button>
        )}
      </CardContent>
    </Card>
  );
}








// -----------------------------------------------------------
// PresentationsPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - App.jsx — route /presentations
// -----------------------------------------------------------

export default function PresentationsPage() {
  return (
    <Box className="flex flex-1 justify-center p-8">
      <Box className="max-w-4xl w-full">

        {/* Title */}
        <Typography
          variant="h3"
          component="h1"
          className="text-center pb-8"
          sx={{ color: 'var(--color-primary)', fontWeight: 'bold' }}
        >
          Prezentacijos
        </Typography>

        {/* One card per deck */}
        <Box className="space-y-8">
          {PRESENTATIONS.map((presentation) => (
            <PresentationCard key={presentation.href} {...presentation} />
          ))}
        </Box>

      </Box>
    </Box>
  );
}
