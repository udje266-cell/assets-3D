/**
 * Jetons visuels partagés par les deux applications.
 *
 * Un seul jeu de couleurs, deux accents : bleu pour le client, vert pour le
 * chauffeur — de sorte qu'un chauffeur ouvrant les deux applications sache
 * immédiatement laquelle il regarde. Les valeurs proviennent de la même
 * palette que l'administration.
 */

export const palette = {
  surface0: '#f5f5f3',
  surface1: '#ffffff',
  surface2: '#eeeeeb',
  border: '#dcdcd6',
  borderStrong: '#c2c2ba',

  textPrimary: '#0b0b0b',
  textSecondary: '#52514e',
  textMuted: '#7a7975',
  textInverse: '#ffffff',

  clientAccent: '#2a78d6',
  driverAccent: '#1a7f4b',

  good: '#1a7f4b',
  goodBg: '#e3f3ea',
  warning: '#a86400',
  warningBg: '#fbf0dc',
  critical: '#c02b2b',
  criticalBg: '#fbe6e6',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.4 },
  heading: { fontSize: 18, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  amount: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.6 },
} as const;

/** Position de repli : Plateau, Abidjan (§1 — zone de lancement envisagée). */
export const DEFAULT_REGION = {
  latitude: 5.3364,
  longitude: -4.0267,
  latitudeDelta: 0.06,
  longitudeDelta: 0.06,
} as const;
