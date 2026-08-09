import { formatAmount, formatDuration, formatPercent } from '../api';
import { BarChart } from '../components/BarChart';
import { Card, Definition, ErrorMessage, Loading, Tile } from '../components/ui';
import { useApi, useDefaultPeriod } from '../hooks';

/** Tableau de bord — §14, alimenté par les indicateurs du §24. */

interface DashboardData {
  instantane: {
    chauffeursEnLigne: number;
    chauffeursEnCourse: number;
    chauffeursAValider: number;
    coursesEnRecherche: number;
    coursesEnCours: number;
    ticketsOuverts: number;
    retraitsEnAttente: number;
  };
  kpis: {
    courses: {
      total: number;
      honorees: number;
      annulees: number;
      expirees: number;
      tauxAnnulation: number;
    };
    finances: {
      devise: string;
      gmv: number;
      remises: number;
      commissions: number;
      revenuPlateforme: number;
      revenuChauffeurs: number;
      panierMoyen: number;
      revenuMoyenParCourse: number;
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
    acquisition: { note: string };
  };
  serie: Array<{ jour: string; courses: number; gmv: number; commissions: number }>;
}

export function Dashboard() {
  const period = useDefaultPeriod();
  const { data, error, loading } = useApi<DashboardData>(
    `/v1/admin/dashboard?${period.query}`,
    [period.query],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Tableau de bord</h1>
          <p>Activité en temps réel et indicateurs de la période.</p>
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="field">
            <label htmlFor="from">Du</label>
            <input
              id="from"
              type="date"
              value={period.from}
              onChange={(e) => period.setFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="to">Au</label>
            <input
              id="to"
              type="date"
              value={period.to}
              onChange={(e) => period.setTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      <ErrorMessage error={error} />
      {loading && !data ? <Loading /> : null}

      {data && (
        <>
          <Card title="Activité en cours">
            <div className="tiles">
              <Tile label="Chauffeurs en ligne" value={data.instantane.chauffeursEnLigne} />
              <Tile label="Chauffeurs en course" value={data.instantane.chauffeursEnCourse} />
              <Tile label="Courses en cours" value={data.instantane.coursesEnCours} />
              <Tile
                label="Courses en recherche"
                value={data.instantane.coursesEnRecherche}
                hint="Aucun chauffeur encore assigné"
              />
              <Tile
                label="Chauffeurs à valider"
                value={data.instantane.chauffeursAValider}
                hint="Dossiers en attente"
              />
              <Tile label="Litiges ouverts" value={data.instantane.ticketsOuverts} />
              <Tile label="Retraits à traiter" value={data.instantane.retraitsEnAttente} />
            </div>
          </Card>

          <Card title="Volume et revenus de la période">
            <div className="tiles">
              <Tile
                label="Volume de transactions (GMV)"
                value={formatAmount(data.kpis.finances.gmv, data.kpis.finances.devise)}
                hint={`${data.kpis.courses.honorees} course(s) honorée(s)`}
              />
              <Tile
                label="Commissions"
                value={formatAmount(data.kpis.finances.commissions, data.kpis.finances.devise)}
              />
              <Tile
                label="Revenu net plateforme"
                value={formatAmount(data.kpis.finances.revenuPlateforme, data.kpis.finances.devise)}
                hint={`Après ${formatAmount(data.kpis.finances.remises)} de remises`}
              />
              <Tile
                label="Revenu chauffeurs"
                value={formatAmount(data.kpis.finances.revenuChauffeurs, data.kpis.finances.devise)}
              />
              <Tile
                label="Panier moyen"
                value={formatAmount(data.kpis.finances.panierMoyen, data.kpis.finances.devise)}
              />
              <Tile
                label="Marge plateforme"
                value={formatPercent(data.kpis.finances.margePourcentage)}
                hint="Revenu net rapporté au volume"
              />
            </div>
          </Card>

          {/*
            Deux mesures d'ordres de grandeur différents : deux graphiques
            distincts plutôt qu'un seul cadre à double échelle.
          */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title="Courses par jour">
              <BarChart
                data={data.serie.map((point) => ({
                  label: point.jour.slice(8),
                  caption: formatDay(point.jour),
                  value: point.courses,
                }))}
              />
            </Card>

            <Card title="Commissions par jour">
              <BarChart
                color="var(--series-3)"
                data={data.serie.map((point) => ({
                  label: point.jour.slice(8),
                  caption: formatDay(point.jour),
                  value: point.commissions,
                }))}
                format={(value) => formatAmount(value, data.kpis.finances.devise)}
              />
            </Card>
          </div>

          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card title="Exploitation">
              <Definition
                items={[
                  ['Courses demandées', data.kpis.courses.total],
                  ['Courses honorées', data.kpis.courses.honorees],
                  ['Annulées', data.kpis.courses.annulees],
                  ['Expirées (aucun chauffeur)', data.kpis.courses.expirees],
                  ['Taux d’annulation', formatPercent(data.kpis.courses.tauxAnnulation)],
                  [
                    'Temps d’attente moyen',
                    formatDuration(data.kpis.operations.tempsAttenteMoyenSecondes),
                  ],
                  [
                    'Durée moyenne de course',
                    formatDuration(data.kpis.operations.tempsCourseMoyenSecondes),
                  ],
                  [
                    'Taux d’acceptation',
                    `${formatPercent(data.kpis.operations.tauxAcceptation)} (${data.kpis.operations.offresEmises} offre(s))`,
                  ],
                ]}
              />
            </Card>

            <Card title="Utilisateurs">
              <Definition
                items={[
                  ['Clients actifs', data.kpis.utilisateurs.clientsActifs],
                  ['Chauffeurs actifs', data.kpis.utilisateurs.chauffeursActifs],
                  ['Nouveaux clients', data.kpis.utilisateurs.nouveauxClients],
                  ['Nouveaux chauffeurs', data.kpis.utilisateurs.nouveauxChauffeurs],
                  ['Coût d’acquisition client', '—'],
                  ['Coût d’acquisition chauffeur', '—'],
                ]}
              />
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 0 }}>
                {data.kpis.acquisition.note}
              </p>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function formatDay(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}
