import { Box, styled } from '@mui/material';

export const RoundedBox = styled(Box)(({ theme }) => ({
  background: theme.palette.background.default,
  borderRadius: theme.shape.borderRadius,
  margin: `${theme.spacing(2)} auto`,
  padding: theme.spacing(2),
  minWidth: theme.spacing(40),
  maxWidth: theme.spacing(70),
  width: '100%',
  webkitBoxShadow: '2px 4px 10px 1px rgba(0, 0, 0, 0.47)',
  boxShadow: '2px 4px 10px 1px rgba(201, 201, 201, 0.47)',
  ...theme.typography.body2,
}));