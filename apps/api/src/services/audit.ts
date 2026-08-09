import type { Queryable } from '../db/index.js';
import type { ActorType } from '../db/types.js';

/**
 * Journalisation des événements importants — §12.
 *
 * Toute action d'administration qui modifie un état sensible (validation d'un
 * chauffeur, changement de tarif, remboursement, suspension) doit laisser une
 * trace : qui, quoi, quand, valeur avant et après.
 */
export interface AuditInput {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function recordAudit(db: Queryable, input: AuditInput): Promise<void> {
  await db
    .insertInto('audit_logs')
    .values({
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      ip: input.ip ?? null,
      user_agent: input.userAgent ?? null,
    })
    .execute();
}
