import { useState, type FormEvent } from 'react';
import { api, formatAmount, formatDate } from '../api';
import { Badge, Card, ErrorMessage, Loading, Table } from '../components/ui';
import { useAction, useApi } from '../hooks';

/** Promotions — §13 : montant fixe ou pourcentage, quotas, validité, plafond. */

interface Promotion {
  id: string;
  code: string;
  label: string;
  type: 'percentage' | 'fixed';
  value: number;
  max_discount: number | null;
  min_fare: number;
  max_redemptions: number | null;
  max_per_user: number;
  redemptions_count: number;
  first_ride_only: boolean;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
}

export function Promotions() {
  const { data, error, loading, reload } = useApi<{ items: Promotion[] }>('/v1/admin/promotions');
  const action = useAction(reload);

  const [form, setForm] = useState({
    code: '',
    label: '',
    type: 'percentage' as 'percentage' | 'fixed',
    value: 20,
    maxDiscount: 1000,
    minFare: 0,
    maxRedemptions: '',
    maxPerUser: 1,
    firstRideOnly: false,
    endsAt: '',
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    void action.run(
      () =>
        api('/v1/admin/promotions', {
          method: 'POST',
          body: {
            code: form.code,
            label: form.label,
            type: form.type,
            // Un pourcentage est transmis en points de base : 20 % → 2000.
            value: form.type === 'percentage' ? Math.round(form.value * 100) : form.value,
            ...(form.maxDiscount > 0 ? { maxDiscount: form.maxDiscount } : {}),
            minFare: form.minFare,
            ...(form.maxRedemptions ? { maxRedemptions: Number(form.maxRedemptions) } : {}),
            maxPerUser: form.maxPerUser,
            firstRideOnly: form.firstRideOnly,
            ...(form.endsAt ? { endsAt: new Date(`${form.endsAt}T23:59:59Z`).toISOString() } : {}),
          },
        }),
      'Code promotionnel créé.',
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Promotions</h1>
          <p>Codes promotionnels, quotas d’utilisation et périodes de validité.</p>
        </div>
      </div>

      <ErrorMessage error={action.error ?? error} />
      {action.message ? <div className="alert alert-success">{action.message}</div> : null}

      <Card title="Codes existants">
        {loading && !data ? (
          <Loading />
        ) : (
          <Table
            headers={[
              'Code',
              'Libellé',
              'Réduction',
              'Plafond',
              'Utilisations',
              'Par client',
              '1re course',
              'Fin',
              'État',
              'Action',
            ]}
            empty={data?.items.length === 0}
          >
            {data?.items.map((promotion) => (
              <tr key={promotion.id}>
                <td className="mono">{promotion.code}</td>
                <td>{promotion.label}</td>
                <td className="num">
                  {promotion.type === 'percentage'
                    ? `${promotion.value / 100} %`
                    : formatAmount(promotion.value)}
                </td>
                <td className="num">
                  {promotion.max_discount ? formatAmount(promotion.max_discount) : '—'}
                </td>
                <td className="num">
                  {promotion.redemptions_count}
                  {promotion.max_redemptions ? ` / ${promotion.max_redemptions}` : ''}
                </td>
                <td className="num">{promotion.max_per_user}</td>
                <td>{promotion.first_ride_only ? 'Oui' : 'Non'}</td>
                <td>{promotion.ends_at ? formatDate(promotion.ends_at) : 'Sans limite'}</td>
                <td>
                  {promotion.is_active ? (
                    <Badge tone="good">Actif</Badge>
                  ) : (
                    <Badge tone="critical">Désactivé</Badge>
                  )}
                </td>
                <td>
                  <button
                    disabled={action.pending}
                    onClick={() =>
                      void action.run(
                        () =>
                          api(`/v1/admin/promotions/${promotion.id}`, {
                            method: 'PATCH',
                            body: { isActive: !promotion.is_active },
                          }),
                        promotion.is_active ? 'Code désactivé.' : 'Code réactivé.',
                      )
                    }
                  >
                    {promotion.is_active ? 'Désactiver' : 'Réactiver'}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Créer un code promotionnel">
        <form onSubmit={submit}>
          <div className="grid grid-2">
            <div>
              <div className="field">
                <label htmlFor="code">Code</label>
                <input
                  id="code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  placeholder="BIENVENUE"
                  required
                  minLength={3}
                />
              </div>
              <div className="field">
                <label htmlFor="label">Libellé</label>
                <input
                  id="label"
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="Bienvenue sur la plateforme"
                  required
                  minLength={3}
                />
              </div>
              <div className="field">
                <label htmlFor="type">Type de réduction</label>
                <select
                  id="type"
                  value={form.type}
                  onChange={(e) =>
                    setForm({ ...form, type: e.target.value as 'percentage' | 'fixed' })
                  }
                >
                  <option value="percentage">Pourcentage</option>
                  <option value="fixed">Montant fixe</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="value">
                  {form.type === 'percentage' ? 'Réduction (%)' : 'Réduction (FCFA)'}
                </label>
                <input
                  id="value"
                  type="number"
                  min={1}
                  max={form.type === 'percentage' ? 100 : undefined}
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: Number(e.target.value) })}
                  required
                />
              </div>
            </div>

            <div>
              <div className="field">
                <label htmlFor="maxDiscount">Plafond de réduction (0 = aucun)</label>
                <input
                  id="maxDiscount"
                  type="number"
                  min={0}
                  value={form.maxDiscount}
                  onChange={(e) => setForm({ ...form, maxDiscount: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="minFare">Montant minimum de course</label>
                <input
                  id="minFare"
                  type="number"
                  min={0}
                  value={form.minFare}
                  onChange={(e) => setForm({ ...form, minFare: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="maxRedemptions">Nombre total d’utilisations (vide = illimité)</label>
                <input
                  id="maxRedemptions"
                  type="number"
                  min={1}
                  value={form.maxRedemptions}
                  onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="maxPerUser">Utilisations par client</label>
                <input
                  id="maxPerUser"
                  type="number"
                  min={1}
                  value={form.maxPerUser}
                  onChange={(e) => setForm({ ...form, maxPerUser: Number(e.target.value) })}
                />
              </div>
              <div className="field">
                <label htmlFor="endsAt">Date de fin (optionnelle)</label>
                <input
                  id="endsAt"
                  type="date"
                  value={form.endsAt}
                  onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                />
              </div>
              <div className="field">
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={form.firstRideOnly}
                    onChange={(e) => setForm({ ...form, firstRideOnly: e.target.checked })}
                  />
                  Réservé à la première course
                </label>
              </div>
            </div>
          </div>

          <button type="submit" className="primary" disabled={action.pending} style={{ marginTop: 8 }}>
            {action.pending ? 'Création…' : 'Créer le code'}
          </button>
        </form>
      </Card>
    </>
  );
}
