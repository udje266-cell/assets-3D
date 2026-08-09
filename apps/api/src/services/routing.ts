import {
  estimateDurationSeconds,
  estimateRoadDistanceMeters,
  haversineMeters,
  type Coordinates,
} from '../domain/geo.js';

/**
 * Service d'itinéraire (§17, livrable « intégration cartographique »).
 *
 * L'implémentation fournie n'appelle aucun service externe : elle corrige la
 * distance à vol d'oiseau par un facteur de sinuosité. C'est suffisant pour
 * développer, tester et lancer un pilote sur une zone restreinte, et cela évite
 * de dépendre d'un fournisseur avant que le choix ne soit arrêté.
 *
 * Brancher un fournisseur revient à implémenter cette interface et à changer
 * l'instance passée au contexte applicatif — aucun code métier ne change.
 */
export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
  /** Renseigne l'origine de l'estimation, utile en support et en audit. */
  source: string;
}

export interface RoutingProvider {
  estimateRoute(from: Coordinates, to: Coordinates): Promise<RouteEstimate>;
}

export interface HaversineRoutingOptions {
  detourFactor: number;
  averageSpeedKmh: number;
}

export class HaversineRoutingProvider implements RoutingProvider {
  constructor(private readonly options: HaversineRoutingOptions) {}

  async estimateRoute(from: Coordinates, to: Coordinates): Promise<RouteEstimate> {
    const distanceMeters = estimateRoadDistanceMeters(from, to, this.options.detourFactor);
    return {
      distanceMeters,
      durationSeconds: estimateDurationSeconds(distanceMeters, this.options.averageSpeedKmh),
      source: `haversine×${this.options.detourFactor}`,
    };
  }
}

/** Distance à vol d'oiseau, sans correction — utilisée pour le classement des chauffeurs. */
export function straightLineMeters(from: Coordinates, to: Coordinates): number {
  return haversineMeters(from, to);
}
