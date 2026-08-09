/**
 * Calculs géographiques (§4).
 *
 * Tant qu'aucun service cartographique n'est branché, la distance routière est
 * approchée par la distance à vol d'oiseau corrigée d'un facteur de sinuosité.
 * Le contrat de `RoutingProvider` (services/routing.ts) permet de remplacer
 * cette approximation par un vrai calcul d'itinéraire sans toucher au métier.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Rayon moyen de la Terre en mètres (sphère WGS-84). */
const EARTH_RADIUS_M = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export function isValidCoordinates(point: Coordinates): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

/** Distance orthodromique (haversine) entre deux points, en mètres. */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * Cadre englobant d'un rayon donné autour d'un point.
 *
 * Utilisé comme préfiltre indexable en SQL avant le calcul haversine exact :
 * l'index B-tree sur (latitude, longitude) ne sait pas répondre à « à moins de
 * 5 km », mais il sait répondre à « dans ce rectangle ».
 */
export function boundingBox(
  center: Coordinates,
  radiusMeters: number,
): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
  const latDelta = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  // Aux latitudes proches des pôles, cos tend vers 0 : on borne pour éviter une
  // largeur infinie (sans objet en Côte d'Ivoire, mais le code doit rester sûr).
  const cosLat = Math.max(Math.cos(toRadians(center.latitude)), 1e-6);
  const lonDelta = latDelta / cosLat;

  return {
    minLat: Math.max(-90, center.latitude - latDelta),
    maxLat: Math.min(90, center.latitude + latDelta),
    minLon: Math.max(-180, center.longitude - lonDelta),
    maxLon: Math.min(180, center.longitude + lonDelta),
  };
}

/** Distance routière estimée : vol d'oiseau × facteur de sinuosité. */
export function estimateRoadDistanceMeters(
  from: Coordinates,
  to: Coordinates,
  detourFactor: number,
): number {
  return Math.round(haversineMeters(from, to) * detourFactor);
}

/** Durée estimée d'un trajet, en secondes, à vitesse moyenne donnée. */
export function estimateDurationSeconds(distanceMeters: number, averageSpeedKmh: number): number {
  if (averageSpeedKmh <= 0) throw new Error('La vitesse moyenne doit être strictement positive.');
  return Math.round((distanceMeters / 1000 / averageSpeedKmh) * 3600);
}

/** Longueur totale d'une trace GPS, en mètres (§4 : distance réelle parcourue). */
export function pathLengthMeters(points: readonly Coordinates[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    if (!previous || !current) continue;
    total += haversineMeters(previous, current);
  }
  return total;
}
