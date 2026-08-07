import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/**
 * Chargement de données.
 *
 * Volontairement minimal — pas de bibliothèque de cache : l'administration
 * affiche des états d'exploitation qui doivent être frais, et chaque écran
 * recharge ce qu'il montre. `reload` sert après chaque action.
 */
export function useApi<T>(path: string | null, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(path !== null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (path === null) {
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    try {
      const result = await api<T>(path);
      // Une réponse arrivée après une requête plus récente est ignorée.
      if (id === requestId.current) setData(result);
    } catch (err) {
      if (id === requestId.current) setError(err);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, ...deps]);

  return { data, error, loading, reload: load };
}

/** Exécute une action puis rafraîchit la vue, en exposant erreur et état. */
export function useAction(onDone?: () => void | Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<unknown>, successMessage?: string) => {
      setPending(true);
      setError(null);
      setMessage(null);
      try {
        await fn();
        if (successMessage) setMessage(successMessage);
        await onDone?.();
        return true;
      } catch (err) {
        setError(err);
        return false;
      } finally {
        setPending(false);
      }
    },
    [onDone],
  );

  return { run, pending, error, message };
}

/** Période d'analyse par défaut : les trente derniers jours. */
export function useDefaultPeriod(days = 30) {
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const query = `from=${new Date(`${from}T00:00:00Z`).toISOString()}&to=${new Date(
    `${to}T23:59:59Z`,
  ).toISOString()}`;

  return { from, to, setFrom, setTo, query };
}
