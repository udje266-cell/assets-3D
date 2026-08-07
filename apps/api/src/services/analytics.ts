import { sql } from 'kysely';
import type { DB } from '../db/index.js';

/**
 * Indicateurs clés de performance — §24 du cahier des charges.
 *
 * Tous les montants proviennent des colonnes figées sur la course
 * (`final_fare`, `platform_amount`, `driver_amount`, `discount_amount`) et non
 * d'un recalcul : un indicateur doit refléter ce qui a été facturé, même si une
 * grille tarifaire a changé depuis.
 *
 * Deux indicateurs du §24 — coût d'acquisition client et coût d'acquisition
 * chauffeur — dépendent de dépenses marketing qui ne transitent pas par la
 * plateforme. Ils sont donc renvoyés à `null` avec le dénominateur (nombre
 * d'inscriptions sur la période), à charge pour la direction de fournir le
 * budget correspondant. Les inventer serait leur ôter toute valeur.
 */

export interface KpiPeriod {
  from: Date;
  to: Date;
}

export interface Kpis {
  periode: { du: string; au: string };
  courses: {
    total: number;
    honorees: number;
    annulees: number;
    expirees: number;
    tauxAnnulation: number;
  };
  finances: {
    devise: string;
    /** Volume total des transactions (GMV) : somme des prix facturés. */
    gmv: number;
    remises: number;
    commissions: number;
    /** Revenu net de la plateforme : commissions − remises. */
    revenuPlateforme: number;
    revenuChauffeurs: number;
    panierMoyen: number;
    revenuMoyenParCourse: number;
    /** Marge de la plateforme sur le volume facturé, en pourcentage. */
    margePourcentage: number;
  };
  utilisateurs: {
    clientsActifs: number;
    chauffeursActifs: number;
    nouveauxClients: number;
    nouveauxChauffeurs: number;
  };
  operations: {
    tempsAttenteMoyenSecondes: number | null;
    tempsCourseMoyenSecondes: number | null;
    tauxAcceptation: number | null;
    offresEmises: number;
  };
  acquisition: {
    /** Renseignable uniquement avec le budget marketing de la période. */
    coutAcquisitionClient: null;
    coutAcquisitionChauffeur: null;
    note: string;
  };
}

export async function computeKpis(db: DB, period: KpiPeriod, currency = 'XOF'): Promise<Kpis> {
  const { from, to } = period;

  const rideStats = await db
    .selectFrom('rides')
    .select(({ fn, eb }) => [
      fn.countAll<number>().as('total'),
      fn
        .count<number>('id')
        .filterWhere('status', 'in', ['completed', 'awaiting_payment', 'paid', 'rated'])
        .as('honorees'),
      fn.count<number>('id').filterWhere('status', '=', 'cancelled').as('annulees'),
      fn.count<number>('id').filterWhere('status', '=', 'expired').as('expirees'),
      fn
        .sum<number>('final_fare')
        .filterWhere('status', 'in', ['paid', 'rated'])
        .as('gmv'),
      fn
        .sum<number>('discount_amount')
        .filterWhere('status', 'in', ['paid', 'rated'])
        .as('remises'),
      fn
        .sum<number>('platform_amount')
        .filterWhere('status', 'in', ['paid', 'rated'])
        .as('commissions'),
      fn
        .sum<number>('driver_amount')
        .filterWhere('status', 'in', ['paid', 'rated'])
        .as('revenu_chauffeurs'),
      fn
        .count<number>('id')
        .filterWhere('status', 'in', ['paid', 'rated'])
        .as('courses_payees'),
      eb.fn
        .countAll<number>()
        .filterWhere('driver_id', 'is not', null)
        .as('avec_chauffeur'),
    ])
    .where('created_at', '>=', from)
    .where('created_at', '<=', to)
    .executeTakeFirstOrThrow();

  const total = Number(rideStats.total ?? 0);
  const honorees = Number(rideStats.honorees ?? 0);
  const annulees = Number(rideStats.annulees ?? 0);
  const expirees = Number(rideStats.expirees ?? 0);
  const coursesPayees = Number(rideStats.courses_payees ?? 0);
  const gmv = Number(rideStats.gmv ?? 0);
  const remises = Number(rideStats.remises ?? 0);
  const commissions = Number(rideStats.commissions ?? 0);
  const revenuChauffeurs = Number(rideStats.revenu_chauffeurs ?? 0);
  const revenuPlateforme = commissions - remises;

  // Temps d'attente : de la demande à l'arrivée du chauffeur sur place.
  const timings = await sql<{
    attente: number | null;
    duree: number | null;
  }>`
    SELECT
      AVG(EXTRACT(EPOCH FROM (arrived_at - requested_at)))::double precision AS attente,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::double precision AS duree
    FROM rides
    WHERE created_at >= ${from} AND created_at <= ${to}
      AND arrived_at IS NOT NULL
  `.execute(db);

  const offers = await db
    .selectFrom('ride_offers')
    .select(({ fn }) => [
      fn.countAll<number>().as('emises'),
      fn.count<number>('id').filterWhere('status', '=', 'accepted').as('acceptees'),
    ])
    .where('created_at', '>=', from)
    .where('created_at', '<=', to)
    .executeTakeFirstOrThrow();

  const activeClients = await db
    .selectFrom('rides')
    .select(({ fn }) => fn.count<number>('user_id').distinct().as('total'))
    .where('created_at', '>=', from)
    .where('created_at', '<=', to)
    .executeTakeFirstOrThrow();

  const activeDrivers = await db
    .selectFrom('rides')
    .select(({ fn }) => fn.count<number>('driver_id').distinct().as('total'))
    .where('created_at', '>=', from)
    .where('created_at', '<=', to)
    .where('driver_id', 'is not', null)
    .executeTakeFirstOrThrow();

  const [newClients, newDrivers] = await Promise.all([
    db
      .selectFrom('users')
      .select(({ fn }) => fn.countAll<number>().as('total'))
      .where('created_at', '>=', from)
      .where('created_at', '<=', to)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('drivers')
      .select(({ fn }) => fn.countAll<number>().as('total'))
      .where('created_at', '>=', from)
      .where('created_at', '<=', to)
      .executeTakeFirstOrThrow(),
  ]);

  const emises = Number(offers.emises ?? 0);
  const acceptees = Number(offers.acceptees ?? 0);
  const timing = timings.rows[0];

  return {
    periode: { du: from.toISOString(), au: to.toISOString() },
    courses: {
      total,
      honorees,
      annulees,
      expirees,
      tauxAnnulation: total > 0 ? round2((annulees / total) * 100) : 0,
    },
    finances: {
      devise: currency,
      gmv,
      remises,
      commissions,
      revenuPlateforme,
      revenuChauffeurs,
      panierMoyen: coursesPayees > 0 ? Math.round(gmv / coursesPayees) : 0,
      revenuMoyenParCourse: coursesPayees > 0 ? Math.round(revenuPlateforme / coursesPayees) : 0,
      margePourcentage: gmv > 0 ? round2((revenuPlateforme / gmv) * 100) : 0,
    },
    utilisateurs: {
      clientsActifs: Number(activeClients.total ?? 0),
      chauffeursActifs: Number(activeDrivers.total ?? 0),
      nouveauxClients: Number(newClients.total ?? 0),
      nouveauxChauffeurs: Number(newDrivers.total ?? 0),
    },
    operations: {
      tempsAttenteMoyenSecondes: timing?.attente != null ? Math.round(timing.attente) : null,
      tempsCourseMoyenSecondes: timing?.duree != null ? Math.round(timing.duree) : null,
      tauxAcceptation: emises > 0 ? round2((acceptees / emises) * 100) : null,
      offresEmises: emises,
    },
    acquisition: {
      coutAcquisitionClient: null,
      coutAcquisitionChauffeur: null,
      note:
        'Les coûts d’acquisition exigent le budget marketing de la période, ' +
        'qui ne transite pas par la plateforme. Diviser ce budget par les ' +
        'nouveaux inscrits de la période pour les obtenir.',
    },
  };
}

/** Volumes journaliers pour les graphiques du tableau de bord (§14). */
export async function dailySeries(db: DB, period: KpiPeriod) {
  const rows = await sql<{
    jour: string;
    courses: number;
    gmv: number;
    commissions: number;
  }>`
    SELECT
      to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS jour,
      COUNT(*)::int AS courses,
      COALESCE(SUM(final_fare) FILTER (WHERE status IN ('paid', 'rated')), 0)::bigint AS gmv,
      COALESCE(SUM(platform_amount) FILTER (WHERE status IN ('paid', 'rated')), 0)::bigint AS commissions
    FROM rides
    WHERE created_at >= ${period.from} AND created_at <= ${period.to}
    GROUP BY 1
    ORDER BY 1
  `.execute(db);

  return rows.rows.map((row) => ({
    jour: row.jour,
    courses: Number(row.courses),
    gmv: Number(row.gmv),
    commissions: Number(row.commissions),
  }));
}

/** Instantané temps réel affiché en tête du tableau de bord (§14). */
export async function liveSnapshot(db: DB) {
  const [drivers, rides, tickets, withdrawals] = await Promise.all([
    db
      .selectFrom('drivers')
      .select(({ fn }) => [
        fn.count<number>('id').filterWhere('availability', '=', 'online').as('en_ligne'),
        fn.count<number>('id').filterWhere('availability', '=', 'on_ride').as('en_course'),
        fn.count<number>('id').filterWhere('status', '=', 'pending').as('en_attente_validation'),
      ])
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('rides')
      .select(({ fn }) => [
        fn
          .count<number>('id')
          .filterWhere('status', 'in', ['requested', 'searching'])
          .as('en_recherche'),
        fn
          .count<number>('id')
          .filterWhere('status', 'in', [
            'driver_assigned',
            'driver_en_route',
            'driver_arrived',
            'in_progress',
          ])
          .as('en_cours'),
      ])
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('support_tickets')
      .select(({ fn }) => fn.count<number>('id').filterWhere('status', 'in', ['open', 'in_progress']).as('ouverts'))
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('withdrawals')
      .select(({ fn }) => fn.count<number>('id').filterWhere('status', '=', 'requested').as('en_attente'))
      .executeTakeFirstOrThrow(),
  ]);

  return {
    chauffeursEnLigne: Number(drivers.en_ligne ?? 0),
    chauffeursEnCourse: Number(drivers.en_course ?? 0),
    chauffeursAValider: Number(drivers.en_attente_validation ?? 0),
    coursesEnRecherche: Number(rides.en_recherche ?? 0),
    coursesEnCours: Number(rides.en_cours ?? 0),
    ticketsOuverts: Number(tickets.ouverts ?? 0),
    retraitsEnAttente: Number(withdrawals.en_attente ?? 0),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
