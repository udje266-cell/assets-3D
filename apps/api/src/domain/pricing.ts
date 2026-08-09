import { applyBps, assertInteger, roundToNearest } from './money.js';

/**
 * Moteur tarifaire — §7 du cahier des charges.
 *
 *   prix = tarif de base + distance × tarif/km + durée × tarif/minute
 *
 * Les paramètres proviennent de `pricing_rules`, modifiable depuis
 * l'administration sans mise à jour de l'application. Cette fonction est pure :
 * elle ne lit ni la base ni l'horloge, ce qui la rend intégralement testable.
 *
 * Ordre des opérations (déterminant pour le montant final) :
 *   1. sous-total = base + distance + durée
 *   2. application du multiplicateur de tarification dynamique
 *   3. plancher au tarif minimum
 *   4. ajout des frais de réservation (non soumis au minimum ni au surge)
 *   5. arrondi au pas de la grille
 */

export interface PricingParameters {
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
  bookingFee: number;
  /** Multiplicateur en points de base : 10000 = ×1,00 ; 15000 = ×1,50. */
  surgeBps: number;
  /** Commission plateforme en points de base : 2000 = 20 %. */
  commissionBps: number;
  /** Pas d'arrondi du prix affiché (5 = au multiple de 5 le plus proche). */
  roundToNearest: number;
  currency: string;
}

export interface FareInput {
  distanceMeters: number;
  durationSeconds: number;
}

export interface FareBreakdown {
  baseFare: number;
  distanceAmount: number;
  timeAmount: number;
  /** Somme avant tarification dynamique. */
  subtotal: number;
  /** Supplément dû au multiplicateur (0 si surgeBps = 10000). */
  surgeAmount: number;
  /** Complément appliqué pour atteindre le tarif minimum (0 sinon). */
  minimumAdjustment: number;
  bookingFee: number;
  /** Montant total dû avant remise promotionnelle. */
  total: number;
  currency: string;
}

export function computeFare(input: FareInput, params: PricingParameters): FareBreakdown {
  if (input.distanceMeters < 0 || !Number.isFinite(input.distanceMeters)) {
    throw new Error(`Distance invalide : ${input.distanceMeters}`);
  }
  if (input.durationSeconds < 0 || !Number.isFinite(input.durationSeconds)) {
    throw new Error(`Durée invalide : ${input.durationSeconds}`);
  }
  if (params.surgeBps < 10_000) {
    throw new Error('Le multiplicateur de tarification dynamique ne peut pas réduire le prix.');
  }
  assertInteger(params.baseFare, 'tarif de base');
  assertInteger(params.perKm, 'tarif au kilomètre');
  assertInteger(params.perMinute, 'tarif à la minute');

  const distanceAmount = Math.round((params.perKm * input.distanceMeters) / 1000);
  const timeAmount = Math.round((params.perMinute * input.durationSeconds) / 60);
  const subtotal = params.baseFare + distanceAmount + timeAmount;

  const surged = applyBps(subtotal, params.surgeBps);
  const surgeAmount = surged - subtotal;

  const flooredToMinimum = Math.max(surged, params.minimumFare);
  const minimumAdjustment = flooredToMinimum - surged;

  const total = roundToNearest(flooredToMinimum + params.bookingFee, params.roundToNearest);

  return {
    baseFare: params.baseFare,
    distanceAmount,
    timeAmount,
    subtotal,
    surgeAmount,
    minimumAdjustment,
    bookingFee: params.bookingFee,
    total,
    currency: params.currency,
  };
}

/** Forme d'une ligne de `pricing_rules` telle que lue en base. */
export interface PricingRuleRow {
  base_fare: number;
  per_km: number;
  per_minute: number;
  minimum_fare: number;
  booking_fee: number;
  surge_bps: number;
  commission_bps: number;
  round_to_nearest: number;
  currency: string;
}

export function toPricingParameters(rule: PricingRuleRow): PricingParameters {
  return {
    baseFare: rule.base_fare,
    perKm: rule.per_km,
    perMinute: rule.per_minute,
    minimumFare: rule.minimum_fare,
    bookingFee: rule.booking_fee,
    surgeBps: rule.surge_bps,
    commissionBps: rule.commission_bps,
    roundToNearest: rule.round_to_nearest,
    currency: rule.currency,
  };
}

/**
 * Instantané des paramètres appliqués, copié sur la course.
 *
 * Une modification de grille en administration ne doit jamais réécrire un
 * montant déjà facturé : la course conserve la trace de ce qui lui a été
 * appliqué, ce qui rend chaque prix justifiable lors d'un litige (§15).
 */
export function pricingSnapshot(
  params: PricingParameters,
  breakdown: FareBreakdown,
): Record<string, unknown> {
  return {
    parametres: {
      tarif_base: params.baseFare,
      tarif_km: params.perKm,
      tarif_minute: params.perMinute,
      tarif_minimum: params.minimumFare,
      frais_reservation: params.bookingFee,
      multiplicateur_bps: params.surgeBps,
      commission_bps: params.commissionBps,
      arrondi: params.roundToNearest,
    },
    detail: {
      base: breakdown.baseFare,
      distance: breakdown.distanceAmount,
      duree: breakdown.timeAmount,
      sous_total: breakdown.subtotal,
      majoration: breakdown.surgeAmount,
      ajustement_minimum: breakdown.minimumAdjustment,
      frais_reservation: breakdown.bookingFee,
      total: breakdown.total,
    },
  };
}
