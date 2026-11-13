import { useState } from 'react';
import { login } from '../services/api';

export default function Login({ onAuthenticated }) {
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  async function submit(event) { event.preventDefault(); setError(''); setLoading(true); try { const result = await login(username, password); onAuthenticated(result.user); } catch (err) { setError(err.message); } finally { setLoading(false); } }
  return <main className="login-page"><section className="login-card"><div className="login-logo">🚐</div><p className="eyebrow">CPP-Transport · ESPACE COOPÉRATIVE</p><h1>Coop Taxi-Brousse</h1><p className="muted">Connectez-vous pour accéder à votre espace de gestion.</p>{error && <div className="alert error">{error}</div>}<form onSubmit={submit}><label>Identifiant<input autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} required /></label><label>Mot de passe<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label><button disabled={loading}>{loading ? 'Connexion…' : 'Se connecter'}</button></form><p className="powered login-powered">Powered by<br/><strong>Cpp-system Madagascar</strong></p></section></main>;
}
