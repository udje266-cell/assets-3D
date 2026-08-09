import type { PaymentMethod, RideStatus } from './types';

/** Formatage et libellés partagés par les deux applications. */

export function formatAmount(amount: number | null | undefined, currency = 'XOF'): string {
  if (amount === null || amount === undefined) return '—';
  const symbol = currency === 'XOF' ? 'FCFA' : currency;
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${digits} ${symbol}`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Compte à rebours en secondes, borné à zéro. */
export function secondsUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

/** Libellés des états d'une course — §6. */
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
  expired: 'Aucun chauffeur trouvé',
};

/** Message affiché au client pendant l'attente, par état. */
export const CLIENT_STATUS_HINTS: Partial<Record<RideStatus, string>> = {
  requested: 'Nous enregistrons votre demande.',
  searching: 'Nous cherchons un chauffeur disponible près de vous.',
  driver_assigned: 'Votre chauffeur a accepté la course.',
  driver_en_route: 'Votre chauffeur se dirige vers vous.',
  driver_arrived: 'Votre chauffeur vous attend au point de départ.',
  in_progress: 'Bon voyage.',
  completed: 'Course terminée, calcul du montant.',
  awaiting_payment: 'Réglez la course pour terminer.',
  paid: 'Paiement enregistré. Merci de noter votre chauffeur.',
  expired: 'Aucun chauffeur n’est disponible pour le moment.',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  mobile_money: 'Mobile money',
  card: 'Carte bancaire',
  wallet: 'Portefeuille',
};

/** États pendant lesquels une course occupe l'écran de suivi. */
export const ACTIVE_RIDE_STATUSES: readonly RideStatus[] = [
  'requested',
  'searching',
  'driver_assigned',
  'driver_en_route',
  'driver_arrived',
  'in_progress',
  'completed',
  'awaiting_payment',
];

export function isActiveRide(status: RideStatus): boolean {
  return ACTIVE_RIDE_STATUSES.includes(status);
}

/** Progression de 0 à 1, pour la barre d'avancement du suivi. */
export function rideProgress(status: RideStatus): number {
  const order: RideStatus[] = [
    'requested',
    'searching',
    'driver_assigned',
    'driver_en_route',
    'driver_arrived',
    'in_progress',
    'completed',
    'awaiting_payment',
    'paid',
    'rated',
  ];
  const index = order.indexOf(status);
  return index < 0 ? 0 : index / (order.length - 1);
}

/** Libellés des écritures du portefeuille chauffeur — §10. */
export const WALLET_ENTRY_LABELS: Record<string, string> = {
  ride_earning: 'Part chauffeur',
  commission: 'Commission plateforme',
  cash_collected: 'Espèces encaissées',
  withdrawal: 'Retrait',
  withdrawal_reversal: 'Retrait restitué',
  adjustment: 'Correction',
  bonus: 'Prime',
  refund_deduction: 'Remboursement client',
};

export const WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  requested: 'Demandé',
  approved: 'Approuvé',
  processing: 'En traitement',
  paid: 'Payé',
  rejected: 'Refusé',
  failed: 'Échoué',
};

export const DRIVER_STATUS_LABELS: Record<string, string> = {
  pending: 'Dossier en cours de validation',
  approved: 'Compte validé',
  rejected: 'Dossier refusé',
  suspended: 'Compte suspendu',
};

/** Normalisation minimale d'un numéro saisi, avant envoi à l'API. */
export function cleanPhone(input: string): string {
  return input.replace(/[^\d+]/g, '');
}
