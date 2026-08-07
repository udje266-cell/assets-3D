import { sql } from 'kysely';
import type { AppContext } from '../context.js';
import type { ActorType } from '../db/types.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { FULFILLED_STATUSES } from '../domain/ride-state.js';

/**
 * Notation — §11 du cahier des charges.
 *
 * « Le client peut noter le chauffeur de 1 à 5 étoiles. Le chauffeur peut noter
 *   le client de 1 à 5 étoiles. »
 *
 * La moyenne est recalculée de façon incrémentale et stockée sur le profil noté
 * (`rating_average`, `rating_count`) : l'affichage d'une note ne doit pas
 * déclencher une agrégation sur tout l'historique.
 */

export interface SubmitReviewInput {
  rideId: string;
  authorType: Extract<ActorType, 'client' | 'driver'>;
  authorId: string;
  rating: number;
  comment?: string | null;
  tags?: readonly string[];
}

export async function submitReview(ctx: AppContext, input: SubmitReviewInput) {
  const ride = await ctx.db
    .selectFrom('rides')
    .selectAll()
    .where('id', '=', input.rideId)
    .executeTakeFirst();

  if (!ride) throw notFound('Course');

  if (input.authorType === 'client' && ride.user_id !== input.authorId) throw forbidden();
  if (input.authorType === 'driver' && ride.driver_id !== input.authorId) throw forbidden();

  // On ne note que ce qui a eu lieu : une course annulée ou expirée n'est pas
  // notable, sans quoi la note perd son sens et devient un outil de représailles.
  if (!FULFILLED_STATUSES.includes(ride.status)) {
    throw conflict('ride_not_completed', 'Cette course ne peut pas encore être évaluée.');
  }

  const subjectType: 'client' | 'driver' = input.authorType === 'client' ? 'driver' : 'client';
  const subjectId = subjectType === 'driver' ? ride.driver_id : ride.user_id;

  if (!subjectId) throw conflict('no_subject', 'Aucun chauffeur n’est associé à cette course.');

  return ctx.db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('reviews')
      .select('id')
      .where('ride_id', '=', input.rideId)
      .where('author_type', '=', input.authorType)
      .executeTakeFirst();

    if (existing) {
      throw conflict('already_reviewed', 'Vous avez déjà évalué cette course.');
    }

    const review = await trx
      .insertInto('reviews')
      .values({
        ride_id: input.rideId,
        author_type: input.authorType,
        author_id: input.authorId,
        subject_type: subjectType,
        subject_id: subjectId,
        rating: input.rating,
        comment: input.comment ?? null,
        tags: [...(input.tags ?? [])],
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Moyenne incrémentale : (moyenne × n + note) / (n + 1), arrondie au centième.
    const table = subjectType === 'driver' ? 'drivers' : 'users';
    await sql`
      UPDATE ${sql.table(table)}
      SET rating_average = ROUND(
            ((rating_average * rating_count) + ${input.rating})::numeric
            / (rating_count + 1), 2),
          rating_count = rating_count + 1
      WHERE id = ${subjectId}
    `.execute(trx);

    return review;
  });
}

/** Notes reçues par un chauffeur ou un client, pour l'administration (§14). */
export async function listReviewsFor(
  ctx: AppContext,
  params: { subjectType: 'client' | 'driver'; subjectId: string; limit?: number },
) {
  return ctx.db
    .selectFrom('reviews')
    .selectAll()
    .where('subject_type', '=', params.subjectType)
    .where('subject_id', '=', params.subjectId)
    .orderBy('created_at', 'desc')
    .limit(params.limit ?? 50)
    .execute();
}
