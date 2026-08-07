import { describe, expect, it } from 'vitest';
import { computeFare, type PricingParameters } from '../../src/domain/pricing.js';

/** Grille de référence, proche du jeu de données initial (catégorie « Éco »). */
const eco: PricingParameters = {
  baseFare: 500,
  perKm: 250,
  perMinute: 25,
  minimumFare: 1_000,
  bookingFee: 0,
  surgeBps: 10_000,
  commissionBps: 2_000,
  roundToNearest: 1,
  currency: 'XOF',
};

describe('moteur tarifaire (§7)', () => {
  it('applique la formule base + distance × tarif/km + durée × tarif/minute', () => {
    // 5 km en 12 min : 500 + 5 × 250 + 12 × 25 = 500 + 1250 + 300 = 2050
    const fare = computeFare({ distanceMeters: 5_000, durationSeconds: 720 }, eco);

    expect(fare.baseFare).toBe(500);
    expect(fare.distanceAmount).toBe(1_250);
    expect(fare.timeAmount).toBe(300);
    expect(fare.subtotal).toBe(2_050);
    expect(fare.total).toBe(2_050);
  });

  it('applique le tarif minimum sur les courses très courtes', () => {
    // 400 m en 2 min : 500 + 100 + 50 = 650, relevé au minimum de 1 000
    const fare = computeFare({ distanceMeters: 400, durationSeconds: 120 }, eco);

    expect(fare.subtotal).toBe(650);
    expect(fare.minimumAdjustment).toBe(350);
    expect(fare.total).toBe(1_000);
  });

  it('applique la tarification dynamique avant le tarif minimum', () => {
    const fare = computeFare(
      { distanceMeters: 5_000, durationSeconds: 720 },
      { ...eco, surgeBps: 15_000 },
    );

    expect(fare.surgeAmount).toBe(1_025); // 2050 × 1,5 = 3075
    expect(fare.total).toBe(3_075);
  });

  it('ajoute les frais de réservation après le tarif minimum', () => {
    // Les frais ne doivent pas être absorbés par le plancher tarifaire.
    const fare = computeFare(
      { distanceMeters: 400, durationSeconds: 120 },
      { ...eco, bookingFee: 100 },
    );

    expect(fare.total).toBe(1_100);
  });

  it('arrondit au pas configuré par la grille', () => {
    // 3,3 km en 7 min : 500 + 825 + 175 = 1500 ; avec surge 1,07 → 1605 → 1605
    const fare = computeFare(
      { distanceMeters: 3_300, durationSeconds: 420 },
      { ...eco, roundToNearest: 50 },
    );

    expect(fare.total % 50).toBe(0);
  });

  it('ne produit jamais de montant fractionnaire', () => {
    for (let distance = 0; distance <= 30_000; distance += 137) {
      const fare = computeFare({ distanceMeters: distance, durationSeconds: distance / 5 }, eco);
      expect(Number.isInteger(fare.total)).toBe(true);
    }
  });

  it('refuse une distance ou une durée invalide', () => {
    expect(() => computeFare({ distanceMeters: -1, durationSeconds: 60 }, eco)).toThrow(
      /Distance invalide/,
    );
    expect(() => computeFare({ distanceMeters: 100, durationSeconds: Number.NaN }, eco)).toThrow(
      /Durée invalide/,
    );
  });

  it('refuse un multiplicateur qui réduirait le prix', () => {
    expect(() =>
      computeFare({ distanceMeters: 1_000, durationSeconds: 60 }, { ...eco, surgeBps: 8_000 }),
    ).toThrow(/ne peut pas réduire le prix/);
  });
});
