import { randomUUID } from 'node:crypto';
import type { PaymentMethod } from '../db/types.js';
import { unprocessable } from '../lib/errors.js';

/**
 * Paiements — §9 du cahier des charges.
 *
 * « Les paiements électroniques doivent être intégrés via des prestataires de
 *   paiement appropriés plutôt que par un système bancaire construit
 *   directement par la plateforme. »
 *
 * La plateforme ne détient donc aucun flux monétaire externe : elle demande une
 * autorisation à un prestataire, enregistre l'identifiant de transaction et le
 * statut renvoyés, et n'invente jamais un encaissement. Le module ci-dessous
 * définit ce contrat ; les implémentations réelles (mobile money, carte) sont à
 * brancher avant lancement commercial.
 */

export interface ChargeRequest {
  /** Identifiant interne, transmis au prestataire pour idempotence. */
  idempotencyKey: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  /** Numéro de téléphone ou jeton de carte, selon le prestataire. */
  instrument: string | null;
  metadata: Record<string, unknown>;
}

export interface ChargeResult {
  status: 'succeeded' | 'processing' | 'failed';
  provider: string;
  providerReference: string | null;
  failureReason?: string;
  payload?: Record<string, unknown>;
}

export interface RefundRequest {
  providerReference: string;
  amount: number;
  currency: string;
  reason: string;
}

export interface RefundResult {
  status: 'succeeded' | 'processing' | 'failed';
  providerReference: string | null;
  failureReason?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly methods: readonly PaymentMethod[];
  charge(request: ChargeRequest): Promise<ChargeResult>;
  refund(request: RefundRequest): Promise<RefundResult>;
}

/**
 * Paiement en espèces : aucun flux externe.
 *
 * Le règlement est confirmé par le chauffeur à la fin de la course ; la
 * commission due est portée au débit de son portefeuille (§10). C'est un
 * « prestataire » au sens du code uniquement, pour que le reste du système
 * traite tous les moyens de paiement de la même façon.
 */
export class CashProvider implements PaymentProvider {
  readonly name = 'cash';
  readonly methods: readonly PaymentMethod[] = ['cash'];

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    return {
      status: 'succeeded',
      provider: this.name,
      providerReference: `cash_${request.idempotencyKey}`,
      payload: { collected_by: 'driver' },
    };
  }

  async refund(): Promise<RefundResult> {
    // Un remboursement d'espèces se règle hors plateforme (geste commercial,
    // avoir sur le portefeuille) : le prestataire ne peut rien exécuter.
    return {
      status: 'failed',
      providerReference: null,
      failureReason:
        'Un paiement en espèces ne peut pas être remboursé automatiquement : ' +
        'passer par un avoir ou un virement manuel.',
    };
  }
}

/**
 * Simulateur destiné au développement et aux tests.
 *
 * Il est volontairement interdit en production (voir config/env.ts) : aucune
 * plateforme ne doit pouvoir marquer une course « payée » sans qu'un
 * prestataire l'ait confirmé.
 */
export class MockElectronicProvider implements PaymentProvider {
  readonly methods: readonly PaymentMethod[] = ['mobile_money', 'card', 'wallet'];

  constructor(readonly name = 'mock') {}

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    // Convention de test : un montant se terminant par 13 échoue, afin de
    // pouvoir éprouver le chemin d'échec sans instrumentation particulière.
    if (request.amount % 100 === 13) {
      return {
        status: 'failed',
        provider: this.name,
        providerReference: null,
        failureReason: 'Fonds insuffisants (simulation).',
      };
    }
    return {
      status: 'succeeded',
      provider: this.name,
      providerReference: `mock_${randomUUID()}`,
      payload: { simulated: true, method: request.method },
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    if (request.amount <= 0) {
      return {
        status: 'failed',
        providerReference: null,
        failureReason: 'Montant de remboursement invalide.',
      };
    }
    return { status: 'succeeded', providerReference: `mock_refund_${randomUUID()}` };
  }
}

/** Registre des prestataires, résolu par moyen de paiement. */
export class PaymentRouter {
  private readonly byMethod = new Map<PaymentMethod, PaymentProvider>();

  constructor(providers: readonly PaymentProvider[]) {
    for (const provider of providers) {
      for (const method of provider.methods) {
        // Le premier prestataire déclaré pour un moyen de paiement l'emporte :
        // l'ordre du tableau est la configuration.
        if (!this.byMethod.has(method)) this.byMethod.set(method, provider);
      }
    }
  }

  resolve(method: PaymentMethod): PaymentProvider {
    const provider = this.byMethod.get(method);
    if (!provider) {
      throw unprocessable(
        'payment_method_unavailable',
        `Aucun prestataire n’est configuré pour le moyen de paiement « ${method} ».`,
      );
    }
    return provider;
  }

  availableMethods(): PaymentMethod[] {
    return [...this.byMethod.keys()];
  }
}
