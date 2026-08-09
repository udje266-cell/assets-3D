import { describe, expect, it } from 'vitest';
import type { RideStatus } from '../../src/db/types.js';
import {
  cancellationIsChargeable,
  canTransition,
  checkTransition,
  isTerminal,
  nextStatuses,
} from '../../src/domain/ride-state.js';

describe('machine à états d’une course (§6)', () => {
  it('déroule l’enchaînement nominal du cahier des charges', () => {
    const parcours: Array<[RideStatus, RideStatus, 'client' | 'driver' | 'system']> = [
      ['requested', 'searching', 'system'],
      ['searching', 'driver_assigned', 'driver'],
      ['driver_assigned', 'driver_en_route', 'driver'],
      ['driver_en_route', 'driver_arrived', 'driver'],
      ['driver_arrived', 'in_progress', 'driver'],
      ['in_progress', 'completed', 'driver'],
      ['completed', 'awaiting_payment', 'system'],
      ['awaiting_payment', 'paid', 'driver'],
      ['paid', 'rated', 'client'],
    ];

    for (const [from, to, actor] of parcours) {
      expect(canTransition(from, to, actor), `${from} → ${to} par ${actor}`).toBe(true);
    }
  });

  it('interdit de sauter des étapes', () => {
    expect(canTransition('requested', 'in_progress', 'driver')).toBe(false);
    expect(canTransition('searching', 'completed', 'driver')).toBe(false);
    expect(canTransition('driver_assigned', 'paid', 'system')).toBe(false);
  });

  it('refuse toute transition depuis un état terminal', () => {
    for (const terminal of ['rated', 'cancelled', 'expired'] as const) {
      expect(isTerminal(terminal)).toBe(true);
      expect(nextStatuses(terminal)).toHaveLength(0);

      const check = checkTransition(terminal, 'in_progress', 'admin');
      expect(check.allowed).toBe(false);
      if (!check.allowed) expect(check.code).toBe('terminal');
    }
  });

  it('réserve chaque transition aux acteurs habilités', () => {
    // Un client ne démarre pas une course à la place du chauffeur.
    const check = checkTransition('driver_arrived', 'in_progress', 'client');
    expect(check.allowed).toBe(false);
    if (!check.allowed) expect(check.code).toBe('forbidden_actor');

    // Un chauffeur ne note pas à la place du client.
    expect(canTransition('paid', 'rated', 'driver')).toBe(false);
  });

  it('permet une annulation par le client jusqu’au démarrage', () => {
    const annulables: RideStatus[] = [
      'requested',
      'searching',
      'driver_assigned',
      'driver_en_route',
      'driver_arrived',
    ];

    for (const status of annulables) {
      expect(canTransition(status, 'cancelled', 'client')).toBe(true);
    }

    // Une fois le passager à bord, seul un administrateur peut annuler.
    expect(canTransition('in_progress', 'cancelled', 'client')).toBe(false);
    expect(canTransition('in_progress', 'cancelled', 'admin')).toBe(true);
  });

  it('permet une réattribution après acceptation', () => {
    expect(canTransition('driver_assigned', 'searching', 'driver')).toBe(true);
    expect(canTransition('driver_en_route', 'searching', 'admin')).toBe(true);
  });

  it('ne facture l’annulation qu’au client, une fois le chauffeur sur place', () => {
    expect(cancellationIsChargeable('driver_arrived', 'client')).toBe(true);
    expect(cancellationIsChargeable('driver_en_route', 'client')).toBe(false);
    expect(cancellationIsChargeable('driver_arrived', 'driver')).toBe(false);
    expect(cancellationIsChargeable('driver_arrived', 'admin')).toBe(false);
  });
});
