import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { API_URL, LOCATION_INTERVAL_MS } from './config';
import { secureStorage } from './storage';

/**
 * Remontée de position en arrière-plan pendant une course — §4.
 *
 * Un chauffeur range son téléphone, l'écran s'éteint, l'application passe en
 * arrière-plan : sans cette tâche, le client cesserait de le voir avancer au
 * moment précis où il l'attend, et la trace GPS de la course — pièce du dossier
 * en cas de litige (§15) — serait trouée.
 *
 * Contraintes que ce module respecte :
 *  - la tâche ne tourne **que pendant une course**, jamais quand le chauffeur
 *    est simplement en ligne : c'est de la batterie, des données, et une donnée
 *    personnelle qu'on ne collecte pas sans raison ;
 *  - elle s'exécute hors du contexte React : elle ne peut pas utiliser
 *    `ApiClient`, et lit donc le jeton directement dans le trousseau ;
 *  - un échec réseau est absorbé sans bruit — le système rappellera la tâche à
 *    la position suivante.
 */

export const LOCATION_TASK = 'mobilite-driver-location';

const ACCESS_KEY = 'mobilite.access';

interface LocationTaskData {
  locations: Location.LocationObject[];
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;

  const { locations } = data as LocationTaskData;
  const latest = locations.at(-1);
  if (!latest) return;

  const token = await secureStorage.get(ACCESS_KEY);
  if (!token) return;

  try {
    await fetch(`${API_URL}/v1/driver/location`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        latitude: latest.coords.latitude,
        longitude: latest.coords.longitude,
        ...(latest.coords.heading !== null ? { heading: latest.coords.heading } : {}),
        ...(latest.coords.speed !== null && latest.coords.speed >= 0
          ? { speedKmh: latest.coords.speed * 3.6 }
          : {}),
        ...(latest.coords.accuracy !== null ? { accuracyM: latest.coords.accuracy } : {}),
      }),
    });
  } catch {
    // Réseau mobile coupé : la position suivante repartira. Rien à signaler,
    // le serveur tolère les trous et l'écran de suivi a son propre repli.
  }
});

/**
 * Demande l'autorisation de localisation en arrière-plan.
 *
 * Elle se demande en deux temps, comme l'imposent iOS et Android : d'abord
 * pendant l'utilisation, ensuite seulement en continu. Un refus n'est pas
 * bloquant — la course se déroule normalement, seul le suivi écran éteint est
 * perdu.
 */
export async function requestBackgroundPermission(): Promise<boolean> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return false;

  const background = await Location.requestBackgroundPermissionsAsync();
  return background.status === 'granted';
}

export async function isTrackingInBackground(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Démarre le suivi. Sans effet si l'autorisation manque ou s'il tourne déjà. */
export async function startBackgroundTracking(): Promise<boolean> {
  if (await isTrackingInBackground()) return true;

  const { status } = await Location.getBackgroundPermissionsAsync();
  if (status !== 'granted') return false;

  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: LOCATION_INTERVAL_MS,
      distanceInterval: 30,
      // Android impose une notification persistante pour une localisation
      // continue : elle rend le suivi visible du chauffeur, qui doit pouvoir
      // constater à tout moment que sa position remonte — et pourquoi.
      foregroundService: {
        notificationTitle: 'Course en cours',
        notificationBody: 'Votre position est transmise au client pendant la course.',
        notificationColor: '#1a7f4b',
      },
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      // Regroupe les positions en cas de coupure réseau plutôt que de les perdre.
      deferredUpdatesInterval: LOCATION_INTERVAL_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/** Arrête le suivi. Appelé dès que la course quitte un état actif. */
export async function stopBackgroundTracking(): Promise<void> {
  try {
    if (await isTrackingInBackground()) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Tâche déjà arrêtée, ou service système indisponible : sans conséquence.
  }
}
