import { applyBps } from './money.js';

/**
 * Promotions — §13 du cahier des charges.
 *
 * « Paramètres : montant fixe ou pourcentage, nombre d'utilisations, dates de
 *   validité, utilisateurs concernés et plafond de réduction. »
 *
 * Fonction pure : l'appelant fournit l'état de la promotion, le contexte du
 * client et l'instant de référence. Aucune horloge implicite — c'est ce qui
 * rend les règles de validité testables sans attendre.
 */

export interface PromotionRules {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  /** Pourcentage : points de base (2000 = 20 %). Fixe : montant entier. */
  value: number;
  maxDiscount: number | null;
  minFare: number;
  maxRedemptions: number | null;
  maxPerUser: number;
  redemptionsCount: number;
  firstRideOnly: boolean;
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
}

export interface PromotionContext {
  /** Prix brut de la course auquel la remise s'appliquerait. */
  fare: number;
  /** Nombre de fois où ce client a déjà utilisé ce code. */
  userRedemptions: number;
  /** Nombre de courses déjà effectuées par ce client. */
  userRidesCount: number;
  now: Date;
}

export type PromotionRejectionCode =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'usage_limit_reached'
  | 'user_limit_reached'
  | 'first_ride_only'
  | 'fare_below_minimum';

export type PromotionEvaluation =
  | { eligible: true; discount: number; promotionId: string }
  | { eligible: false; code: PromotionRejectionCode; reason: string };

export function evaluatePromotion(
  promotion: PromotionRules,
  context: PromotionContext,
): PromotionEvaluation {
  if (!promotion.isActive) {
    return { eligible: false, code: 'inactive', reason: 'Ce code promotionnel est désactivé.' };
  }
  if (context.now < promotion.startsAt) {
    return {
      eligible: false,
      code: 'not_started',
      reason: 'Ce code promotionnel n’est pas encore valable.',
    };
  }
  if (promotion.endsAt && context.now >= promotion.endsAt) {
    return { eligible: false, code: 'expired', reason: 'Ce code promotionnel a expiré.' };
  }
  if (
    promotion.maxRedemptions !== null &&
    promotion.redemptionsCount >= promotion.maxRedemptions
  ) {
    return {
      eligible: false,
      code: 'usage_limit_reached',
      reason: 'Ce code promotionnel a atteint son nombre maximum d’utilisations.',
    };
  }
  if (context.userRedemptions >= promotion.maxPerUser) {
    return {
      eligible: false,
      code: 'user_limit_reached',
      reason: 'Vous avez déjà utilisé ce code promotionnel.',
    };
  }
  if (promotion.firstRideOnly && context.userRidesCount > 0) {
    return {
      eligible: false,
      code: 'first_ride_only',
      reason: 'Ce code promotionnel est réservé à la première course.',
    };
  }
  if (context.fare < promotion.minFare) {
    return {
      eligible: false,
      code: 'fare_below_minimum',
      reason: `Ce code s’applique à partir de ${promotion.minFare} pour une course.`,
    };
  }

  return {
    eligible: true,
    promotionId: promotion.id,
    discount: computeDiscount(promotion, context.fare),
  };
}

/**
 * Montant de la remise, plafonné par `maxDiscount` puis par le prix lui-même :
 * une remise ne peut jamais rendre une course négative.
 */
export function computeDiscount(promotion: PromotionRules, fare: number): number {
  const raw =
    promotion.type === 'percentage' ? applyBps(fare, promotion.value) : promotion.value;

  const capped = promotion.maxDiscount === null ? raw : Math.min(raw, promotion.maxDiscount);
  return Math.max(0, Math.min(capped, fare));
}

/** Conversion d'une ligne de `promotions` vers le modèle métier. */
export function toPromotionRules(row: {
  id: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  max_discount: number | null;
  min_fare: number;
  max_redemptions: number | null;
  max_per_user: number;
  redemptions_count: number;
  first_ride_only: boolean;
  starts_at: Date;
  ends_at: Date | null;
  is_active: boolean;
}): PromotionRules {
  return {
    id: row.id,
    code: row.code,
    type: row.type,
    value: row.value,
    maxDiscount: row.max_discount,
    minFare: row.min_fare,
    maxRedemptions: row.max_redemptions,
    maxPerUser: row.max_per_user,
    redemptionsCount: row.redemptions_count,
    firstRideOnly: row.first_ride_only,
    startsAt: new Date(row.starts_at),
    endsAt: row.ends_at ? new Date(row.ends_at) : null,
    isActive: row.is_active,
  };
}
