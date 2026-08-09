import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Adresse de l'API.
 *
 * Sur un appareil physique, « localhost » désigne le téléphone lui-même : on
 * reprend donc l'adresse de la machine qui sert le paquet de développement,
 * connue d'Expo. En production, la valeur vient de `extra.apiUrl` (app.json,
 * surchargeable par la configuration de build).
 */
function resolveApiUrl(): string {
  const configured = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

  if (configured && !configured.includes('localhost')) return configured;

  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.split(':')[0];

  if (host) return `http://${host}:3000`;

  // Émulateur Android : 10.0.2.2 est l'hôte vu depuis la machine virtuelle.
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';

  return configured ?? 'http://localhost:3000';
}

export const API_URL = resolveApiUrl();

/**
 * Cadence de publication de la position, en millisecondes.
 *
 * Compromis entre fraîcheur du suivi côté client et consommation de batterie
 * et de données. Le §16 rappelle que le coût compte : dix positions par minute
 * suffisent à un suivi lisible.
 */
export const LOCATION_INTERVAL_MS = 6_000;

/** Cadence d'interrogation des offres de course lorsque le chauffeur est en ligne. */
export const OFFER_POLL_MS = 4_000;
