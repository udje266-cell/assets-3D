import { describe, expect, it } from 'vitest';
import {
  acceptanceRate,
  rankCandidates,
  scoreCandidate,
  type DispatchCandidate,
  type DispatchConstraints,
} from '../../src/domain/dispatch.js';

const constraints: DispatchConstraints = {
  radiusMeters: 5_000,
  maxLocationAgeSeconds: 120,
  maxCandidates: 10,
};

function candidate(overrides: Partial<DispatchCandidate> = {}): DispatchCandidate {
  return {
    driverId: 'd1',
    distanceMeters: 1_000,
    etaSeconds: 180,
    rating: 4.5,
    offersReceived: 10,
    offersAccepted: 8,
    locationAgeSeconds: 10,
    ...overrides,
  };
}

describe('attribution des courses (§19)', () => {
  it('classe le chauffeur le plus proche en premier, toutes choses égales', () => {
    const ranked = rankCandidates(
      [
        candidate({ driverId: 'loin', distanceMeters: 4_000 }),
        candidate({ driverId: 'proche', distanceMeters: 500 }),
        candidate({ driverId: 'moyen', distanceMeters: 2_000 }),
      ],
      constraints,
    );

    expect(ranked.map((c) => c.driverId)).toEqual(['proche', 'moyen', 'loin']);
  });

  it('écarte les chauffeurs hors du rayon de recherche', () => {
    const ranked = rankCandidates(
      [candidate({ driverId: 'dedans', distanceMeters: 4_900 }), candidate({ driverId: 'dehors', distanceMeters: 5_100 })],
      constraints,
    );

    expect(ranked.map((c) => c.driverId)).toEqual(['dedans']);
  });

  it('écarte les chauffeurs dont la position est trop ancienne', () => {
    // Proposer une course à un chauffeur injoignable coûte un cycle d'offre
    // et allonge l'attente du client.
    const ranked = rankCandidates(
      [
        candidate({ driverId: 'frais', locationAgeSeconds: 30 }),
        candidate({ driverId: 'perime', distanceMeters: 100, locationAgeSeconds: 600 }),
      ],
      constraints,
    );

    expect(ranked.map((c) => c.driverId)).toEqual(['frais']);
  });

  it('départage à égalité de score de façon déterministe', () => {
    const identiques = [
      candidate({ driverId: 'bbb' }),
      candidate({ driverId: 'aaa' }),
      candidate({ driverId: 'ccc' }),
    ];

    const premier = rankCandidates(identiques, constraints).map((c) => c.driverId);
    const second = rankCandidates([...identiques].reverse(), constraints).map((c) => c.driverId);

    expect(premier).toEqual(second);
    expect(premier).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('limite le nombre de candidats retenus', () => {
    const nombreux = Array.from({ length: 40 }, (_, i) =>
      candidate({ driverId: `d${i}`, distanceMeters: 100 + i * 10 }),
    );

    expect(rankCandidates(nombreux, { ...constraints, maxCandidates: 5 })).toHaveLength(5);
  });

  it('favorise un meilleur taux d’acceptation à distance égale', () => {
    const assidu = candidate({ driverId: 'assidu', offersReceived: 20, offersAccepted: 20 });
    const irregulier = candidate({ driverId: 'irregulier', offersReceived: 20, offersAccepted: 2 });

    expect(scoreCandidate(assidu, constraints)).toBeGreaterThan(
      scoreCandidate(irregulier, constraints),
    );
  });

  it('n’écrase pas un nouveau chauffeur faute d’historique', () => {
    const nouveau = candidate({ driverId: 'nouveau', offersReceived: 0, offersAccepted: 0 });
    expect(acceptanceRate(nouveau)).toBe(0.7);

    const mauvais = candidate({ driverId: 'mauvais', offersReceived: 20, offersAccepted: 2 });
    expect(scoreCandidate(nouveau, constraints)).toBeGreaterThan(
      scoreCandidate(mauvais, constraints),
    );
  });

  it('produit un score borné entre 0 et 1', () => {
    const extremes = [
      candidate({ distanceMeters: 0, etaSeconds: 0, rating: 5, offersReceived: 10, offersAccepted: 10 }),
      candidate({ distanceMeters: 5_000, etaSeconds: 3_600, rating: 0, offersReceived: 10, offersAccepted: 0 }),
    ];

    for (const c of extremes) {
      const score = scoreCandidate(c, constraints);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
