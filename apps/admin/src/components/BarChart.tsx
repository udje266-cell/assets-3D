import { useId, useState } from 'react';

/**
 * Histogramme à série unique.
 *
 * Une seule série par graphique, jamais deux échelles sur un même cadre : deux
 * mesures d'ordres de grandeur différents donnent deux graphiques côte à côte.
 * Le titre nomme la série, ce qui rend toute légende superflue ; seule la valeur
 * maximale porte une étiquette directe, pour éviter le bruit d'un nombre sur
 * chaque barre. La couleur provient de la palette catégorielle validée.
 */

export interface BarDatum {
  label: string;
  value: number;
  /** Libellé long affiché dans l'infobulle. */
  caption?: string;
}

export interface BarChartProps {
  data: readonly BarDatum[];
  /** Formate la valeur pour l'infobulle et l'étiquette directe. */
  format?: (value: number) => string;
  color?: string;
  height?: number;
  emptyMessage?: string;
}

const PADDING = { top: 20, right: 8, bottom: 26, left: 52 };

export function BarChart({
  data,
  format = (v) => new Intl.NumberFormat('fr-FR').format(v),
  color = 'var(--series-1)',
  height = 220,
  emptyMessage = 'Aucune donnée sur la période.',
}: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const clipId = useId();

  if (data.length === 0) {
    return <div className="chart-empty">{emptyMessage}</div>;
  }

  const width = 720;
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  // Graduation lisible : on arrondit le plafond à un ordre de grandeur propre.
  const step = niceStep(maxValue / 3);
  const ceiling = Math.max(step * Math.ceil(maxValue / step), step);

  const slot = plotWidth / data.length;
  // 2 px de surface entre deux barres voisines, barres fines.
  const barWidth = Math.max(2, Math.min(slot - 2, 36));

  const ticks = [];
  for (let value = 0; value <= ceiling; value += step) ticks.push(value);

  const maxIndex = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? 0) ? i : best), 0);
  const hoveredDatum = hovered !== null ? data[hovered] : undefined;

  // Étiquettes d'abscisse allégées quand les barres sont nombreuses.
  const labelEvery = Math.ceil(data.length / 12);

  return (
    <div className="chart" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        // Largeur fluide : fixer aussi la hauteur en pixels ferait cadrer le
        // dessin au centre en laissant des marges vides de part et d'autre.
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label={`Histogramme de ${data.length} valeurs, maximum ${format(maxValue)}`}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          {/* Coins arrondis uniquement en haut de barre, base ancrée à l'axe. */}
          <clipPath id={clipId}>
            <rect x="0" y="0" width={width} height={PADDING.top + plotHeight} />
          </clipPath>
        </defs>

        {/* Grille et graduations, volontairement discrètes */}
        {ticks.map((tick) => {
          const y = PADDING.top + plotHeight - (tick / ceiling) * plotHeight;
          return (
            <g key={tick}>
              <line
                x1={PADDING.left}
                x2={width - PADDING.right}
                y1={y}
                y2={y}
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text
                x={PADDING.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--text-muted)"
              >
                {compact(tick)}
              </text>
            </g>
          );
        })}

        <g clipPath={`url(#${clipId})`}>
          {data.map((datum, index) => {
            const barHeight = (datum.value / ceiling) * plotHeight;
            const x = PADDING.left + index * slot + (slot - barWidth) / 2;
            const y = PADDING.top + plotHeight - barHeight;
            const active = hovered === index;

            return (
              <g key={`${datum.label}-${index}`}>
                {/* Zone de survol plus large que la barre elle-même */}
                <rect
                  x={PADDING.left + index * slot}
                  y={PADDING.top}
                  width={slot}
                  height={plotHeight}
                  fill="transparent"
                  onMouseEnter={() => setHovered(index)}
                />
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(barHeight, datum.value > 0 ? 2 : 0)}
                  rx={4}
                  fill={color}
                  opacity={hovered === null || active ? 1 : 0.55}
                  pointerEvents="none"
                />
              </g>
            );
          })}
        </g>

        {/* Étiquette directe sur la seule valeur maximale */}
        {data[maxIndex] && data[maxIndex].value > 0 && (
          <text
            x={PADDING.left + maxIndex * slot + slot / 2}
            y={PADDING.top + plotHeight - (data[maxIndex].value / ceiling) * plotHeight - 6}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill="var(--text-secondary)"
          >
            {format(data[maxIndex].value)}
          </text>
        )}

        <line
          x1={PADDING.left}
          x2={width - PADDING.right}
          y1={PADDING.top + plotHeight}
          y2={PADDING.top + plotHeight}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />

        {data.map((datum, index) =>
          index % labelEvery === 0 ? (
            <text
              key={`label-${datum.label}-${index}`}
              x={PADDING.left + index * slot + slot / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {datum.label}
            </text>
          ) : null,
        )}
      </svg>

      {hoveredDatum && (
        <div
          className="chart-tooltip"
          style={{
            left: `${((PADDING.left + (hovered ?? 0) * slot + slot / 2) / width) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -4px)',
          }}
        >
          {hoveredDatum.caption ?? hoveredDatum.label}
          <strong>{format(hoveredDatum.value)}</strong>
        </div>
      )}
    </div>
  );
}

/** Pas de graduation « rond » : 1, 2, 5 × puissance de dix. */
function niceStep(rough: number): number {
  if (rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)} M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)} k`;
  return String(value);
}
