import { describe, expect, it } from 'vitest';
import { netWalletChange, splitFare, walletEffectForRide } from '../../src/domain/commission.js';

describe('commission et revenus (§8)', () => {
  it('reproduit l’exemple du cahier des charges : 5 000 FCFA à 20 %', () => {
    const split = splitFare(5_000, 2_000);

    expect(split.platformAmount).toBe(1_000);
    expect(split.driverAmount).toBe(4_000);
    expect(split.amountChargedToClient).toBe(5_000);
  });

  it('conserve l’égalité commission + part chauffeur = prix, quel que soit le taux', () => {
    for (let fare = 0; fare <= 50_000; fare += 137) {
      for (const bps of [0, 500, 1_500, 2_000, 3_333, 10_000]) {
        const split = splitFare(fare, bps);
        expect(split.platformAmount + split.driverAmount).toBe(fare);
      }
    }
  });

  it('fait porter la remise par la plateforme, pas par le chauffeur', () => {
    const split = splitFare(5_000, 2_000, 1_000);

    expect(split.driverAmount).toBe(4_000); // inchangé
    expect(split.platformAmount).toBe(1_000); // commission brute inchangée
    expect(split.amountChargedToClient).toBe(4_000); // le client paie moins
    expect(split.platformNetAmount).toBe(0); // la plateforme absorbe la remise
  });

  it('accepte un revenu net négatif quand la remise dépasse la commission', () => {
    const split = splitFare(5_000, 1_000, 1_000);

    expect(split.platformAmount).toBe(500);
    expect(split.platformNetAmount).toBe(-500);
  });

  it('refuse une remise supérieure au prix de la course', () => {
    expect(() => splitFare(2_000, 2_000, 2_500)).toThrow(/supérieure au prix/);
  });

  it('refuse un taux de commission hors bornes', () => {
    expect(() => splitFare(5_000, 12_000)).toThrow(/hors bornes/);
    expect(() => splitFare(5_000, -1)).toThrow(/hors bornes/);
  });

  describe('effet sur le portefeuille chauffeur (§10)', () => {
    it('crédite la part chauffeur pour un paiement électronique', () => {
      const split = splitFare(5_000, 2_000);
      const entries = walletEffectForRide(split, 'mobile_money');

      expect(entries).toHaveLength(1);
      expect(entries[0]?.entryType).toBe('ride_earning');
      expect(netWalletChange(entries)).toBe(4_000);
    });

    it('laisse le chauffeur redevable de la commission sur un paiement en espèces', () => {
      const split = splitFare(5_000, 2_000);
      const entries = walletEffectForRide(split, 'cash');

      // Il encaisse 5 000, il a droit à 4 000 : il doit 1 000 à la plateforme.
      expect(entries).toHaveLength(2);
      expect(netWalletChange(entries)).toBe(-1_000);
    });

    it('tient compte de la remise dans les espèces réellement encaissées', () => {
      const split = splitFare(5_000, 2_000, 1_000);
      const entries = walletEffectForRide(split, 'cash');

      // Il n'encaisse que 4 000 et a droit à 4 000 : rien n'est dû.
      expect(netWalletChange(entries)).toBe(0);
    });
  });
});
