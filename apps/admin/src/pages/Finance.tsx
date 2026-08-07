import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatAmount, formatDate } from '../api';
import { Badge, Card, ErrorMessage, Loading, Table, paymentTone } from '../components/ui';
import { useAction, useApi } from '../hooks';
import { paymentLabel } from './Rides';

/** Paiements, remboursements et retraits — §9, §10, §15. */

interface Payment {
  id: string;
  ride_id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  platform_amount: number;
  driver_amount: number;
  refunded_amount: number;
  provider: string | null;
  provider_reference: string | null;
  created_at: string;
}

interface Withdrawal {
  id: string;
  driver_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  destination: string;
  created_at: string;
}

export function Finance() {
  const [tab, setTab] = useState<'payments' | 'withdrawals'>('payments');

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Finances</h1>
          <p>Transactions, remboursements et retraits des chauffeurs.</p>
        </div>
        <div className="actions">
          <button
            className={tab === 'payments' ? 'primary' : ''}
            onClick={() => setTab('payments')}
          >
            Paiements
          </button>
          <button
            className={tab === 'withdrawals' ? 'primary' : ''}
            onClick={() => setTab('withdrawals')}
          >
            Retraits
          </button>
        </div>
      </div>

      {tab === 'payments' ? <Payments /> : <Withdrawals />}
    </>
  );
}

function Payments() {
  const [status, setStatus] = useState('');
  const query = new URLSearchParams({ limit: '50' });
  if (status) query.set('status', status);

  const { data, error, loading, reload } = useApi<{ items: Payment[] }>(
    `/v1/admin/payments?${query.toString()}`,
    [status],
  );
  const action = useAction(reload);

  function refund(payment: Payment) {
    const raw = window.prompt(
      `Montant à rembourser (maximum ${payment.amount - payment.refunded_amount}) :`,
    );
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const reason = window.prompt('Motif du remboursement ?');
    if (!reason) return;

    const chargeToDriver = window.confirm(
      'Imputer ce remboursement au chauffeur ?\n\n' +
        'OK : le montant est débité de son portefeuille.\n' +
        'Annuler : le remboursement est à la charge de la plateforme.',
    );

    void action.run(
      () =>
        api(`/v1/admin/payments/${payment.id}/refund`, {
          method: 'POST',
          body: { amount, reason, chargeToDriver },
        }),
      'Remboursement enregistré.',
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="status">Statut</label>
          <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            <option value="succeeded">Abouti</option>
            <option value="processing">En cours</option>
            <option value="failed">Échoué</option>
            <option value="refunded">Remboursé</option>
          </select>
        </div>
      </div>

      <ErrorMessage error={action.error ?? error} />
      {action.message ? <div className="alert alert-success">{action.message}</div> : null}

      {loading && !data ? (
        <Loading />
      ) : (
        <Table
          headers={[
            'Date',
            'Montant',
            'Moyen',
            'Statut',
            'Commission',
            'Part chauffeur',
            'Remboursé',
            'Prestataire',
            'Action',
          ]}
          empty={data?.items.length === 0}
        >
          {data?.items.map((payment) => (
            <tr key={payment.id}>
              <td>{formatDate(payment.created_at)}</td>
              <td className="num">{formatAmount(payment.amount, payment.currency)}</td>
              <td>{paymentLabel(payment.method)}</td>
              <td>
                <Badge tone={paymentTone(payment.status)}>{payment.status}</Badge>
              </td>
              <td className="num">{formatAmount(payment.platform_amount, payment.currency)}</td>
              <td className="num">{formatAmount(payment.driver_amount, payment.currency)}</td>
              <td className="num">
                {payment.refunded_amount > 0
                  ? formatAmount(payment.refunded_amount, payment.currency)
                  : '—'}
              </td>
              <td className="mono">{payment.provider_reference ?? '—'}</td>
              <td>
                <div className="actions">
                  <Link to={`/courses/${payment.ride_id}`} className="button">
                    Course
                  </Link>
                  <button
                    disabled={
                      action.pending ||
                      payment.status !== 'succeeded' ||
                      payment.refunded_amount >= payment.amount
                    }
                    onClick={() => refund(payment)}
                  >
                    Rembourser
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function Withdrawals() {
  const [status, setStatus] = useState('requested');
  const query = new URLSearchParams({ limit: '50' });
  if (status) query.set('status', status);

  const { data, error, loading, reload } = useApi<{ items: Withdrawal[] }>(
    `/v1/admin/withdrawals?${query.toString()}`,
    [status],
  );
  const action = useAction(reload);

  function updateStatus(withdrawal: Withdrawal, next: string, needsReason = false) {
    let reason: string | null = null;
    if (needsReason) {
      reason = window.prompt('Motif ?');
      if (!reason) return;
    }

    let reference: string | null = null;
    if (next === 'paid') {
      reference = window.prompt('Référence du virement (facultative) :');
    }

    void action.run(
      () =>
        api(`/v1/admin/withdrawals/${withdrawal.id}/status`, {
          method: 'POST',
          body: {
            status: next,
            ...(reason ? { reason } : {}),
            ...(reference ? { reference } : {}),
          },
        }),
      'Retrait mis à jour.',
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="field">
          <label htmlFor="wstatus">Statut</label>
          <select id="wstatus" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            <option value="requested">Demandé</option>
            <option value="approved">Approuvé</option>
            <option value="processing">En traitement</option>
            <option value="paid">Payé</option>
            <option value="rejected">Refusé</option>
            <option value="failed">Échoué</option>
          </select>
        </div>
      </div>

      <ErrorMessage error={action.error ?? error} />
      {action.message ? <div className="alert alert-success">{action.message}</div> : null}

      <Card>
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
          Le montant est débité du portefeuille dès la demande. Un refus ou un échec le restitue
          automatiquement au solde du chauffeur.
        </p>
      </Card>

      {loading && !data ? (
        <Loading />
      ) : (
        <Table
          headers={['Date', 'Chauffeur', 'Montant', 'Moyen', 'Destination', 'Statut', 'Actions']}
          empty={data?.items.length === 0}
        >
          {data?.items.map((withdrawal) => (
            <tr key={withdrawal.id}>
              <td>{formatDate(withdrawal.created_at)}</td>
              <td>
                <Link to={`/chauffeurs/${withdrawal.driver_id}`}>
                  {withdrawal.first_name} {withdrawal.last_name}
                </Link>
              </td>
              <td className="num">{formatAmount(withdrawal.amount, withdrawal.currency)}</td>
              <td>{withdrawal.method === 'mobile_money' ? 'Mobile money' : 'Virement'}</td>
              <td className="mono">{withdrawal.destination}</td>
              <td>
                <Badge
                  tone={
                    withdrawal.status === 'paid'
                      ? 'good'
                      : ['rejected', 'failed'].includes(withdrawal.status)
                        ? 'critical'
                        : 'warning'
                  }
                >
                  {withdrawal.status}
                </Badge>
              </td>
              <td>
                <div className="actions">
                  <button
                    disabled={action.pending || withdrawal.status !== 'requested'}
                    onClick={() => updateStatus(withdrawal, 'approved')}
                  >
                    Approuver
                  </button>
                  <button
                    className="primary"
                    disabled={
                      action.pending || !['requested', 'approved', 'processing'].includes(withdrawal.status)
                    }
                    onClick={() => updateStatus(withdrawal, 'paid')}
                  >
                    Marquer payé
                  </button>
                  <button
                    className="danger"
                    disabled={
                      action.pending || ['paid', 'rejected', 'failed'].includes(withdrawal.status)
                    }
                    onClick={() => updateStatus(withdrawal, 'rejected', true)}
                  >
                    Refuser
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
