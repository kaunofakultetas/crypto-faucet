// -----------------------------------------------------------
//  [*] Graph_UTXO — DateSliderBar
//
//  The day picker at the top of the page: ONE compact row with
//  three ways to pick a day, all over the SAME list of used
//  days — the searchable dropdown (newest first; typing part
//  of a date filters it), then the − / + steppers (exactly
//  one used day earlier / later) around the slider. Slider
//  positions are indices into `days`, the rightmost the
//  newest; the tooltip previews WHILE dragging, the graph
//  switches only on release. With a single known day there is
//  nothing to step or slide — the row shrinks to the dropdown
//  alone.
//
//  The same control as the EVM graph's (pages/Graph/Page.jsx)
//  — keep the two in step until they share one file.
// -----------------------------------------------------------

import { useState } from 'react';

import { Autocomplete, Box, IconButton, Slider, TextField } from '@mui/material';
import TodayIcon from '@mui/icons-material/Today';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';


// The round brand-coloured day-stepper buttons
const STEP_BUTTON_SX = {
  bgcolor: 'primary.main',
  color: 'common.white',
  '&:hover': { bgcolor: 'primary.dark' },
  '&.Mui-disabled': { bgcolor: 'action.disabledBackground' },
  width: 26,
  height: 26,
  borderRadius: '50%',
};







// -----------------------------------------------------------
// DateSliderBar (default export)
// -----------------------------------------------------------
//
// The row, controlled by the page: `days` is the list of used
// days, ascending with today last; selectedDay is the day on
// show — one that fell out of the list shows as the newest;
// today is the day the dropdown marks "(šiandien)"; and
// onCommit receives every day picked, from the dropdown, a
// stepper or the slider's release.
//
// Used by:
//   - Page.jsx — the middle of the title row
// -----------------------------------------------------------

export default function DateSliderBar({ days, selectedDay, today, onCommit }) {

  const [draftIndex, setDraftIndex] = useState(null);

  // A day that fell out of the list shows as the newest, not
  // the oldest
  const foundIndex = days.indexOf(selectedDay);
  const selectedIndex = foundIndex === -1 ? days.length - 1 : foundIndex;
  const shownIndex = draftIndex ?? selectedIndex;


  const commitIndex = (index) => {
    const clamped = Math.min(Math.max(index, 0), days.length - 1);
    setDraftIndex(null);
    onCommit(days[clamped]);
  };

  const dayText = (day) => (day === today ? `${day} (šiandien)` : day);


  return (
    <Box className={`card-surface flex w-full items-center gap-3 px-4 py-2 ${days.length > 1 ? '' : 'justify-center'}`}>
      <TodayIcon sx={{ color: 'primary.main' }} />
      <Autocomplete
        size="small"
        options={[...days].reverse()}
        value={selectedDay}
        onChange={(_, value) => value && onCommit(value)}
        getOptionLabel={dayText}
        disableClearable
        sx={{ width: 220 }}
        renderInput={(params) => <TextField {...params} label="Data" />}
      />

      {days.length > 1 && (
        <>
          <IconButton
            size="small"
            aria-label="Ankstesnė diena"
            onClick={() => commitIndex(selectedIndex - 1)}
            disabled={selectedIndex === 0}
            sx={STEP_BUTTON_SX}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>

          <Slider
            size="small"
            value={shownIndex}
            min={0}
            max={days.length - 1}
            step={1}
            valueLabelDisplay="auto"
            valueLabelFormat={(index) => days[index] ?? ''}
            onChange={(_, value) => setDraftIndex(Array.isArray(value) ? value[0] : value)}
            onChangeCommitted={(_, value) => commitIndex(Array.isArray(value) ? value[0] : value)}
            aria-label="Diena"
            sx={{ flex: 1 }}
          />

          <IconButton
            size="small"
            aria-label="Kita diena"
            onClick={() => commitIndex(selectedIndex + 1)}
            disabled={selectedIndex >= days.length - 1}
            sx={STEP_BUTTON_SX}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </>
      )}
    </Box>
  );
}
