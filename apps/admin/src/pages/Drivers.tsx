import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DRIVER_STATUS_LABELS, api, formatAmount, formatDate } from '../api';
import { Badge, Card, Definition, ErrorMessage, Loading, Table, driverTone } from '../components/ui';
import { useAction, useApi } from '../hooks';

/** Gestion des chauffeurs — §14 : validation, suspension, documents, revenus. */

interface Driver {
  id: string;
  phone: string;
  first_name: string;
  last_name: string;
  status: string;
  availability: string;
  status_reason: string | null;
  rating_average: number;
  rating_count: number;
  rides_count: number;
  offers_received: number;
  offers_accepted: number;
  created_at: string;
  approved_at: string | null;
}

export function DriversList() {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');

  const query = new URLSearchParams({ limit: '50' });
  if (status) query.set('status', status);
  if (applied) query.set('search', applied);

  const { data, error, loading } = useApi<{ items: Driver[]; total: number }>(
    `/v1/admin/drivers?${query.toString()}`,
    [status, applied],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Chauffeurs</h1>
          <p>Validation des dossiers, suivi de l’activité et des évaluations.</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="status">Statut</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            <option value="pending">En attente</option>
            <option value="approved">Validé</option>
            <option value="suspended">Suspendu</option>
            <option value="rejected">Refusé</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="search">Recherche</label>
          <input
            id="search"
            value={search}
            placeholder="Nom ou téléphone"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setApplied(search)}
          />
        </div>
        <button onClick={() => setApplied(search)}>Filtrer</button>
      </div>

      <ErrorMessage error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <Table
          headers={[
            'Nom',
            'Téléphone',
            'Statut',
            'Disponibilité',
            'Courses',
            'Note',
            'Acceptation',
            'Inscrit le',
          ]}
          empty={data?.items.length === 0}
        >
          {data?.items.map((driver) => (
            <tr key={driver.id}>
              <td>
                <Link to={`/chauffeurs/${driver.id}`}>
                  {driver.first_name} {driver.last_name}
                </Link>
              </td>
              <td className="mono">{driver.phone}</td>
              <td>
                <Badge tone={driverTone(driver.status)}>
                  {DRIVER_STATUS_LABELS[driver.status] ?? driver.status}
                </Badge>
              </td>
              <td>{availabilityLabel(driver.availability)}</td>
              <td className="num">{driver.rides_count}</td>
              <td className="num">
                {driver.rating_count > 0 ? `${Number(driver.rating_average).toFixed(2)} ★` : '—'}
              </td>
              <td className="num">
                {driver.offers_received > 0
                  ? `${Math.round((driver.offers_accepted / driver.offers_received) * 100)} %`
                  : '—'}
              </td>
              <td>{formatDate(driver.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

interface DriverDetailData {
  driver: Driver;
  vehicles: Array<{
    id: string;
    make: string;
    model: string;
    plate_number: string;
    is_verified: boolean;
  }>;
  documents: Array<{
    id: string;
    doc_type: string;
    status: string;
    file_url: string;
    expires_at: string | null;
    review_note: string | null;
  }>;
  wallet: { balance: number; total_earned: number; total_commission: number; currency: string } | null;
  rides: Array<{ id: string; reference: string; status: string; final_fare: number | null; created_at: string }>;
  reviews: Array<{ id: string; rating: number; comment: string | null; created_at: string }>;
}

export function DriverDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<DriverDetailData>(
    id ? `/v1/admin/drivers/${id}` : null,
  );
  const action = useAction(reload);
  const [reason, setReason] = useState('');

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorMessage error={error} />;

  const { driver } = data;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            {driver.first_name} {driver.last_name}
          </h1>
          <p>
            <Link to="/chauffeurs">← Retour aux chauffeurs</Link>
          </p>
        </div>
        <Badge tone={driverTone(driver.status)}>
          {DRIVER_STATUS_LABELS[driver.status] ?? driver.status}
        </Badge>
      </div>

      <ErrorMessage error={action.error ?? error} />
      {action.message ? <div className="alert alert-success">{action.message}</div> : null}

      <div className="grid grid-2">
        <Card title="Dossier">
          <Definition
            items={[
              ['Téléphone', <span className="mono">{driver.phone}</span>],
              ['Inscrit le', formatDate(driver.created_at)],
              ['Validé le', formatDate(driver.approved_at)],
              ['Disponibilité', availabilityLabel(driver.availability)],
              ['Courses effectuées', driver.rides_count],
              [
                'Note moyenne',
                driver.rating_count > 0
                  ? `${Number(driver.rating_average).toFixed(2)} ★ (${driver.rating_count} avis)`
                  : 'Aucune évaluation',
              ],
              ['Motif du statut', driver.status_reason ?? '—'],
            ]}
          />
        </Card>

        <Card title="Portefeuille">
          {data.wallet ? (
            <Definition
              items={[
                ['Solde', formatAmount(data.wallet.balance, data.wallet.currency)],
                ['Total gagné', formatAmount(data.wallet.total_earned, data.wallet.currency)],
                [
                  'Commissions retenues',
                  formatAmount(data.wallet.total_commission, data.wallet.currency),
                ],
              ]}
            />
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>
              Aucun portefeuille : il est créé à la validation du chauffeur.
            </p>
          )}
          {data.wallet && data.wallet.balance < 0 ? (
            <p style={{ color: 'var(--warning)', marginBottom: 0 }}>
              Solde négatif : commissions dues sur des courses encaissées en espèces.
            </p>
          ) : null}
        </Card>
      </div>

      <Card title="Décision">
        <div className="field">
          <label htmlFor="reason">Motif (obligatoire pour un refus ou une suspension)</label>
          <input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex. : documents non conformes"
          />
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={action.pending || driver.status === 'approved'}
            onClick={() =>
              void action.run(
                () =>
                  api(`/v1/admin/drivers/${driver.id}/status`, {
                    method: 'POST',
                    body: { status: 'approved' },
                  }),
                'Chauffeur validé.',
              )
            }
          >
            Valider
          </button>
          <button
            disabled={action.pending || !reason}
            onClick={() =>
              void action.run(
                () =>
                  api(`/v1/admin/drivers/${driver.id}/status`, {
                    method: 'POST',
                    body: { status: 'suspended', reason },
                  }),
                'Chauffeur suspendu.',
              )
            }
          >
            Suspendre
          </button>
          <button
            className="danger"
            disabled={action.pending || !reason}
            onClick={() =>
              void action.run(
                () =>
                  api(`/v1/admin/drivers/${driver.id}/status`, {
                    method: 'POST',
                    body: { status: 'rejected', reason },
                  }),
                'Dossier refusé.',
              )
            }
          >
            Refuser
          </button>
        </div>
      </Card>

      <Card title="Documents">
        <Table headers={['Type', 'Statut', 'Expire le', 'Note', 'Action']} empty={data.documents.length === 0}>
          {data.documents.map((document) => (
            <tr key={document.id}>
              <td>{document.doc_type}</td>
              <td>
                <Badge
                  tone={
                    document.status === 'approved'
                      ? 'good'
                      : document.status === 'pending'
                        ? 'warning'
                        : 'critical'
                  }
                >
                  {document.status}
                </Badge>
              </td>
              <td>{document.expires_at ? formatDate(document.expires_at) : '—'}</td>
              <td>{document.review_note ?? '—'}</td>
              <td>
                <div className="actions">
                  <button
                    disabled={action.pending || document.status === 'approved'}
                    onClick={() =>
                      void action.run(
                        () =>
                          api(`/v1/admin/documents/${document.id}/review`, {
                            method: 'POST',
                            body: { status: 'approved' },
                          }),
                        'Document validé.',
                      )
                    }
                  >
                    Valider
                  </button>
                  <button
                    className="danger"
                    disabled={action.pending}
                    onClick={() =>
                      void action.run(
                        () =>
                          api(`/v1/admin/documents/${document.id}/review`, {
                            method: 'POST',
                            body: { status: 'rejected', note: reason || 'Document non conforme' },
                          }),
                        'Document refusé.',
                      )
                    }
                  >
                    Refuser
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Véhicules">
        <Table headers={['Véhicule', 'Immatriculation', 'Vérifié']} empty={data.vehicles.length === 0}>
          {data.vehicles.map((vehicle) => (
            <tr key={vehicle.id}>
              <td>
                {vehicle.make} {vehicle.model}
              </td>
              <td className="mono">{vehicle.plate_number}</td>
              <td>{vehicle.is_verified ? 'Oui' : 'Non'}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Dernières courses">
        <Table headers={['Référence', 'Statut', 'Montant', 'Date']} empty={data.rides.length === 0}>
          {data.rides.map((ride) => (
            <tr key={ride.id}>
              <td>
                <Link to={`/courses/${ride.id}`} className="mono">
                  {ride.reference}
                </Link>
              </td>
              <td>{ride.status}</td>
              <td className="num">{formatAmount(ride.final_fare)}</td>
              <td>{formatDate(ride.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

function availabilityLabel(availability: string): string {
  return (
    { offline: 'Hors ligne', online: 'En ligne', on_ride: 'En course' }[availability] ?? availability
  );
}
