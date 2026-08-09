import { applyBps } from './money.js';

/**
 * Répartition plateforme / chauffeur — §8 du cahier des charges.
 *
 * Exemple du cahier des charges : course de 5 000 FCFA, commission 20 %
 * → 1 000 FCFA pour la plateforme, 4 000 FCFA pour le chauffeur.
 *
 * Traitement des promotions : la commission est calculée sur le prix **brut**
 * de la course, et la remise est portée par la plateforme, pas par le
 * chauffeur. Un chauffeur ne doit pas être pénalisé par une opération
 * commerciale décidée par la plateforme. Le revenu net de la plateforme est
 * donc `commission − remise`, calculé au niveau des indicateurs (§24) et non
 * en écrasant la commission — ce qui préserve la lisibilité comptable exigée
 * au §8 (« montants enregistrés séparément »).
 */

export interface CommissionSplit {
  /** Prix brut de la course, avant remise. */
  grossFare: number;
  /** Remise promotionnelle accordée au client. */
  discount: number;
  /** Montant effectivement dû par le client. */
  amountChargedToClient: number;
  /** Commission brute revenant à la plateforme. */
  platformAmount: number;
  /** Part revenant au chauffeur. */
  driverAmount: number;
  /** Revenu net de la plateforme après prise en charge de la remise. */
  platformNetAmount: number;
  commissionBps: number;
}

export function splitFare(
  grossFare: number,
  commissionBps: number,
  discount = 0,
): CommissionSplit {
  if (grossFare < 0) throw new Error(`Prix de course négatif : ${grossFare}`);
  if (commissionBps < 0 || commissionBps > 10_000) {
    throw new Error(`Taux de commission hors bornes : ${commissionBps} bps`);
  }
  if (discount < 0) throw new Error(`Remise négative : ${discount}`);
  if (discount > grossFare) {
    throw new Error(`Remise (${discount}) supérieure au prix de la course (${grossFare}).`);
  }

  const platformAmount = applyBps(grossFare, commissionBps);
  const driverAmount = grossFare - platformAmount;

  return {
    grossFare,
    discount,
    amountChargedToClient: grossFare - discount,
    platformAmount,
    driverAmount,
    platformNetAmount: platformAmount - discount,
    commissionBps,
  };
}

/**
 * Effet d'une course sur le portefeuille du chauffeur (§10).
 *
 * - Paiement électronique : la plateforme encaisse, le chauffeur est crédité de
 *   sa part et sera réglé par retrait.
 * - Paiement en espèces : le chauffeur encaisse directement le client. Il est
 *   crédité de sa part et débité de la somme perçue ; le solde net représente
 *   ce qu'il doit à la plateforme (généralement la commission).
 */
export interface WalletEffectEntry {
  entryType: 'ride_earning' | 'cash_collected';
  amount: number;
  description: string;
}

export function walletEffectForRide(
  split: CommissionSplit,
  paymentMethod: 'cash' | 'wallet' | 'mobile_money' | 'card',
): WalletEffectEntry[] {
  const entries: WalletEffectEntry[] = [
    {
      entryType: 'ride_earning',
      amount: split.driverAmount,
      description: 'Part chauffeur sur la course',
    },
  ];

  if (paymentMethod === 'cash') {
    entries.push({
      entryType: 'cash_collected',
      amount: -split.amountChargedToClient,
      description: 'Espèces encaissées auprès du client',
    });
  }

  return entries;
}

/** Variation nette du solde du portefeuille pour une course donnée. */
export function netWalletChange(entries: readonly WalletEffectEntry[]): number {
  return entries.reduce((total, entry) => total + entry.amount, 0);
}
