import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { logout, session, type AdminProfile } from './api';
import { Dashboard } from './pages/Dashboard';
import { DriverDetail, DriversList } from './pages/Drivers';
import { Finance } from './pages/Finance';
import { Login } from './pages/Login';
import { Pricing } from './pages/Pricing';
import { Promotions } from './pages/Promotions';
import { RideDetail, RidesList } from './pages/Rides';
import { Tickets } from './pages/Tickets';
import { Users } from './pages/Users';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Administration générale',
  operations: 'Exploitation',
  support: 'Assistance',
  finance: 'Finances',
  viewer: 'Consultation',
};

export function App() {
  const [profile, setProfile] = useState<AdminProfile | null>(() => session.profile);
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(
    () => (localStorage.getItem('mobilite.admin.theme') as 'light' | 'dark' | 'system') ?? 'system',
  );

  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', theme);
    }
    localStorage.setItem('mobilite.admin.theme', theme);
  }, [theme]);

  if (!profile || !session.accessToken) {
    return <Login onSuccess={setProfile} />;
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          <strong>Plateforme de mobilité</strong>
          <span>Administration</span>
        </div>

        <NavLink to="/" end className="nav-link">
          Tableau de bord
        </NavLink>

        <div className="nav-section">Exploitation</div>
        <NavLink to="/courses" className="nav-link">
          Courses
        </NavLink>
        <NavLink to="/chauffeurs" className="nav-link">
          Chauffeurs
        </NavLink>
        <NavLink to="/clients" className="nav-link">
          Clients
        </NavLink>
        <NavLink to="/litiges" className="nav-link">
          Litiges
        </NavLink>

        <div className="nav-section">Configuration</div>
        <NavLink to="/tarifs" className="nav-link">
          Tarification
        </NavLink>
        <NavLink to="/promotions" className="nav-link">
          Promotions
        </NavLink>
        <NavLink to="/finances" className="nav-link">
          Finances
        </NavLink>

        <div className="sidebar-footer">
          <div style={{ marginBottom: 8 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{profile.fullName}</strong>
            <br />
            {ROLE_LABELS[profile.role] ?? profile.role}
          </div>

          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="theme">Apparence</label>
            <select
              id="theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')}
            >
              <option value="system">Système</option>
              <option value="light">Clair</option>
              <option value="dark">Sombre</option>
            </select>
          </div>

          <button
            onClick={() => {
              logout();
              setProfile(null);
            }}
          >
            Se déconnecter
          </button>
        </div>
      </nav>

      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/courses" element={<RidesList />} />
          <Route path="/courses/:id" element={<RideDetail />} />
          <Route path="/chauffeurs" element={<DriversList />} />
          <Route path="/chauffeurs/:id" element={<DriverDetail />} />
          <Route path="/clients" element={<Users />} />
          <Route path="/litiges" element={<Tickets />} />
          <Route path="/tarifs" element={<Pricing />} />
          <Route path="/promotions" element={<Promotions />} />
          <Route path="/finances" element={<Finance />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
