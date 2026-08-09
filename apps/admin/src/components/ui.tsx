import type { ReactNode } from 'react';

/** Éléments d'interface partagés par les écrans d'administration. */

export function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="tile">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {hint ? <div className="tile-hint">{hint}</div> : null}
    </div>
  );
}

/**
 * Pastille d'état. Le ton n'est jamais porté par la seule couleur : le libellé
 * est toujours présent, condition d'accessibilité pour la vision des couleurs.
 */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export type Tone = 'neutral' | 'good' | 'warning' | 'critical';

export function rideTone(status: string): Tone {
  if (['paid', 'rated', 'completed'].includes(status)) return 'good';
  if (['cancelled', 'expired'].includes(status)) return 'critical';
  if (['awaiting_payment', 'searching', 'requested'].includes(status)) return 'warning';
  return 'neutral';
}

export function driverTone(status: string): Tone {
  if (status === 'approved') return 'good';
  if (status === 'pending') return 'warning';
  return 'critical';
}

export function paymentTone(status: string): Tone {
  if (status === 'succeeded') return 'good';
  if (['failed', 'cancelled'].includes(status)) return 'critical';
  if (status === 'refunded') return 'warning';
  return 'neutral';
}

export function Card({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-title">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Table({
  headers,
  children,
  empty,
}: {
  headers: readonly string[];
  children: ReactNode;
  empty?: boolean;
}) {
  return (
    <div className="table-wrap">
      {empty ? (
        <div className="empty">Aucun résultat.</div>
      ) : (
        <table>
          <thead>
            <tr>
              {headers.map((header) => (
                <th key={header}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      )}
    </div>
  );
}

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <div className="alert alert-error">{message}</div>;
}

export function Loading() {
  return <div className="empty">Chargement…</div>;
}

export function Definition({ items }: { items: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="definition">
      {items.map(([term, value]) => (
        <div key={term} style={{ display: 'contents' }}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
