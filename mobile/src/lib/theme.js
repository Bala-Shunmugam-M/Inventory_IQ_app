/**
 * InventoryIQ — Shared theme tokens
 * Mirrors the colour palette of the web build for visual continuity.
 */
export const COLORS = {
  bg: '#F3F5FB',
  white: '#FFFFFF',
  surface: '#EAEEF8',
  border: '#DDE3F0',
  ink: '#0D1226',
  ink2: '#2A3456',
  muted: '#7B849E',
  light: '#C2CADF',
  blue: '#2563EB',
  blueLight: '#EEF3FF',
  red: '#DC2626',
  redLight: '#FEF2F2',
  amber: '#D97706',
  amberLight: '#FFFBEB',
  green: '#059669',
  greenLight: '#ECFDF5',
  purple: '#7C3AED',
  purpleLight: '#F5F3FF',
};

export const STATUS_LABEL = {
  critical: 'CRITICAL',
  order: 'ORDER NOW',
  watch: 'WATCH',
  good: 'GOOD',
};

export const STATUS_COLORS = {
  critical: { bg: COLORS.redLight, fg: COLORS.red },
  order: { bg: '#FFEDD5', fg: '#C2410C' },
  watch: { bg: COLORS.amberLight, fg: COLORS.amber },
  good: { bg: COLORS.greenLight, fg: COLORS.green },
};

export const SHADOWS = {
  card: {
    shadowColor: '#0D1226',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
};
