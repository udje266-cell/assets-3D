import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RIDE_STATUS_LABELS, api, formatAmount, formatDate } from '../api';
import { Badge, Card, Definition, ErrorMessage, Loading, Table } from '../components/ui';
import { useAction, useApi } from '../hooks';

/**
 * Gestion des litiges — §15.
 *
 * « Consultation des informations de la course et des événements associés. »
 * Le dossier ouvert par un ticket livre la course, son journal d'états et ses
 * paiements : l'agent n'a pas à naviguer ailleurs pour décider.
 */

interface Ticket {
  id: string;
  reference: string;
  ride_id: string | null;
  reporter_type: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  resolution: string | null;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  driver_no_show: 'Chauffeur absent',
  wrong_price: 'Prix incorrect',
  payment: 'Paiement',
  lost_item: 'Objet oublié',
  incident: 'Incident',
  vehicle: 'Véhicule',
  other: 'Autre',
};

export function Tickets() {
  const [status, setStatus] = useState('open');
  const [selected, setSelected] = useState<string | null>(null);

  const query = new URLSearchParams({ limit: '50' });
  if (status) query.set('status', status);

  const { data, error, loading, reload } = useApi<{ items: Ticket[] }>(
    `/v1/admin/tickets?${query.toString()}`,
    [status],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Litiges</h1>
          <p>Signalements des clients et des chauffeurs, et leur traitement.</p>
        </div>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="status">Statut</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            <option value="open">Ouvert</option>
            <option value="in_progress">En cours</option>
            <option value="waiting_user">En attente du déclarant</option>
            <option value="resolved">Résolu</option>
            <option value="closed">Clos</option>
          </select>
        </div>
      </div>

      <ErrorMessage error={error} />

      {loading && !data ? (
        <Loading />
      ) : (
        <Table
          headers={['Référence', 'Sujet', 'Catégorie', 'Déclarant', 'Priorité', 'Statut', 'Créé le', '']}
          empty={data?.items.length === 0}
        >
          {data?.items.map((ticket) => (
            <tr key={ticket.id}>
              <td className="mono">{ticket.reference}</td>
              <td>{ticket.subject}</td>
              <td>{CATEGORY_LABELS[ticket.category] ?? ticket.category}</td>
              <td>{ticket.reporter_type === 'client' ? 'Client' : 'Chauffeur'}</td>
              <td>
                <Badge
                  tone={
                    ticket.priority === 'urgent'
                      ? 'critical'
                      : ticket.priority === 'high'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {ticket.priority}
                </Badge>
              </td>
              <td>{ticket.status}</td>
              <td>{formatDate(ticket.created_at)}</td>
              <td>
                <button onClick={() => setSelected(selected === ticket.id ? null : ticket.id)}>
                  {selected === ticket.id ? 'Fermer' : 'Ouvrir'}
                </button>
              </td>
            </tr>
          ))}
        </Table>
      )}

      {selected ? <TicketDetail ticketId={selected} onChange={reload} /> : null}
    </>
  );
}

interface TicketDetailData {
  ticket: Ticket;
  messages: Array<{
    id: string;
    author_type: string;
    body: string;
    is_internal: boolean;
    created_at: string;
  }>;
  ride: {
    ride: {
      id: string;
      reference: string;
      status: string;
      final_fare: number | null;
      discount_amount: number;
      platform_amount: number;
      currency: string;
      actual_distance_m: number | null;
    };
    events: Array<{ to_status: string; created_at: string; actor_type: string }>;
    payments: Array<{ id: string; amount: number; status: string; method: string }>;
  } | null;
}

function TicketDetail({ ticketId, onChange }: { ticketId: string; onChange: () => void }) {
  const { data, error, loading, reload } = useApi<TicketDetailData>(
    `/v1/admin/tickets/${ticketId}`,
    [ticketId],
  );
  const action = useAction(async () => {
    await reload();
    onChange();
  });
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [resolution, setResolution] = useState('');

  if (loading && !data) return <Loading />;
  if (!data) return <ErrorMessage error={error} />;

  return (
    <div style={{ marginTop: 20 }}>
      <ErrorMessage error={action.error} />
      {action.message ? <div className="alert alert-success">{action.message}</div> : null}

      <div className="grid grid-2">
        <Card title={`Dossier ${data.ticket.reference}`}>
          <Definition
            items={[
              ['Sujet', data.ticket.subject],
              ['Catégorie', CATEGORY_LABELS[data.ticket.category] ?? data.ticket.category],
              ['Statut', data.ticket.status],
              ['Créé le', formatDate(data.ticket.created_at)],
              ['Résolution', data.ticket.resolution ?? '—'],
            ]}
          />
          <p style={{ marginTop: 12, whiteSpace: 'pre-wrap' }}>{data.ticket.description}</p>
        </Card>

        <Card title="Course concernée">
          {data.ride ? (
            <>
              <Definition
                items={[
                  [
                    'Référence',
                    <Link to={`/courses/${data.ride.ride.id}`} className="mono">
                      {data.ride.ride.reference}
                    </Link>,
                  ],
                  [
                    'Statut',
                    RIDE_STATUS_LABELS[data.ride.ride.status] ?? data.ride.ride.status,
                  ],
                  [
                    'Prix',
                    formatAmount(data.ride.ride.final_fare, data.ride.ride.currency),
                  ],
                  ['Remise', formatAmount(data.ride.ride.discount_amount, data.ride.ride.currency)],
                  [
                    'Commission',
                    formatAmount(data.ride.ride.platform_amount, data.ride.ride.currency),
                  ],
                  [
                    'Distance réelle',
                    data.ride.ride.actual_distance_m
                      ? `${(data.ride.ride.actual_distance_m / 1000).toFixed(1)} km`
                      : '—',
                  ],
                ]}
              />
              <h3 style={{ marginTop: 16, marginBottom: 8 }}>Journal des états</h3>
              <ol className="timeline">
                {data.ride.events.map((event, index) => (
                  <li key={index}>
                    <strong>{RIDE_STATUS_LABELS[event.to_status] ?? event.to_status}</strong>
                    <time>
                      {formatDate(event.created_at)} — {event.actor_type}
                    </time>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Ce signalement ne vise aucune course.</p>
          )}
        </Card>
      </div>

      <Card title="Échanges">
        {data.messages.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>Aucun message.</p>
        ) : (
          <ol className="timeline">
            {data.messages.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {entry.author_type}
                  {entry.is_internal ? ' (note interne)' : ''}
                </strong>
                <div style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                <time>{formatDate(entry.created_at)}</time>
              </li>
            ))}
          </ol>
        )}

        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="message">Réponse</label>
          <textarea
            id="message"
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
          />
          Note interne (invisible du déclarant)
        </label>
        <button
          className="primary"
          style={{ marginTop: 12 }}
          disabled={action.pending || !message}
          onClick={() =>
            void action
              .run(
                () =>
                  api(`/v1/admin/tickets/${ticketId}/messages`, {
                    method: 'POST',
                    body: { body: message, internal },
                  }),
                'Message enregistré.',
              )
              .then((ok) => ok && setMessage(''))
          }
        >
          Envoyer
        </button>
      </Card>

      <Card title="Clôturer">
        <div className="field">
          <label htmlFor="resolution">Résolution</label>
          <textarea
            id="resolution"
            rows={2}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Ex. : distance confirmée par la trace GPS, aucun ajustement."
          />
        </div>
        <div className="actions" style={{ marginTop: 12 }}>
          <button
            className="primary"
            disabled={action.pending || !resolution}
            onClick={() =>
              void action.run(
                () =>
                  api(`/v1/admin/tickets/${ticketId}/status`, {
                    method: 'POST',
                    body: { status: 'resolved', resolution },
                  }),
                'Litige résolu.',
              )
            }
          >
            Marquer résolu
          </button>
          <button
            disabled={action.pending}
            onClick={() =>
              void action.run(
                () =>
                  api(`/v1/admin/tickets/${ticketId}/status`, {
                    method: 'POST',
                    body: { status: 'waiting_user' },
                  }),
                'En attente du déclarant.',
              )
            }
          >
            En attente du déclarant
          </button>
        </div>
      </Card>
    </div>
  );
}
