export async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { credentials: 'include', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({ error: `Le serveur n'est pas disponible (HTTP ${response.status}).` }));
  if (!response.ok) throw new Error(data.error || 'Une erreur est survenue.');
  if (data.credentials && typeof window !== 'undefined') window.alert(`Compte créé\nUtilisateur : ${data.credentials.username}\nMot de passe : ${data.credentials.password}`);
  return data;
}
export const login = (username, password) => api('auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const logout = () => api('auth/logout', { method: 'POST' });
export const updateCooperative = (id, body) => api(`cooperative/${id}`, { method: 'PUT', body: JSON.stringify(body) });
export const cooperativeDetails = id => api(`cooperative/${id}/details`);
export const transportTypes = () => api('transport-types');
export const createCooperative = body => api('cooperative', { method: 'POST', body: JSON.stringify(body) });
export const bulkCreateCooperatives = rows => api('cooperative/bulk', { method: 'POST', body: JSON.stringify({ rows }) });
export const createCooperativeAccount = (id, body) => api(`cooperative/${id}/account`, { method: 'POST', body: JSON.stringify(body) });
export const createCooperativeWithAccount = body => api('cooperative/with-account', { method: 'POST', body: JSON.stringify(body) });
export const importLineCooperatives = rows => api('ligne/cooperatives/import', { method: 'POST', body: JSON.stringify({ rows }) });
export const uploadCooperativeFile = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = async () => { try { resolve(await api('cooperative/upload', { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type, base64: reader.result }) })); } catch (error) { reject(error); } }; reader.onerror = () => reject(new Error('Lecture du fichier impossible.')); reader.readAsDataURL(file); });
