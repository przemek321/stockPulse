/**
 * Bloomberg/FactSet financial design system.
 * Single source of truth dla wszystkich komponentów dashboardu.
 *
 * Filozofia:
 * - Gęsta siatka informacji, mało paddingu
 * - Monospace dla liczb (alignment w kolumnach)
 * - Kanciaste komponenty (border-radius 2-4px, nie 8+)
 * - Tabular layout > cards
 * - Color-coded status indicators (zielony/czerwony/amber)
 * - Brak emoji w body, plain text labels (OK / STALE / ERR)
 */

// ── COLORS ────────────────────────────────────────────────

export const COLORS = {
  // Tła
  bg: {
    page: '#f5f7fa',         // off-white strony
    card: '#ffffff',          // czyste białe karty
    cardAlt: '#fafbfc',       // alternatywny wiersz tabeli
    header: '#1a3a6c',        // granat — top bar
    headerAlt: '#0d2547',     // ciemniejszy granat
    panel: '#f5f7fa',         // panel z border
    cellHover: '#eef2f7',     // hover row
    sectionDivider: '#e8ecf2', // divider section
  },

  // Tekst
  text: {
    primary: '#1a1a1a',       // główny tekst
    secondary: '#5a6478',     // szary label
    muted: '#9aa3b2',         // wyciszony
    inverse: '#ffffff',       // tekst na ciemnym tle
    accent: '#1a3a6c',        // navy accent (links, headers)
  },

  // Status / kierunek
  up: '#0a8754',              // głęboka zieleń (gain)
  upBg: '#e6f4ed',            // tło dla gain
  upBorder: '#34a374',        // border up
  down: '#c41e3a',            // głęboka czerwień (loss)
  downBg: '#fce8ec',          // tło dla loss
  downBorder: '#e0405e',      // border down
  neutral: '#9aa3b2',
  neutralBg: '#f5f7fa',

  // Warning / amber
  warning: '#e8a317',
  warningBg: '#fff4e0',
  warningBorder: '#f0c890',

  // Borders
  border: '#e1e5eb',
  borderStrong: '#cdd4de',
  borderAccent: '#1a3a6c',

  // Akcenty
  accent: '#0288d1',          // petrol blue
  accentBg: '#e3f2fd',
} as const;

// ── TYPOGRAPHY ────────────────────────────────────────────

export const TYPOGRAPHY = {
  // Inter dla UI, IBM Plex Mono dla liczb
  sansFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  monoFamily: '"IBM Plex Mono", "JetBrains Mono", Consolas, "Courier New", monospace',

  // Sizes
  size: {
    xs: '0.65rem',   // tiny labels (10.4px)
    sm: '0.7rem',    // labels (11.2px)
    base: '0.75rem', // body (12px) — Bloomberg jest gęsty
    md: '0.8125rem', // body large (13px)
    lg: '0.875rem',  // emphasis (14px)
    xl: '1rem',      // h6
    xxl: '1.125rem', // h5
  },

  // Weights
  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  // Letter spacing dla uppercase nagłówków
  uppercase: {
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase' as const,
  },
} as const;

// ── SPACING (gęsta siatka) ────────────────────────────────

export const SPACING = {
  xs: 0.5,   // 4px
  sm: 1,     // 8px
  md: 1.5,   // 12px
  lg: 2,     // 16px
  xl: 3,     // 24px
} as const;

// ── HELPERS ───────────────────────────────────────────────

/**
 * Format ceny jako finance: $1,234.56 z monospace
 */
export const fmtPrice = (v: number | null | undefined, decimals = 2): string => {
  if (v == null) return '—';
  return `$${Number(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
};

/**
 * Format delty z znakiem: +1.23% / -0.45%
 */
export const fmtDelta = (v: number | null | undefined): string => {
  if (v == null) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
};

/**
 * Format dużych liczb: 1.2M, 450K
 */
export const fmtLargeNum = (v: number | null | undefined): string => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toString();
};

/**
 * Format dollar amount: $1.2M / $450K
 */
export const fmtDollarLarge = (v: number | null | undefined): string => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

/**
 * Kolor delty: zielony jeśli >0, czerwony jeśli <0, neutralny jeśli null/0
 */
export const deltaColor = (v: number | null | undefined): string => {
  if (v == null || v === 0) return COLORS.neutral;
  return v > 0 ? COLORS.up : COLORS.down;
};

/**
 * Status text: OK / STALE / ERR z kolorem
 */
export type Status = 'OK' | 'STALE' | 'ERR' | 'WARN' | 'OFF';

export const statusColor = (s: Status): string => {
  switch (s) {
    case 'OK': return COLORS.up;
    case 'STALE': return COLORS.warning;
    case 'WARN': return COLORS.warning;
    case 'ERR': return COLORS.down;
    case 'OFF': return COLORS.neutral;
  }
};

export const statusBg = (s: Status): string => {
  switch (s) {
    case 'OK': return COLORS.upBg;
    case 'STALE': return COLORS.warningBg;
    case 'WARN': return COLORS.warningBg;
    case 'ERR': return COLORS.downBg;
    case 'OFF': return COLORS.neutralBg;
  }
};

/**
 * Format daty jako YYYY-MM-DD HH:MM (terminal style)
 */
export const fmtTimestamp = (v: string | Date | null): string => {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  const hr = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${yr}-${mo}-${dy} ${hr}:${mn}`;
};

/**
 * Format relative time: 5m ago, 2h ago, 3d ago
 */
export const fmtRelative = (v: string | Date | null): string => {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  const diffMs = Math.max(0, Date.now() - d.getTime());
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const dy = Math.floor(hr / 24);
  return `${dy}d`;
};

// ── COMPONENT STYLES (sx props gotowe do użycia) ─────────

/** Bloomberg-style label (uppercase, mały, semibold, szary) */
export const labelSx = {
  ...TYPOGRAPHY.uppercase,
  color: COLORS.text.secondary,
  display: 'block',
  lineHeight: 1.4,
};

/** Bloomberg-style metric value (duża liczba w monospace) */
export const metricSx = {
  fontFamily: TYPOGRAPHY.monoFamily,
  fontSize: TYPOGRAPHY.size.lg,
  fontWeight: TYPOGRAPHY.weight.bold,
  color: COLORS.text.primary,
  lineHeight: 1.2,
};

/** Mała wartość metryczna */
export const metricSmallSx = {
  fontFamily: TYPOGRAPHY.monoFamily,
  fontSize: TYPOGRAPHY.size.md,
  fontWeight: TYPOGRAPHY.weight.semibold,
  color: COLORS.text.primary,
  lineHeight: 1.2,
};

/** Standard panel (biała karta z border) */
export const panelSx = {
  bgcolor: COLORS.bg.card,
  border: `1px solid ${COLORS.border}`,
  borderRadius: '2px',
  p: 1.5,
};

/** Compact panel (mniejszy padding) */
export const panelCompactSx = {
  bgcolor: COLORS.bg.card,
  border: `1px solid ${COLORS.border}`,
  borderRadius: '2px',
  p: 1,
};

/** Top bar / header style */
export const topBarSx = {
  bgcolor: COLORS.bg.header,
  color: COLORS.text.inverse,
  borderBottom: `2px solid ${COLORS.accent}`,
  px: 2,
  py: 1,
};

/** Section divider line */
export const dividerSx = {
  borderColor: COLORS.border,
  my: 1.5,
};
