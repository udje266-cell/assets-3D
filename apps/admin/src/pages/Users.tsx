import { useState } from 'react';
import { api, formatDate } from '../api';
import { Badge, ErrorMessage, Loading, Table } from '../components/ui';
import { useAction, useApi } from '../hooks';

/** Gestion des clients — §14 : recherche, historique, suspension, assistance. */

interface User {
  id: string;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  rating_average: number;
  rides_count: number;
  suspended_at: string | null;
  suspension_reason: string | null;
  created_at: string;
}

export function Users() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');

  const query = new URLSearchParams({ limit: '50' });
  if (applied) query.set('search', applied);

  const { data, error, loading, reload } = useApi<{ items: User[] }>(
    `/v1/admin/users?${query.toString()}`,
    [applied],
  );
  const action = useAction(reload);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Clients</h1>
          <p>Comptes, historique et suspensions.</p>
        </div>
      </div>

      <div className="toolbar">
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

      <ErrorMessage error={action.error ?? error} />
      {action.message ? <div className="alert alert-success">{action.message}</div> : null}

      {loading && !data ? (
        <Loading />
      ) : (
        <Table
          headers={['Nom', 'Téléphone', 'Courses', 'Note', 'État', 'Inscrit le', 'Action']}
          empty={data?.items.length === 0}
        >
          {data?.items.map((user) => (
            <tr key={user.id}>
              <td>{[user.first_name, user.last_name].filter(Boolean).join(' ') || '—'}</td>
              <td className="mono">{user.phone}</td>
              <td className="num">{user.rides_count}</td>
              <td className="num">
                {Number(user.rating_average) > 0 ? `${Number(user.rating_average).toFixed(2)} ★` : '—'}
              </td>
              <td>
                {user.suspended_at ? (
                  <Badge tone="critical">Suspendu</Badge>
                ) : (
                  <Badge tone="good">Actif</Badge>
                )}
              </td>
              <td>{formatDate(user.created_at)}</td>
              <td>
                {user.suspended_at ? (
                  <button
                    disabled={action.pending}
                    onClick={() =>
                      void action.run(
                        () =>
                          api(`/v1/admin/users/${user.id}/suspension`, {
                            method: 'POST',
                            body: { suspended: false },
                          }),
                        'Compte rétabli.',
                      )
                    }
                  >
                    Rétablir
                  </button>
                ) : (
                  <button
                    className="danger"
                    disabled={action.pending}
                    onClick={() => {
                      const reason = window.prompt('Motif de la suspension ?');
                      if (!reason) return;
                      void action.run(
                        () =>
                          api(`/v1/admin/users/${user.id}/suspension`, {
                            method: 'POST',
                            body: { suspended: true, reason },
                          }),
                        'Compte suspendu.',
                      );
                    }}
                  >
                    Suspendre
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
