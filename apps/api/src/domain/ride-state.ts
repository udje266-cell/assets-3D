import type { ActorType, RideStatus } from '../db/types.js';

/**
 * Machine à états d'une course — §6 du cahier des charges.
 *
 * Enchaînement demandé : demande → recherche chauffeur → chauffeur trouvé →
 * chauffeur en route → chauffeur arrivé → passager à bord → course en cours →
 * course terminée → paiement → évaluation.
 *
 * S'y ajoutent les états d'échec qu'impose toute exploitation réelle :
 * annulation (par le client, le chauffeur ou un administrateur) et expiration
 * (aucun chauffeur trouvé).
 *
 * Ce module est pur : il décrit ce qui est permis, jamais ce qui est écrit.
 * `services/rides.ts` applique la décision dans une transaction et enregistre
 * l'événement correspondant dans `ride_events`.
 */

/** Transitions autorisées, avec les acteurs habilités à les déclencher. */
const TRANSITIONS: Record<RideStatus, Partial<Record<RideStatus, readonly ActorType[]>>> = {
  requested: {
    searching: ['system'],
    cancelled: ['client', 'admin'],
  },
  searching: {
    driver_assigned: ['driver', 'system'],
    expired: ['system'],
    cancelled: ['client', 'admin'],
  },
  driver_assigned: {
    driver_en_route: ['driver'],
    // Refus tardif ou indisponibilité : la course repart en recherche.
    searching: ['driver', 'system', 'admin'],
    cancelled: ['client', 'driver', 'admin'],
  },
  driver_en_route: {
    driver_arrived: ['driver'],
    searching: ['system', 'admin'],
    cancelled: ['client', 'driver', 'admin'],
  },
  driver_arrived: {
    in_progress: ['driver'],
    cancelled: ['client', 'driver', 'admin'],
  },
  in_progress: {
    completed: ['driver'],
    cancelled: ['admin'],
  },
  completed: {
    awaiting_payment: ['system'],
  },
  awaiting_payment: {
    paid: ['driver', 'admin', 'system'],
    cancelled: ['admin'],
  },
  paid: {
    rated: ['client'],
  },
  rated: {},
  cancelled: {},
  expired: {},
};

/** États depuis lesquels plus aucune transition n'est possible. */
export const TERMINAL_STATUSES: readonly RideStatus[] = ['rated', 'cancelled', 'expired'];

/** États pour lesquels un chauffeur est mobilisé et ne peut prendre d'autre course. */
export const DRIVER_BUSY_STATUSES: readonly RideStatus[] = [
  'driver_assigned',
  'driver_en_route',
  'driver_arrived',
  'in_progress',
];

/** États d'une course encore ouverte pour le client. */
export const ACTIVE_STATUSES: readonly RideStatus[] = [
  'requested',
  'searching',
  'driver_assigned',
  'driver_en_route',
  'driver_arrived',
  'in_progress',
];

/** États qui comptent comme une course honorée (base des indicateurs §24). */
export const FULFILLED_STATUSES: readonly RideStatus[] = [
  'completed',
  'awaiting_payment',
  'paid',
  'rated',
];

export function isTerminal(status: RideStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function nextStatuses(status: RideStatus): RideStatus[] {
  return Object.keys(TRANSITIONS[status]) as RideStatus[];
}

export type TransitionCheck =
  | { allowed: true }
  | { allowed: false; reason: string; code: 'terminal' | 'invalid_transition' | 'forbidden_actor' };

export function checkTransition(
  from: RideStatus,
  to: RideStatus,
  actor: ActorType,
): TransitionCheck {
  if (isTerminal(from)) {
    return {
      allowed: false,
      code: 'terminal',
      reason: `La course est dans un état terminal (${from}) : aucune transition possible.`,
    };
  }

  const actors = TRANSITIONS[from][to];
  if (!actors) {
    return {
      allowed: false,
      code: 'invalid_transition',
      reason: `Transition interdite : ${from} → ${to}.`,
    };
  }

  if (!actors.includes(actor)) {
    return {
      allowed: false,
      code: 'forbidden_actor',
      reason: `Un acteur de type « ${actor} » ne peut pas effectuer la transition ${from} → ${to}.`,
    };
  }

  return { allowed: true };
}

export function canTransition(from: RideStatus, to: RideStatus, actor: ActorType): boolean {
  return checkTransition(from, to, actor).allowed;
}

/**
 * Une annulation après l'arrivée du chauffeur sur place engage des frais (§7) :
 * le chauffeur s'est déplacé, son temps doit être couvert.
 */
export function cancellationIsChargeable(status: RideStatus, actor: ActorType): boolean {
  if (actor !== 'client') return false;
  return status === 'driver_arrived';
}

/** Libellés destinés à l'interface d'administration et aux notifications. */
export const RIDE_STATUS_LABELS: Record<RideStatus, string> = {
  requested: 'Demande créée',
  searching: 'Recherche d’un chauffeur',
  driver_assigned: 'Chauffeur trouvé',
  driver_en_route: 'Chauffeur en route',
  driver_arrived: 'Chauffeur arrivé',
  in_progress: 'Course en cours',
  completed: 'Course terminée',
  awaiting_payment: 'En attente de paiement',
  paid: 'Payée',
  rated: 'Évaluée',
  cancelled: 'Annulée',
  expired: 'Expirée (aucun chauffeur)',
};
