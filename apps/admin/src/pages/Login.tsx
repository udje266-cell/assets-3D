import { useState, type FormEvent } from 'react';
import { login, type AdminProfile } from '../api';
import { ErrorMessage } from '../components/ui';

export function Login({ onSuccess }: { onSuccess: (profile: AdminProfile) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      onSuccess(await login(email, password));
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-band">
          <img src="/urigo.png" alt="URIGO" className="brand-logo" />
        </div>
        <h1>Administration</h1>
        <p>URIGO — plateforme de mobilité et de réservation de transport</p>

        <ErrorMessage error={error} />

        <div className="field">
          <label htmlFor="email">Adresse e-mail</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Mot de passe</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <button type="submit" className="primary" disabled={pending}>
          {pending ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
