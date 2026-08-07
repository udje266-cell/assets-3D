/**
 * Attribution des courses — §19 du cahier des charges.
 *
 * « Le système recherche les chauffeurs disponibles dans une zone définie.
 *   Critères possibles : distance, disponibilité, catégorie de véhicule, temps
 *   estimé d'arrivée et règles opérationnelles. En cas de refus ou d'absence de
 *   réponse, la demande peut être proposée à un autre chauffeur. »
 *
 * Le classement est une fonction pure de scoring : changer de stratégie
 * (priorité aux chauffeurs les moins servis, zones à forte demande, etc.)
 * revient à changer les poids ou la fonction, sans toucher au reste du système.
 */

export interface DispatchCandidate {
  driverId: string;
  /** Distance au point de départ, en mètres. */
  distanceMeters: number;
  /** Temps estimé d'arrivée au point de départ, en secondes. */
  etaSeconds: number;
  /** Note moyenne du chauffeur (0 à 5). */
  rating: number;
  /** Nombre d'offres reçues sur la période de référence. */
  offersReceived: number;
  /** Nombre d'offres acceptées sur la période de référence. */
  offersAccepted: number;
  /** Ancienneté de la dernière position connue, en secondes. */
  locationAgeSeconds: number;
}

export interface DispatchWeights {
  distance: number;
  eta: number;
  rating: number;
  acceptance: number;
}

/**
 * Poids par défaut. La distance domine : c'est le critère qui détermine
 * l'attente du client, indicateur suivi au §24 (« temps moyen d'attente »).
 */
export const DEFAULT_WEIGHTS: DispatchWeights = {
  distance: 0.5,
  eta: 0.25,
  rating: 0.15,
  acceptance: 0.1,
};

export interface DispatchConstraints {
  /** Rayon de recherche, en mètres. */
  radiusMeters: number;
  /** Au-delà, la position est jugée trop ancienne pour être fiable. */
  maxLocationAgeSeconds: number;
  /** Nombre maximum de chauffeurs retenus. */
  maxCandidates: number;
}

export interface ScoredCandidate extends DispatchCandidate {
  /** Score entre 0 et 1 — plus il est élevé, meilleur est le candidat. */
  score: number;
}

/**
 * Taux d'acceptation du chauffeur. Un chauffeur sans historique reçoit une
 * valeur neutre : ne pas le pénaliser à ses premières courses, ne pas le
 * favoriser non plus.
 */
export function acceptanceRate(candidate: DispatchCandidate): number {
  if (candidate.offersReceived <= 0) return 0.7;
  return Math.min(1, candidate.offersAccepted / candidate.offersReceived);
}

/** Score composite dans [0, 1]. */
export function scoreCandidate(
  candidate: DispatchCandidate,
  constraints: DispatchConstraints,
  weights: DispatchWeights = DEFAULT_WEIGHTS,
): number {
  // Chaque critère est normalisé dans [0, 1] où 1 est le meilleur.
  const distanceScore = 1 - Math.min(1, candidate.distanceMeters / constraints.radiusMeters);
  // Référence d'ETA : 10 minutes, au-delà le critère est saturé.
  const etaScore = 1 - Math.min(1, candidate.etaSeconds / 600);
  const ratingScore = Math.min(1, Math.max(0, candidate.rating) / 5);
  const acceptanceScore = acceptanceRate(candidate);

  const totalWeight = weights.distance + weights.eta + weights.rating + weights.acceptance;
  if (totalWeight <= 0) throw new Error('La somme des poids d’attribution doit être positive.');

  return (
    (distanceScore * weights.distance +
      etaScore * weights.eta +
      ratingScore * weights.rating +
      acceptanceScore * weights.acceptance) /
    totalWeight
  );
}

/**
 * Filtre puis classe les candidats.
 *
 * Les candidats dont la position est trop ancienne ou hors rayon sont écartés :
 * proposer une course à un chauffeur injoignable fait perdre un cycle d'offre
 * et allonge l'attente du client.
 */
export function rankCandidates(
  candidates: readonly DispatchCandidate[],
  constraints: DispatchConstraints,
  weights: DispatchWeights = DEFAULT_WEIGHTS,
): ScoredCandidate[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.distanceMeters <= constraints.radiusMeters &&
        candidate.locationAgeSeconds <= constraints.maxLocationAgeSeconds,
    )
    .map((candidate) => ({ ...candidate, score: scoreCandidate(candidate, constraints, weights) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Départage déterministe : le plus proche, puis l'identifiant, afin que
      // deux exécutions sur les mêmes données donnent le même ordre.
      if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
      return a.driverId.localeCompare(b.driverId);
    })
    .slice(0, constraints.maxCandidates);
}
