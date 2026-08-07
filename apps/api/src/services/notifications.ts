import type { Queryable } from '../db/index.js';
import type { ActorType, NotificationChannel } from '../db/types.js';

/**
 * Notifications — §16 du cahier des charges.
 *
 * Toute notification est d'abord **enregistrée** puis remise à un transporteur.
 * L'enregistrement précède l'envoi : en cas d'échec du fournisseur, la trace
 * existe et la notification reste rejouable. Les canaux (push, SMS) sont des
 * adaptateurs — « les notifications peuvent être push, SMS ou autres selon le
 * besoin et le coût » (§16).
 */

export interface NotificationTransport {
  readonly channel: NotificationChannel;
  send(message: OutboundNotification): Promise<{ ok: boolean; reason?: string }>;
}

export interface OutboundNotification {
  recipientType: ActorType;
  recipientId: string;
  token: string | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

/** Transport de développement : journalise au lieu d'envoyer. */
export class LogTransport implements NotificationTransport {
  constructor(
    readonly channel: NotificationChannel,
    private readonly log: (message: string, payload?: unknown) => void,
  ) {}

  async send(message: OutboundNotification): Promise<{ ok: boolean }> {
    this.log(`[${this.channel}] ${message.title} → ${message.recipientType}:${message.recipientId}`, {
      body: message.body,
      data: message.data,
    });
    return { ok: true };
  }
}

/** Transport neutre : enregistre sans jamais émettre (canal désactivé). */
export class NoopTransport implements NotificationTransport {
  constructor(readonly channel: NotificationChannel) {}
  async send(): Promise<{ ok: boolean; reason: string }> {
    return { ok: false, reason: 'canal désactivé' };
  }
}

/** Modèles de messages du §16, centralisés pour rester cohérents entre canaux. */
export const TEMPLATES = {
  driver_found: (data: { driver: string; vehicle: string; eta: number }) => ({
    title: 'Chauffeur trouvé',
    body: `${data.driver} arrive en ${data.vehicle}, dans environ ${Math.max(1, Math.round(data.eta / 60))} min.`,
  }),
  driver_arrived: () => ({
    title: 'Votre chauffeur est arrivé',
    body: 'Votre chauffeur vous attend au point de départ.',
  }),
  ride_started: () => ({
    title: 'Course commencée',
    body: 'Bon voyage. Vous pouvez suivre le trajet dans l’application.',
  }),
  ride_completed: (data: { amount: string }) => ({
    title: 'Course terminée',
    body: `Montant à régler : ${data.amount}.`,
  }),
  payment_received: (data: { amount: string }) => ({
    title: 'Paiement confirmé',
    body: `Votre paiement de ${data.amount} a été enregistré.`,
  }),
  ride_cancelled: (data: { reason: string }) => ({
    title: 'Course annulée',
    body: data.reason,
  }),
  new_ride_offer: (data: { pickup: string; distance: string; fare: string }) => ({
    title: 'Nouvelle course',
    body: `Départ : ${data.pickup} (${data.distance}) — estimation ${data.fare}.`,
  }),
  driver_earning: (data: { amount: string }) => ({
    title: 'Course réglée',
    body: `${data.amount} ont été crédités sur votre portefeuille.`,
  }),
  withdrawal_paid: (data: { amount: string }) => ({
    title: 'Retrait effectué',
    body: `Votre retrait de ${data.amount} a été payé.`,
  }),
  account_warning: (data: { reason: string }) => ({
    title: 'Avertissement',
    body: data.reason,
  }),
  promotion: (data: { message: string }) => ({
    title: 'Offre en cours',
    body: data.message,
  }),
} as const;

export type TemplateName = keyof typeof TEMPLATES;

export interface NotifyInput {
  recipientType: ActorType;
  recipientId: string;
  template: TemplateName;
  title: string;
  body: string;
  channel?: NotificationChannel;
  data?: Record<string, unknown>;
  rideId?: string | null;
  token?: string | null;
}

export class NotificationService {
  private readonly transports = new Map<NotificationChannel, NotificationTransport>();

  constructor(transports: readonly NotificationTransport[]) {
    for (const transport of transports) {
      this.transports.set(transport.channel, transport);
    }
  }

  /**
   * Enregistre puis tente d'émettre. N'échoue jamais bruyamment : une
   * notification perdue ne doit pas faire échouer la course qui l'a déclenchée.
   */
  async notify(db: Queryable, input: NotifyInput): Promise<string> {
    const channel = input.channel ?? 'push';

    const inserted = await db
      .insertInto('notifications')
      .values({
        recipient_type: input.recipientType,
        recipient_id: input.recipientId,
        channel,
        template: input.template,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        ride_id: input.rideId ?? null,
        status: 'pending',
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const transport = this.transports.get(channel);
    if (!transport) {
      await db
        .updateTable('notifications')
        .set({ status: 'failed', failure_reason: `canal ${channel} non configuré` })
        .where('id', '=', inserted.id)
        .execute();
      return inserted.id;
    }

    const result = await transport.send({
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      token: input.token ?? null,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
    });

    await db
      .updateTable('notifications')
      .set(
        result.ok
          ? { status: 'sent', sent_at: new Date() }
          : { status: 'failed', failure_reason: result.reason ?? 'échec du transport' },
      )
      .where('id', '=', inserted.id)
      .execute();

    return inserted.id;
  }
}
