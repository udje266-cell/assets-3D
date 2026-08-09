import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RIDE_STATUS_LABELS, api, formatAmount, formatDate, formatDuration } from '../api';
import { Badge, Card, Definition, ErrorMessage, Loading, Table, rideTone } from '../components/ui';
import { useAction, useApi } from '../hooks';

/** Suivi des courses — §14, avec le dossier complet exigé au §15. */

interface Ride {
  id: string;
  reference: string;
  status: string;
  user_id: string;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  final_fare: number | null;
  estimated_fare: number | null;
  discount_amount: number;
  platform_amount: number;
  driver_amount: number;
  cancellation_fee: number;
  currency: string;
  payment_method: string;
  actual_distance_m: number | null;
  actual_duration_s: number | null;
  estimated_distance_m: number | null;
  commission_bps: number | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export function RidesList() {
  const [status, setStatus] = useState('');
  const [reference, setReference] = useState('');
  const [applied, setApplied] = useState('');

  const query = new URLSearchParams({ limit: '50' });
  if (status) query.set('status', status);
  if (applied) query.set('reference', applied);

  const { data, error, loading } = useApi<{ items: Ride[] }>(
    `/v1/admin/rides?${query.toString()}`,
    [status, applied],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Courses</h1>
          <p>Statut, trajet, prix et paiement de chaque course.</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="status">Statut</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            {Object.entries(RIDE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="reference">Référence</label>
          <input
            id="reference"
            value={reference}
            placeholder="CRS-…"
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setApplied(reference)}
          />
        </div>
        <button onClick={() => setApplied(reference)}>Filtrer</button>
      </div>

      <ErrorMessage error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <Table
          headers={['Référence', 'Statut', 'Trajet', 'Prix', 'Commission', 'Paiement', 'Date']}
          empty={data?.items.length === 0}
        >
          {data?.items.map((ride) => (
            <tr key={ride.id}>
              <td>
                <Link to={`/courses/${ride.id}`} className="mono">
                  {ride.reference}
                </Link>
              </td>
              <td>
                <Badge tone={rideTone(ride.status)}>
                  {RIDE_STATUS_LABELS[ride.status] ?? ride.status}
                </Badge>
              </td>
              <td>
                {ride.pickup_address ?? 'Départ'} → {ride.dropoff_address ?? 'Arrivée'}
              </td>
              <td className="num">{formatAmount(ride.final_fare ?? ride.estimated_fare, ride.currency)}</td>
              <td className="num">{formatAmount(ride.platform_amount, ride.currency)}</td>
              <td>{paymentLabel(ride.payment_method)}</td>
              <td>{formatDate(ride.created_at)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

interface RideDetailData {
  ride: Ride;
  driver: { first_name: string; last_name: string; phone: string; rating_average: number } | null;
  user: { first_name: string | null; last_name: string | null; phone: string } | null;
  vehicle: { make: string; model: string; plate_number: string } | null;
  events: Array<{ to_status: string; actor_type: string; created_at: string; context: unknown }>;
  payments: Array<{ id: string; amount: number; method: string; status: string; provider_reference: string | null }>;
  offers: Array<{ id: string; driver_id: string; status: string; distance_m: number | null; created_at: string }>;
  trace: Array<{ latitude: number; longitude: number; recorded_at: string }>;
}

export function RideDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useApi<RideDetailData>(
    id ? `/v1/admin/rides/${id}` : null,
  );
  const action = useAction(reload);
  const [reason, setReason] = useState('');

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorMessage error={error} />;

  const { ride } = data;
  const active = !['paid', 'rated', 'cancelled', 'expired'].includes(ride.status);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="mono">{ride.reference}</h1>
          <p>
            <Link to="/courses">← Retour aux courses</Link>
          </p>
        </div>
        <Badge tone={rideTone(ride.status)}>
          {RIDE_STATUS_LABELS[ride.status] ?? ride.status}
        </Badge>
      </div>

      <ErrorMessage error={action.error ?? error} />
      {action.message ? <div className="alert alert-success">{action.message}</div> : null}

      <div className="grid grid-2">
        <Card title="Trajet">
          <Definition
            items={[
              ['Départ', ride.pickup_address ?? '—'],
              ['Destination', ride.dropoff_address ?? '—'],
              [
                'Distance',
                ride.actual_distance_m
                  ? `${(ride.actual_distance_m / 1000).toFixed(1)} km (réelle)`
                  : ride.estimated_distance_m
                    ? `${(ride.estimated_distance_m / 1000).toFixed(1)} km (estimée)`
                    : '—',
              ],
              ['Durée', formatDuration(ride.actual_duration_s)],
              ['Points GPS enregistrés', data.trace.length],
              ['Demandée le', formatDate(ride.created_at)],
              ['Terminée le', formatDate(ride.completed_at)],
            ]}
          />
        </Card>

        <Card title="Facturation">
          <Definition
            items={[
              ['Prix de la course', formatAmount(ride.final_fare ?? ride.estimated_fare, ride.currency)],
              ['Remise', formatAmount(ride.discount_amount, ride.currency)],
              [
                'Montant dû par le client',
                formatAmount(
                  ride.final_fare !== null ? ride.final_fare - ride.discount_amount : null,
                  ride.currency,
                ),
              ],
              [
                'Commission plateforme',
                `${formatAmount(ride.platform_amount, ride.currency)}${
                  ride.commission_bps !== null ? ` (${ride.commission_bps / 100} %)` : ''
                }`,
              ],
              ['Part chauffeur', formatAmount(ride.driver_amount, ride.currency)],
              ['Frais d’annulation', formatAmount(ride.cancellation_fee, ride.currency)],
              ['Moyen de paiement', paymentLabel(ride.payment_method)],
            ]}
          />
        </Card>
      </div>

      <div className="grid grid-2" style={{ marginTop: 16 }}>
        <Card title="Participants">
          <Definition
            items={[
              [
                'Client',
                data.user
                  ? `${data.user.first_name ?? ''} ${data.user.last_name ?? ''} — ${data.user.phone}`
                  : '—',
              ],
              [
                'Chauffeur',
                data.driver ? (
                  <Link to={`/chauffeurs/${ride.driver_id}`}>
                    {data.driver.first_name} {data.driver.last_name} — {data.driver.phone}
                  </Link>
                ) : (
                  'Aucun chauffeur assigné'
                ),
              ],
              [
                'Véhicule',
                data.vehicle
                  ? `${data.vehicle.make} ${data.vehicle.model} (${data.vehicle.plate_number})`
                  : '—',
              ],
              ['Annulée par', ride.cancelled_by ?? '—'],
              ['Motif', ride.cancellation_reason ?? '—'],
            ]}
          />

          {active ? (
            <div style={{ marginTop: 16 }}>
              <div className="field">
                <label htmlFor="cancel-reason">Motif d’annulation</label>
                <input
                  id="cancel-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex. : incident signalé par le client"
                />
              </div>
              <button
                className="danger"
                style={{ marginTop: 8 }}
                disabled={action.pending || !reason}
                onClick={() =>
                  void action.run(
                    () =>
                      api(`/v1/admin/rides/${ride.id}/cancel`, {
                        method: 'POST',
                        body: { reason },
                      }),
                    'Course annulée.',
                  )
                }
              >
                Annuler la course
              </button>
            </div>
          ) : null}
        </Card>

        <Card title="Journal des états">
          {/* Exigence du §6 : chaque changement d'état est enregistré côté serveur. */}
          <ol className="timeline">
            {data.events.map((event, index) => (
              <li key={`${event.to_status}-${index}`}>
                <strong>{RIDE_STATUS_LABELS[event.to_status] ?? event.to_status}</strong>
                <time>
                  {formatDate(event.created_at)} — {event.actor_type}
                </time>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card title="Paiements">
        <Table
          headers={['Montant', 'Moyen', 'Statut', 'Référence prestataire']}
          empty={data.payments.length === 0}
        >
          {data.payments.map((payment) => (
            <tr key={payment.id}>
              <td className="num">{formatAmount(payment.amount, ride.currency)}</td>
              <td>{paymentLabel(payment.method)}</td>
              <td>{payment.status}</td>
              <td className="mono">{payment.provider_reference ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Offres d’attribution">
        <Table headers={['Chauffeur', 'Statut', 'Distance', 'Émise le']} empty={data.offers.length === 0}>
          {data.offers.map((offer) => (
            <tr key={offer.id}>
              <td>
                <Link to={`/chauffeurs/${offer.driver_id}`} className="mono">
                  {offer.driver_id.slice(0, 8)}…
                </Link>
              </td>
              <td>{offer.status}</td>
              <td className="num">
                {offer.distance_m !== null ? `${(offer.distance_m / 1000).toFixed(1)} km` : '—'}
              </td>
              <td>{formatDate(offer.created_at)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

export function paymentLabel(method: string): string {
  return (
    {
      cash: 'Espèces',
      mobile_money: 'Mobile money',
      card: 'Carte bancaire',
      wallet: 'Portefeuille',
    }[method] ?? method
  );
}
