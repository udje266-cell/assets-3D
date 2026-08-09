/**
 * Client HTTP de l'administration.
 *
 * Le jeton d'accès est court ; le jeton de rafraîchissement est conservé en
 * `localStorage` et la rotation est déclenchée automatiquement sur une réponse
 * 401, de sorte qu'une session ouverte ne se coupe pas au bout de quinze
 * minutes de travail.
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api';
const ACCESS_KEY = 'mobilite.admin.access';
const REFRESH_KEY = 'mobilite.admin.refresh';
const PROFILE_KEY = 'mobilite.admin.profile';

export interface AdminProfile {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const session = {
  get accessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  get profile(): AdminProfile | null {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as AdminProfile) : null;
  },
  save(access: string, refresh: string, profile?: AdminProfile) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(PROFILE_KEY);
  },
};

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function raw<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const payload = (await parse(response)) as { error?: { code: string; message: string; details?: unknown } };

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'unknown',
      payload?.error?.message ?? `Erreur ${response.status}`,
      payload?.error?.details,
    );
  }

  return payload as T;
}

/** Une seule rotation à la fois : les appels concurrents partagent la promesse. */
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const token = session.refreshToken;
  if (!token) return false;

  refreshing ??= raw<{ accessToken: string; refreshToken: string }>('/v1/auth/refresh', {
    method: 'POST',
    body: { refreshToken: token },
  })
    .then((result) => {
      session.save(result.accessToken, result.refreshToken);
      return true;
    })
    .catch(() => {
      session.clear();
      return false;
    })
    .finally(() => {
      refreshing = null;
    });

  return refreshing;
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  try {
    return await raw<T>(path, { ...options, token: session.accessToken });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401 && (await refreshSession())) {
      return raw<T>(path, { ...options, token: session.accessToken });
    }
    throw error;
  }
}

export async function login(email: string, password: string): Promise<AdminProfile> {
  const result = await raw<{
    accessToken: string;
    refreshToken: string;
    account: AdminProfile;
  }>('/v1/admin/auth/login', { method: 'POST', body: { email, password } });

  session.save(result.accessToken, result.refreshToken, result.account);
  return result.account;
}

export function logout(): void {
  const token = session.accessToken;
  session.clear();
  if (token) {
    void raw('/v1/auth/logout', { method: 'POST', token }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Formatage
// ---------------------------------------------------------------------------

export function formatAmount(amount: number | null | undefined, currency = 'XOF'): string {
  if (amount === null || amount === undefined) return '—';
  const symbol = currency === 'XOF' ? 'FCFA' : currency;
  return `${new Intl.NumberFormat('fr-FR').format(amount)} ${symbol}`;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} %`;
}

/** Libellés d'états de course (§6), partagés par toutes les vues. */
export const RIDE_STATUS_LABELS: Record<string, string> = {
  requested: 'Demande créée',
  searching: 'Recherche chauffeur',
  driver_assigned: 'Chauffeur trouvé',
  driver_en_route: 'Chauffeur en route',
  driver_arrived: 'Chauffeur arrivé',
  in_progress: 'Course en cours',
  completed: 'Terminée',
  awaiting_payment: 'En attente de paiement',
  paid: 'Payée',
  rated: 'Évaluée',
  cancelled: 'Annulée',
  expired: 'Expirée',
};

export const DRIVER_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  approved: 'Validé',
  rejected: 'Refusé',
  suspended: 'Suspendu',
};
