import { Alert, Linking, Platform } from 'react-native';
import type { Coordinates } from '@mobilite/shared';

/**
 * Navigation embarquée — §5 : « navigation jusqu'au client puis jusqu'à la
 * destination ».
 *
 * La plateforme n'embarque pas son propre guidage : elle passe la main à
 * l'application de navigation déjà installée sur le téléphone. C'est le choix
 * raisonnable — un chauffeur connaît son outil, l'a configuré à son goût, et
 * ses cartes sont à jour ; refaire un guidage moins bon ne rendrait service à
 * personne.
 *
 * L'ordre d'essai suit ce qu'un chauffeur attend : d'abord son application
 * préférée si elle est installée, puis le schéma générique du système.
 */

export type NavigationApp = 'google_maps' | 'waze' | 'apple_maps' | 'system';

interface Candidate {
  app: NavigationApp;
  url: string;
}

/**
 * Adresses d'appel possibles, dans l'ordre de préférence.
 *
 * Le libellé accompagne les coordonnées lorsque le schéma l'accepte : voir
 * « Cocody, Riviera 2 » plutôt qu'un couple de nombres aide le chauffeur à
 * vérifier d'un coup d'œil qu'il part au bon endroit.
 */
function candidates(destination: Coordinates, label?: string | null): Candidate[] {
  const { latitude, longitude } = destination;
  const query = `${latitude},${longitude}`;
  const encodedLabel = label ? encodeURIComponent(label) : '';

  const list: Candidate[] = [
    { app: 'waze', url: `waze://?ll=${query}&navigate=yes` },
    {
      app: 'google_maps',
      url: Platform.select({
        ios: `comgooglemaps://?daddr=${query}&directionsmode=driving`,
        default: `google.navigation:q=${query}`,
      }),
    },
  ];

  if (Platform.OS === 'ios') {
    list.push({ app: 'apple_maps', url: `maps://?daddr=${query}&dirflg=d` });
    list.push({ app: 'system', url: `http://maps.apple.com/?daddr=${query}&dirflg=d` });
  } else {
    // Schéma géographique standard d'Android : pris en charge par toute
    // application de cartographie installée, y compris hors des grands noms.
    list.push({
      app: 'system',
      url: encodedLabel
        ? `geo:${query}?q=${query}(${encodedLabel})`
        : `geo:${query}?q=${query}`,
    });
  }

  return list;
}

/**
 * Ouvre le guidage vers un point. Renvoie l'application effectivement lancée,
 * ou `null` si aucune n'a pu l'être.
 */
export async function openNavigation(
  destination: Coordinates,
  label?: string | null,
): Promise<NavigationApp | null> {
  for (const candidate of candidates(destination, label)) {
    try {
      if (await Linking.canOpenURL(candidate.url)) {
        await Linking.openURL(candidate.url);
        return candidate.app;
      }
    } catch {
      // Schéma non pris en charge par cet appareil : on essaie le suivant.
    }
  }

  // Dernier recours : le navigateur web, présent sur tout téléphone.
  const fallback = `https://www.google.com/maps/dir/?api=1&destination=${destination.latitude},${destination.longitude}&travelmode=driving`;
  try {
    await Linking.openURL(fallback);
    return 'system';
  } catch {
    return null;
  }
}

/**
 * Variante avec message d'erreur : à utiliser depuis un écran, pour qu'un échec
 * ne reste pas silencieux au moment où le chauffeur attend son guidage.
 */
export async function navigateTo(
  destination: Coordinates,
  label?: string | null,
): Promise<void> {
  const opened = await openNavigation(destination, label);

  if (!opened) {
    Alert.alert(
      'Navigation indisponible',
      'Aucune application de navigation n’a pu être ouverte sur cet appareil.',
    );
  }
}
