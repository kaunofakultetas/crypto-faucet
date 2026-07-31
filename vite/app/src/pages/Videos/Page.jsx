// -----------------------------------------------------------
//  [*] Pages — Videos (route /videos)
//
//  Lecture videos for the course: one titled card per video,
//  each with a short Lithuanian explanation and an mp4
//  player. The files are served statically from
//  /served/videos/ (outside the SPA). Adding a video means
//  adding one VIDEOS entry.
//
//  Split into (root component last):
//
//    VIDEOS     — the playlist (title, description, src)
//    VideoCard  — one titled card with the player
//    VideosPage — layout (default export)
// -----------------------------------------------------------

import { Box, Typography, Card, CardContent } from '@mui/material';







// -----------------------------------------------------------
// VIDEOS
// -----------------------------------------------------------
//
// The playlist, in display order. src points into the
// statically served /served/videos/ folder.
//
// Used by:
//   - VideosPage (below) — one VideoCard per entry
// -----------------------------------------------------------

const VIDEOS = [
  {
    title: 'Dvigubo apmokėjimo ataka naudojant Replace by Fee (RBF)',
    description: 'Replace by Fee (RBF) yra mechanizmas, kuris leidžia vartotojams pakeisti transakciją. Šis '
      + 'mechanizmas buvo sukurtas tam jog kriptovaliutos naudojai galėtų atnaujinti užstrigusias transakcijas '
      + 'ir pakelti transakcijos mokomą mokestį kasėjams taip paspartinant transakcijos patvirtinimą '
      + 'blokų grandinėje.',
    src: '/served/videos/01.ReplaceByFee.mp4',
  },
  {
    title: 'Blokų Grandinės Skylimas (Natūralus)',
    description: 'Kriptovaliutos grandinės skylimas (natūralus) yra procesas, kai panašiu laiku yra iškasami '
      + 'du blokai tinkle šie blokai yra propaguojami visame tinkle. Blokų grandinės dalyviai toliau '
      + 'tęsia ir bando iškasti naują bloką ant to kurį gavo pirmiau. Kai yra atrandamas '
      + 'tolimesnis blokas šis blokas taip pat yra paviešinamas visame tinkle ir tie dalyviai kurie '
      + 'buvo kitoje atšakoje persioriantuoja ir tęsia darbus ilgiausioje grandinėje.',
    src: '/served/videos/05.MiningForkResolution.mp4',
  },
];







// -----------------------------------------------------------
// VideoCard
// -----------------------------------------------------------
//
// One video: burgundy title, the explanation paragraph and
// the player — metadata preloaded only, the mp4 itself starts
// downloading on play.
//
// Used by:
//   - VideosPage (below) — one per VIDEOS entry
// -----------------------------------------------------------

function VideoCard({ title, description, src }) {
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

        <Box className="w-full">
          <video
            className="w-full max-w-full rounded-lg shadow-md"
            controls
            preload="metadata"
            style={{ maxHeight: '500px' }}
          >
            <source src={src} type="video/mp4" />
            Jūsų naršyklė nepalaiko video elemento.
          </video>
        </Box>
      </CardContent>
    </Card>
  );
}







// -----------------------------------------------------------
// VideosPage (default export)
// -----------------------------------------------------------
//
// Used by:
//   - main.jsx — route /videos (imported as VideosPage)
// -----------------------------------------------------------

export default function VideosPage() {
  return (
    <Box className="flex justify-center min-h-[calc(100vh-105px)] p-8">
      <Box className="max-w-4xl w-full">

        {/* Title */}
        <Typography
          variant="h3"
          component="h1"
          className="text-center pb-8"
          sx={{ color: 'var(--color-primary)', fontWeight: 'bold' }}
        >
          Vaizdo Įrašai
        </Typography>

        {/* One card per video */}
        <Box className="space-y-8">
          {VIDEOS.map((video) => (
            <VideoCard key={video.src} {...video} />
          ))}
        </Box>

      </Box>
    </Box>
  );
}
