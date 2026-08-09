import { useState, type FormEvent } from 'react';
import { api, formatAmount, formatDate } from '../api';
import { Badge, Card, ErrorMessage, Loading, Table } from '../components/ui';
import { useAction, useApi } from '../hooks';

/**
 * Tarification — §7.
 *
 * « Les tarifs doivent être configurables depuis l'administration sans
 *   nécessiter de mise à jour de l'application. »
 *
 * Publier une grille clôt la précédente sans l'effacer : les courses déjà
 * facturées conservent leurs montants et restent justifiables.
 */

interface PricingRule {
  id: string;
  category_label: string;
  category_code: string;
  vehicle_category_id: string;
  zone_code: string;
  base_fare: number;
  per_km: number;
  per_minute: number;
  minimum_fare: number;
  booking_fee: number;
  cancellation_fee: number;
  surge_bps: number;
  commission_bps: number;
  round_to_nearest: number;
  currency: string;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
}

interface Category {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
}

export function Pricing() {
  const rules = useApi<{ items: PricingRule[] }>('/v1/admin/pricing-rules');
  const categories = useApi<{ items: Category[] }>('/v1/admin/vehicle-categories');
  const action = useAction(rules.reload);

  const [form, setForm] = useState({
    vehicleCategoryId: '',
    zoneCode: 'default',
    baseFare: 500,
    perKm: 250,
    perMinute: 25,
    minimumFare: 1000,
    bookingFee: 100,
    cancellationFee: 500,
    surgeBps: 10000,
    commissionBps: 2000,
    roundToNearest: 5,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.vehicleCategoryId) return;
    void action.run(
      () => api('/v1/admin/pricing-rules', { method: 'POST', body: form }),
      'Nouvelle grille publiée. L’ancienne reste consultable pour l’historique.',
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Tarification</h1>
          <p>
            Grilles par catégorie de véhicule. Une modification prend effet immédiatement, sans
            mise à jour des applications.
          </p>
        </div>
      </div>

      <ErrorMessage error={action.error ?? rules.error} />
      {action.message ? <div className="alert alert-success">{action.message}</div> : null}

      <Card title="Grilles en vigueur et historique">
        {rules.loading && !rules.data ? (
          <Loading />
        ) : (
          <Table
            headers={[
              'Catégorie',
              'Zone',
              'Base',
              'Par km',
              'Par min',
              'Minimum',
              'Réservation',
              'Annulation',
              'Commission',
              'État',
              'En vigueur depuis',
            ]}
            empty={rules.data?.items.length === 0}
          >
            {rules.data?.items.map((rule) => (
              <tr key={rule.id}>
                <td>{rule.category_label}</td>
                <td>{rule.zone_code}</td>
                <td className="num">{formatAmount(rule.base_fare, rule.currency)}</td>
                <td className="num">{formatAmount(rule.per_km, rule.currency)}</td>
                <td className="num">{formatAmount(rule.per_minute, rule.currency)}</td>
                <td className="num">{formatAmount(rule.minimum_fare, rule.currency)}</td>
                <td className="num">{formatAmount(rule.booking_fee, rule.currency)}</td>
                <td className="num">{formatAmount(rule.cancellation_fee, rule.currency)}</td>
                <td className="num">{rule.commission_bps / 100} %</td>
                <td>
                  {rule.is_active ? (
                    <Badge tone="good">En vigueur</Badge>
                  ) : (
                    <Badge>Close le {formatDate(rule.effective_to)}</Badge>
                  )}
                </td>
                <td>{formatDate(rule.effective_from)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Publier une nouvelle grille">
        <form onSubmit={submit}>
          <div className="grid grid-2">
            <div>
              <div className="field">
                <label htmlFor="category">Catégorie de véhicule</label>
                <select
                  id="category"
                  value={form.vehicleCategoryId}
                  onChange={(e) => setForm({ ...form, vehicleCategoryId: e.target.value })}
                  required
                >
                  <option value="">Choisir…</option>
                  {categories.data?.items.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>

              {(
                [
                  ['baseFare', 'Tarif de base'],
                  ['perKm', 'Tarif au kilomètre'],
                  ['perMinute', 'Tarif à la minute'],
                  ['minimumFare', 'Tarif minimum'],
                ] as const
              ).map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    type="number"
                    min={0}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                    required
                  />
                </div>
              ))}
            </div>

            <div>
              {(
                [
                  ['bookingFee', 'Frais de réservation'],
                  ['cancellationFee', 'Frais d’annulation'],
                  ['roundToNearest', 'Arrondi du prix (multiple de)'],
                ] as const
              ).map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    type="number"
                    min={key === 'roundToNearest' ? 1 : 0}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
                    required
                  />
                </div>
              ))}

              <div className="field">
                <label htmlFor="commission">Commission plateforme (%)</label>
                <input
                  id="commission"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={form.commissionBps / 100}
                  onChange={(e) =>
                    setForm({ ...form, commissionBps: Math.round(Number(e.target.value) * 100) })
                  }
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="surge">Multiplicateur de tarification dynamique</label>
                <input
                  id="surge"
                  type="number"
                  min={1}
                  max={5}
                  step={0.05}
                  value={form.surgeBps / 10000}
                  onChange={(e) =>
                    setForm({ ...form, surgeBps: Math.round(Number(e.target.value) * 10000) })
                  }
                  required
                />
              </div>
            </div>
          </div>

          <button type="submit" className="primary" disabled={action.pending} style={{ marginTop: 16 }}>
            {action.pending ? 'Publication…' : 'Publier la grille'}
          </button>
        </form>
      </Card>
    </>
  );
}
