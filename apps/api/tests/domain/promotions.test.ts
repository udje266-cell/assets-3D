import { describe, expect, it } from 'vitest';
import {
  computeDiscount,
  evaluatePromotion,
  type PromotionContext,
  type PromotionRules,
} from '../../src/domain/promotions.js';

const MAINTENANT = new Date('2026-06-15T10:00:00Z');

function promotion(overrides: Partial<PromotionRules> = {}): PromotionRules {
  return {
    id: 'p1',
    code: 'BIENVENUE',
    type: 'percentage',
    value: 2_000, // 20 %
    maxDiscount: 1_000,
    minFare: 500,
    maxRedemptions: null,
    maxPerUser: 1,
    redemptionsCount: 0,
    firstRideOnly: true,
    startsAt: new Date('2026-01-01T00:00:00Z'),
    endsAt: null,
    isActive: true,
    ...overrides,
  };
}

function context(overrides: Partial<PromotionContext> = {}): PromotionContext {
  return { fare: 5_000, userRedemptions: 0, userRidesCount: 0, now: MAINTENANT, ...overrides };
}

describe('promotions (§13)', () => {
  it('accorde la remise en pourcentage, plafonnée', () => {
    // 20 % de 5 000 = 1 000, égal au plafond
    const result = evaluatePromotion(promotion(), context());

    expect(result.eligible).toBe(true);
    if (result.eligible) expect(result.discount).toBe(1_000);
  });

  it('applique le plafond de réduction sur les courses chères', () => {
    // 20 % de 20 000 = 4 000, ramené au plafond de 1 000
    expect(computeDiscount(promotion(), 20_000)).toBe(1_000);
  });

  it('gère les remises à montant fixe', () => {
    const fixe = promotion({ type: 'fixed', value: 1_500, maxDiscount: null });
    expect(computeDiscount(fixe, 5_000)).toBe(1_500);
  });

  it('ne rend jamais une course négative', () => {
    const genereuse = promotion({ type: 'fixed', value: 10_000, maxDiscount: null });
    expect(computeDiscount(genereuse, 3_000)).toBe(3_000);
  });

  it('refuse un code désactivé', () => {
    const result = evaluatePromotion(promotion({ isActive: false }), context());
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe('inactive');
  });

  it('refuse un code hors de sa période de validité', () => {
    const pasCommence = evaluatePromotion(
      promotion({ startsAt: new Date('2026-12-01T00:00:00Z') }),
      context(),
    );
    expect(pasCommence.eligible).toBe(false);
    if (!pasCommence.eligible) expect(pasCommence.code).toBe('not_started');

    const expire = evaluatePromotion(
      promotion({ endsAt: new Date('2026-02-01T00:00:00Z') }),
      context(),
    );
    expect(expire.eligible).toBe(false);
    if (!expire.eligible) expect(expire.code).toBe('expired');
  });

  it('refuse au-delà du quota global', () => {
    const result = evaluatePromotion(
      promotion({ maxRedemptions: 100, redemptionsCount: 100 }),
      context(),
    );
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe('usage_limit_reached');
  });

  it('refuse au-delà du quota par client', () => {
    const result = evaluatePromotion(promotion(), context({ userRedemptions: 1 }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe('user_limit_reached');
  });

  it('réserve un code « première course » aux nouveaux clients', () => {
    const result = evaluatePromotion(promotion(), context({ userRidesCount: 3 }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe('first_ride_only');
  });

  it('refuse en dessous du montant minimum de course', () => {
    const result = evaluatePromotion(promotion({ minFare: 2_000 }), context({ fare: 1_000 }));
    expect(result.eligible).toBe(false);
    if (!result.eligible) expect(result.code).toBe('fare_below_minimum');
  });

  it('ne dépend d’aucune horloge implicite', () => {
    const regle = promotion({ endsAt: new Date('2026-07-01T00:00:00Z') });

    expect(evaluatePromotion(regle, context({ now: new Date('2026-06-30T23:59:59Z') })).eligible).toBe(
      true,
    );
    expect(evaluatePromotion(regle, context({ now: new Date('2026-07-01T00:00:01Z') })).eligible).toBe(
      false,
    );
  });
});
