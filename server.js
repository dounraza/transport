import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = process.env.PORT || 3000;
const parseBase = `${process.env.CPCTRV_PARSE_HOST}/${process.env.CPCTRV_PARSE_ROUTE}`;
const payParseBase = `${process.env.PAY_PARSE_HOST || ''}/${process.env.PAY_PARSE_ROUTE || 'endpoint'}`;
app.use(express.json({ limit: '15mb' }));
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000, encode: String };

async function parseRequest(pathname, options = {}) {
  const hasSession = Boolean(options.headers?.['X-Parse-Session-Token']);
  const useMaster = options.useMaster !== false;
  try {
    const response = await fetch(`${parseBase}/${pathname}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-Parse-Application-Id': process.env.CPCTRV_PARSE_APP_ID, ...(useMaster && !hasSession && process.env.CPCTRV_PARSE_MASTER_KEY ? { 'X-Parse-Master-Key': process.env.CPCTRV_PARSE_MASTER_KEY } : {}), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: data.error || 'Erreur Parse', code: response.status };
    return data;
  } catch (error) {
    console.error(`Parse indisponible (${parseBase}) :`, error.cause?.code || error.code || error.message);
    return { error: `Service Parse indisponible : ${error.cause?.code || error.code || error.message}`, code: 502 };
  }
}

async function parseWithSession(pathname, sessionToken, options = {}) {
  return parseRequest(pathname, { ...options, headers: { ...(options.headers || {}), 'X-Parse-Session-Token': sessionToken, 'X-Parse-REST-API-Key': process.env.CPCTRV_PARSE_REST_KEY } });
}

async function payParseRequest(pathname, options = {}) {
  const payRestKey = process.env.PAY_PARSE_API_REST_KEY || process.env.PAY_PARSE_REST_KEY;
  if (!process.env.PAY_PARSE_HOST || !process.env.PAY_PARSE_APP_ID || !payRestKey) return { error: 'Configuration PAY_PARSE_* manquante. Vérifiez PAY_PARSE_HOST, PAY_PARSE_APP_ID et PAY_PARSE_API_REST_KEY.', code: 500 };
  try {
    const response = await fetch(`${payParseBase}/${pathname}`, { ...options, headers: { 'Content-Type': 'application/json', 'X-Parse-Application-Id': process.env.PAY_PARSE_APP_ID, 'X-Parse-REST-API-Key': payRestKey, ...(process.env.PAY_PARSE_MASTER_KEY ? { 'X-Parse-Master-Key': process.env.PAY_PARSE_MASTER_KEY } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { error: data.error || 'Erreur Parse PAY', code: response.status };
    return data;
  } catch (error) {
    console.error(`Parse PAY indisponible (${payParseBase}) :`, error.cause?.code || error.code || error.message);
    return { error: `Service Parse PAY indisponible : ${error.cause?.code || error.code || error.message}`, code: 502 };
  }
}

// Coordonnées de secours pour les principales destinations malgaches. Elles
// permettent à la carte de fonctionner même si le service de géocodage est
// momentanément indisponible.
const madagascarPlaces = {
  antananarivo: [-18.8792, 47.5079], antsirabe: [-19.8659, 47.0333],
  toamasina: [-18.1492, 49.4023], tamatave: [-18.1492, 49.4023],
  mahajanga: [-15.7167, 46.3167], majunga: [-15.7167, 46.3167],
  fianarantsoa: [-21.4527, 47.0857], toliara: [-23.35, 43.6667], tulear: [-23.35, 43.6667],
  antsiranana: [-12.2765, 49.2917], diego: [-12.2765, 49.2917],
  morondava: [-20.2833, 44.2833], sambava: [-14.2667, 50.1667],
  manakara: [-22.1333, 48.0167], ambositra: [-20.5333, 47.25],
  antsohihy: [-14.8833, 47.9833], maroantsetra: [-15.4333, 49.7333]
};
const geocodeCache = new Map();

function destinationName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.name || value.description || value.city || value.ville || value.label || '').trim();
}

async function geocodeDestination(value) {
  const name = destinationName(value);
  if (!name) return null;
  const key = name.toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  const known = madagascarPlaces[key];
  if (known) {
    const result = { lat: known[0], lng: known[1], source: 'known' };
    geocodeCache.set(key, result);
    return result;
  }
  try {
    const query = new URLSearchParams({ q: `${name}, Madagascar`, format: 'jsonv2', limit: '1', countrycodes: 'mg' });
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, { headers: { 'User-Agent': 'CPP-Transport/1.0 (dashboard geocoding)' } });
    const results = await response.json();
    const first = results?.[0];
    const result = first ? { lat: Number(first.lat), lng: Number(first.lon), source: 'nominatim' } : null;
    if (result && Number.isFinite(result.lat) && Number.isFinite(result.lng)) geocodeCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}

function destinationKey(value) {
  return destinationName(value).toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function routeDistanceKm(depart, destination) {
  const from = madagascarPlaces[destinationKey(depart)]; const to = madagascarPlaces[destinationKey(destination)];
  if (!from || !to) return null;
  const [lat1, lon1] = from.map((value) => value * Math.PI / 180); const [lat2, lon2] = to.map((value) => value * Math.PI / 180); const dLat = lat2 - lat1; const dLon = lon2 - lon1; const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function vehicleAlreadyAssigned(date, vehicleNumber, excludeId = '') {
  if (!date || !vehicleNumber || vehicleNumber === 'Véhicule') return false;
  const result = await parseRequest('classes/CppPlanning?limit=1000');
  return (result.results || []).some((item) => String(item.objectId) !== String(excludeId) && String(item.date || '').slice(0, 10) === String(date).slice(0, 10) && String(item.vehiculeNumero || '').trim() === String(vehicleNumber).trim());
}

function addDestinationCoordinates(rows) {
  const names = [...new Set(rows.map((row) => destinationName(row.destination || row.arrivee || row.arrival || row.to || row.villeArrivee)).filter(Boolean))];
  const knownCoordinates = new Map();
  const unknownNames = [];
  for (const name of names) {
    const known = madagascarPlaces[destinationKey(name)];
    if (known) knownCoordinates.set(name, { lat: known[0], lng: known[1], source: 'known' });
    else if (!geocodeCache.has(destinationKey(name))) unknownNames.push(name);
  }
  // Ne bloque pas la réponse HTTP : les destinations inconnues seront mises
  // en cache pour la prochaine actualisation du tableau de bord.
  if (unknownNames.length) Promise.all(unknownNames.map((name) => geocodeDestination(name))).catch(() => {});
  return rows.map((row) => {
    const name = destinationName(row.destination || row.arrivee || row.arrival || row.to || row.villeArrivee);
    const coordinate = knownCoordinates.get(name) || geocodeCache.get(destinationKey(name));
    return coordinate ? { ...row, destinationCoordinates: coordinate } : row;
  });
}

function sessionTokenFrom(req) {
  const value = req.headers.cookie?.match(/(?:^|; )parse_session=([^;]+)/)?.[1];
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return value; }
}

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Identifiant et mot de passe obligatoires.' });
  const query = new URLSearchParams({ username, password });
  let result;
  try {
    result = await parseRequest(`login?${query.toString()}`, { useMaster: false, headers: { 'X-Parse-REST-API-Key': process.env.CPCTRV_PARSE_REST_KEY } });
  } catch (error) {
    return res.status(502).json({ error: 'Le service de connexion est indisponible.' });
  }
  if (result.error) return res.status(401).json(result);
  res.cookie('parse_session', result.sessionToken, cookieOptions);
  res.json({ user: { objectId: result.objectId, username: result.username, role: result.role || 'Membre' } });
});
app.get('/api/auth/me', async (req, res) => {
  const token = sessionTokenFrom(req);
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  const result = await parseWithSession('users/me', token);
  if (result.error) return res.status(401).json(result);
  res.json({ user: { objectId: result.objectId, username: result.username, role: result.role || 'Membre' } });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('parse_session', cookieOptions); res.json({ ok: true }); });

async function requireAuth(req, res, next) {
  const token = sessionTokenFrom(req);
  if (!token) return res.status(401).json({ error: 'Session expirée' });
  const user = await parseWithSession('users/me', token);
  if (user.error) return res.status(401).json(user);
  req.sessionToken = token; req.user = user; next();
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Accès réservé à l’administrateur.' });
  next();
}
function normalizedRole(role) { return String(role || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[-_]/g, ' ').trim(); }
function isAdmin(req) {
  return ['admin', 'administrateur', 'super admin', 'superadmin'].includes(normalizedRole(req.user?.role));
}
function requireAdminOrAtt(req, res, next) { if (!isAdmin(req) && normalizedRole(req.user?.role) !== 'att') return res.status(403).json({ error: 'Accès réservé à l’administrateur ou à l’ATT.' }); next(); }
async function requirePlanningGeneration(req, res, next) { const role = normalizedRole(req.user?.role); if (role === 'admin' || ['cooperative', 'membre cooperative', 'membre'].includes(role)) return next(); const cooperativeId = await cooperativeIdForUser(req); if (cooperativeId) return next(); return res.status(403).json({ error: `Rôle non autorisé pour le planning : ${req.user?.role || 'inconnu'}.` }); }
function sixDigitPassword() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function cooperativeIdForUser(req) {
  if (isAdmin(req)) return null;
  const directCooperative = req.user?.cooperative;
  if (directCooperative?.objectId || directCooperative?.id) return String(directCooperative.objectId || directCooperative.id);
  for (const field of ['cooperativeId', 'cooperativeObjectId', 'cppCooperativeId']) {
    if (req.user?.[field]) return String(req.user[field]);
  }
  const userId = req.user?.objectId || req.user?.id;
  if (!userId) return null;
  const pointer = encodeURIComponent(JSON.stringify({ user: { __type: 'Pointer', className: '_User', objectId: userId } }));
  const links = await parseRequest(`classes/CppUserCooperative?where=${pointer}&include=cooperative,user&limit=1`);
  const direct = links.results?.[0]?.cooperative?.objectId || (typeof links.results?.[0]?.cooperative === 'string' ? links.results[0].cooperative : null);
  if (direct) return String(direct);
  const allLinks = await parseRequest('classes/CppUserCooperative?include=cooperative,user&limit=1000');
  const match = (allLinks.results || []).find((link) => link.user?.objectId === userId || link.user?.id === userId || link.user === userId || link.userId === userId);
  const linkedId = match?.cooperative?.objectId || match?.cooperative?.id || match?.cooperativeId || (typeof match?.cooperative === 'string' ? match.cooperative : null);
  if (linkedId) return String(linkedId);

  // Some legacy accounts store the cooperative name instead of the relation.
  const accountName = String(req.user?.cooperativeName || req.user?.cooperative?.name || '').trim().toLowerCase();
  if (accountName) {
    const named = (await parseRequest('classes/CppCooperative?limit=1000')).results?.find((item) => String(item.name || item.nom || '').trim().toLowerCase() === accountName);
    if (named?.objectId) return named.objectId;
  }

  // A fresh installation often has one cooperative but the first account was
  // created before the relation table existed. In that unambiguous case the
  // account can use that cooperative without weakening multi-cooperative data isolation.
  const cooperatives = await parseRequest('classes/CppCooperative?limit=2');
  if (!cooperatives.error && cooperatives.results?.length === 1 && cooperatives.results[0]?.objectId) return cooperatives.results[0].objectId;
  return null;
}

function cooperativeWhere(objectId) {
  return encodeURIComponent(JSON.stringify({ cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId } }));
}

function templateWhere(objectId) {
  return encodeURIComponent(JSON.stringify({ $or: [{ cooperative: { $exists: false } }, { cooperative: null }, { cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId } }] }));
}

async function requirePlanningModelAccess(req, res, next) {
  if (isAdmin(req)) return next();
  const cooperativeId = await cooperativeIdForUser(req);
  if (!cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' });
  const model = await parseRequest(`classes/CppPlanningModel/${encodeURIComponent(req.params.id)}`);
  if (model.error) return res.status(model.code || 404).json(model);
  if (model.cooperative?.objectId !== cooperativeId) return res.status(403).json({ error: 'Ce template ne concerne pas votre coopérative.' });
  next();
}

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => res.json(await parseRequest('users?order=-createdAt')));
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const nameSource = String(req.body.fullName || req.body.username || 'user').trim();
  const username = String(req.body.username || nameSource).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'user';
  const role = String(req.body.role || 'Membre');
  const password = sixDigitPassword();
  const fullName = String(req.body.fullName || username).trim();
  const allowedRoles = ['ATT', 'CPCTRV', 'Admin', 'Membre Cpp', 'Cooperative', 'Membre_Cooperative'];
  if (!username || !password || !allowedRoles.includes(role)) return res.status(400).json({ error: 'Nom d’utilisateur, mot de passe et rôle valides obligatoires.' });
  if (role === 'Cooperative') {
    if (!req.body.cooperativeId) return res.status(400).json({ error: 'Une coopérative doit être sélectionnée pour ce rôle.' });
    const account = await createCooperativeAccount(String(req.body.cooperativeId), { username, password, email: req.body.email, fullName });
    return res.status(account.error ? account.code || 502 : 201).json(account.error ? account : { ...account, credentials: { username, password } });
  }
  const result = await parseRequest('users', { method: 'POST', body: JSON.stringify({ username, password, fullName, role, actif: true }) });
  res.status(result.error ? result.code || 502 : 201).json(result.error ? result : { ...result, credentials: { username, password } });
});

app.get('/api/cooperative', requireAuth, async (req, res) => {
  if (!isAdmin(req)) {
    const cooperativeId = await cooperativeIdForUser(req);
    if (!cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' });
    const cooperative = await parseRequest(`classes/CppCooperative/${encodeURIComponent(cooperativeId)}`);
    if (cooperative.error) return res.status(cooperative.code || 502).json(cooperative);
    const pointer = encodeURIComponent(JSON.stringify({ cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId } }));
    const accounts = await parseRequest(`classes/CppUserCooperative?where=${pointer}&include=user&limit=1000`);
    return res.json({ results: [cooperative], accounts: accounts.results || [] });
  }
  const where = encodeURIComponent(JSON.stringify({ type: { __type: 'Pointer', className: 'CppTransportType', objectId: 'FzSbvDYRCr' } }));
  const results = [];
  const limit = 100;
  let skip = 0;
  while (true) {
    const page = await parseRequest(`classes/CppCooperative?where=${where}&limit=${limit}&skip=${skip}&order=createdAt`);
    if (page.error) return res.status(page.code || 502).json(page);
    results.push(...(page.results || []));
    if (!page.results || page.results.length < limit) break;
    skip += limit;
  }
  const links = await parseRequest('classes/CppUserCooperative?include=cooperative,user&limit=1000');
  const linkedIds = new Set((links.results || []).map((link) => link.cooperative?.objectId).filter(Boolean));
  res.json({ results: results.map((cooperative) => ({ ...cooperative, hasAccount: linkedIds.has(cooperative.objectId) })) });
});

app.get('/api/transport-types', requireAuth, async (req, res) => res.json(await parseRequest('classes/CppTransportType?limit=1000&order=name')));

app.put('/api/cooperative/profile', requireAuth, async (req, res) => {
  const cooperativeId = await cooperativeIdForUser(req); if (!cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' });
  const body = {}; for (const field of ['name', 'address', 'adresse', 'phone', 'telephone', 'email', 'logoUrl']) if (req.body[field] !== undefined) body[field] = String(req.body[field] || '').trim();
  const result = await parseRequest(`classes/CppCooperative/${encodeURIComponent(cooperativeId)}`, { method: 'PUT', body: JSON.stringify(body) }); res.status(result.error ? result.code || 502 : 200).json(result);
});

app.put('/api/cooperative/profile/password', requireAuth, async (req, res) => {
  const password = String(req.body.password || ''); if (password.length < 4) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 4 caractères.' });
  const userId = req.user?.objectId || req.user?.id; if (!userId) return res.status(400).json({ error: 'Utilisateur connecté introuvable.' });
  const result = await parseWithSession(`users/${encodeURIComponent(userId)}`, req.sessionToken, { method: 'PUT', body: JSON.stringify({ password }) }); res.status(result.error ? result.code || 502 : 200).json(result.error ? result : { ok: true });
});

app.get('/api/cooperative/members', requireAuth, async (req, res) => {
  const cooperativeId = await cooperativeIdForUser(req); if (!cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' });
  const pointer = encodeURIComponent(JSON.stringify({ cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId } })); const accounts = await parseRequest(`classes/CppUserCooperative?where=${pointer}&include=user&limit=1000&order=-createdAt`); res.status(accounts.error ? accounts.code || 502 : 200).json({ results: accounts.results || [] });
});

app.post('/api/cooperative/members', requireAuth, async (req, res) => {
  const cooperativeId = await cooperativeIdForUser(req); if (!cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' }); const username = String(req.body.username || '').trim(); const password = String(req.body.password || '1234'); if (!username || password.length < 4) return res.status(400).json({ error: 'Nom d’utilisateur et mot de passe valides obligatoires.' });
  const user = await parseRequest('users', { method: 'POST', body: JSON.stringify({ username, password, email: String(req.body.email || '').trim(), fullName: String(req.body.fullName || username).trim(), role: 'Membre Cpp', actif: true, cooperativeId }) }); if (user.error) return res.status(user.code || 502).json(user);
  const link = await parseRequest('classes/CppUserCooperative', { method: 'POST', body: JSON.stringify({ cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId }, user: { __type: 'Pointer', className: '_User', objectId: user.objectId } }) }); if (link.error) return res.status(link.code || 502).json(link); res.status(201).json({ user, link, credentials: { username, password } });
});

app.get('/api/dashboard/quitus', requireAuth, async (req, res) => {
  const results = [];
  const limit = 1000;
  let skip = 0;
  while (true) {
    const page = await parseRequest(`classes/CppQuitus?include=destination,koperativa,chauffeur,ligne,ligneVariance,type&limit=${limit}&skip=${skip}&order=-createdAt`);
    if (page.error) return res.status(page.code || 502).json(page);
    results.push(...(page.results || []));
    if (!page.results || page.results.length < limit) break;
    skip += limit;
  }
  res.json({ results: addDestinationCoordinates(results) });
});

app.get('/api/manifold', requireAuth, async (req, res) => {
  const cooperativeId = await cooperativeIdForUser(req);
  let cooperativeName = '';
  if (cooperativeId) {
    const cooperative = await parseRequest(`classes/CppCooperative/${encodeURIComponent(cooperativeId)}`);
    cooperativeName = String(cooperative.name || cooperative.nom || '').trim().toLocaleLowerCase('fr-FR');
  }
  const results = [];
  let skip = 0;
  const limit = 1000;
  while (true) {
    const page = await parseRequest(`classes/CppQuitus?include=destination,koperativa,chauffeur,ligne,ligneVariance,type&limit=${limit}&skip=${skip}&order=-createdAt`);
    if (page.error) return res.status(page.code || 502).json(page);
    results.push(...(page.results || []));
    if (!page.results || page.results.length < limit) break;
    skip += limit;
  }
  const unique = new Map();
  for (const row of results) {
    const cooperative = row.koperativa;
    const rowCooperative = String(typeof cooperative === 'object' ? cooperative.name || cooperative.nom || cooperative.objectId || '' : cooperative || '').trim().toLocaleLowerCase('fr-FR');
    if (cooperativeName && rowCooperative !== cooperativeName) continue;
    const vehicle = String(row.vehiculeNumero || row.vehicleId || row.vehicule || row.matricule || row.immatriculation || '').trim();
    const rawDate = String(row.departureDate || row.dateDeparture || row.dateDepart || row.date || row.createdAt || '').trim();
    const match = rawDate.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    const day = match ? `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}` : rawDate.slice(0, 10);
    const key = `${vehicle.toLocaleLowerCase('fr-FR')}|${day}`;
    if (vehicle && day && !unique.has(key)) unique.set(key, { ...row, manifoldDay: day });
  }
  res.json({ results: [...unique.values()] });
});

app.get('/api/dashboard/occupancy', requireAuth, async (req, res) => {
  const admin = isAdmin(req);
  const cooperativeId = admin ? null : await cooperativeIdForUser(req);
  const requestedDay = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ''))
    ? String(req.query.date)
    : new Date().toISOString().slice(0, 10);
  const vehicleWhere = cooperativeId ? encodeURIComponent(JSON.stringify({ cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId } })) : '';
  const vehicles = { results: [] };
  let vehicleSkip = 0;
  const vehicleLimit = 1000;
  while (true) {
    const page = await parseRequest(`classes/CppTransportVehicule?${vehicleWhere ? `where=${vehicleWhere}&` : ''}limit=${vehicleLimit}&skip=${vehicleSkip}`);
    if (page.error) return res.status(page.code || 502).json(page);
    vehicles.results.push(...(page.results || []));
    if (!page.results || page.results.length < vehicleLimit) break;
    vehicleSkip += vehicleLimit;
  }
  const vehicleMap = new Map();
  for (const vehicle of vehicles.results || []) {
    const number = String(vehicle.numero || vehicle.numeroVehicule || vehicle.immatriculation || '').trim().toLocaleLowerCase('fr-FR');
    if (number) vehicleMap.set(number, { number: vehicle.numero || vehicle.numeroVehicule || vehicle.immatriculation, capacity: Number(vehicle.placeMax || vehicle.capacite || vehicle.places || 0) });
  }
  const holds = [];
  let skip = 0;
  const limit = 1000;
  const dayWhere = encodeURIComponent(JSON.stringify({ bucket: { $regex: `\\|${requestedDay}\\|` } }));
  while (true) {
    // On ne filtre pas par company : on demande directement à Parse les
    // buckets de la journée afin de ne pas parcourir tout l'historique.
    const page = await payParseRequest(`classes/TaxibrousseSeatHold?where=${dayWhere}&limit=${limit}&skip=${skip}&order=-createdAt`);
    if (page.error) return res.status(page.code || 502).json(page);
    holds.push(...(page.results || []));
    if (!page.results || page.results.length < limit) break;
    skip += limit;
  }
  const groups = new Map();
  for (const hold of holds) {
    const bucket = String(hold.bucket || '');
    const parts = bucket.split('|');
    const vehicle = String(parts[2] || '').trim();
    const day = String(parts[1] || '').trim();
    if (day !== requestedDay) continue;
    const key = `${vehicle.toLocaleLowerCase('fr-FR')}|${day}`;
    if (!vehicle || !day || (!admin && cooperativeId && !vehicleMap.has(vehicle.toLocaleLowerCase('fr-FR')))) continue;
    const group = groups.get(key) || { vehicle, day, seats: new Set() };
    const seatValues = Array.isArray(hold.seat) ? hold.seat : [hold.seat];
    for (const seat of seatValues) {
      const seatKey = seat && typeof seat === 'object' ? seat.objectId || seat.number || seat.label || JSON.stringify(seat) : String(seat ?? '').trim();
      if (seatKey) group.seats.add(String(seatKey));
    }
    groups.set(key, group);
  }
  const results = [...groups.values()].map((group) => { const occupied = group.seats.size; const capacity = 18; return { vehicle: group.vehicle, day: group.day, occupied, capacity, rate: Math.min(100, Math.round((occupied / capacity) * 100)) }; });
  res.json({ results, sourceCount: holds.length, matchedCount: results.length, date: requestedDay, scope: admin ? 'all' : (cooperativeId || null) });
});

app.get('/api/ligne', requireAuth, async (req, res) => {
  const cooperativeId = await cooperativeIdForUser(req);
  const where = encodeURIComponent(JSON.stringify({ type: 'TAXI-BROUSSE' }));
  const result = await parseRequest(`classes/CppLigneVariance?where=${where}&include=ligne_taxibrousse&limit=1000&order=description`);
  let catalogProducts = [];
  let catalogProductsError = '';
  if (cooperativeId) {
    const cooperative = await parseRequest(`classes/CppCooperative/${encodeURIComponent(cooperativeId)}`);
    const catalogObjectIds = [...new Set([
      ...(Array.isArray(cooperative.catalogObjectId) ? cooperative.catalogObjectId : [cooperative.catalogObjectId]),
      ...(Array.isArray(cooperative.catalog) ? cooperative.catalog : [])
    ].flatMap((value) => {
      if (!value) return [];
      if (typeof value === 'object') return [value.objectId];
      return String(value).split(',').map((item) => item.trim());
    }).filter(Boolean))];
    if (catalogObjectIds.length) {
      const catalogPointers = catalogObjectIds.map((objectId) => ({ __type: 'Pointer', className: 'CompanyCatalog', objectId: String(objectId) }));
      const productWhere = encodeURIComponent(JSON.stringify({ catalog: catalogPointers.length === 1 ? catalogPointers[0] : { $in: catalogPointers }, operation_code: { __type: 'Pointer', className: 'CatalogOperation', objectId: 'FSQ0ijbut5' } }));
      const products = await payParseRequest(`classes/CompanyProduct?where=${productWhere}&include=catalog,operation_code&limit=1000&order=name`);
      if (products.error) catalogProductsError = products.error;
      else {
        const uniqueProducts = new Map();
        const productKey = (product) => String(product.name || product.title || product.label || product.objectId || '')
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr-FR')
          .replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, '').trim();
        const productCode = (product) => String(product.code || product.productCode || '').trim();
        const hasRealCode = (product) => { const code = productCode(product).toLocaleLowerCase('fr-FR'); return Boolean(code) && code !== 'code'; };
        for (const product of products.results || []) {
          const key = productKey(product);
          const existing = uniqueProducts.get(key);
          if (!existing || (!hasRealCode(existing) && hasRealCode(product))) uniqueProducts.set(key, product);
        }
        catalogProducts = [...uniqueProducts.values()];
      }
    }
  }
  if (!result.error) result.results = (result.results || []).map(row => { const displayCode = row.code || row.ligne_taxibrousse?.code || row.ligne_taxibrousse?.objectId || ''; return { ...row, displayCode, description: displayCode ? `${displayCode} · ${row.description || ''}` : row.description }; });
  const links = await parseRequest('classes/CppLigneVarianceCooperative?include=cooperative&limit=1000');
  if (!result.error && !links.error) { const byLine = new Map(); for (const link of links.results || []) { const id = link.ligneVariance?.objectId; if (!id) continue; if (cooperativeId && link.cooperative?.objectId !== cooperativeId) continue; if (!byLine.has(id)) byLine.set(id, []); byLine.get(id).push(link.cooperative); } result.results = result.results.map(row => ({ ...row, cooperatives: byLine.get(row.objectId) || [] })).filter(row => isAdmin(req) || row.cooperatives.length > 0); }
  res.status(result.error ? result.code || 502 : 200).json({ ...result, catalogProducts, ...(catalogProductsError ? { catalogProductsError } : {}) });
});

app.put('/api/ligne/catalog-products/:id/code', requireAuth, async (req, res) => {
  const code = String(req.body?.code || '').trim();
  if (!code) return res.status(400).json({ error: 'Le code produit est obligatoire.' });
  if (code.length > 100) return res.status(400).json({ error: 'Le code produit est trop long.' });
  const product = await payParseRequest(`classes/CompanyProduct/${encodeURIComponent(req.params.id)}?include=catalog`);
  if (product.error) return res.status(product.code || 502).json(product);
  if (!isAdmin(req)) {
    const cooperativeId = await cooperativeIdForUser(req);
    if (!cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' });
    const cooperative = await parseRequest(`classes/CppCooperative/${encodeURIComponent(cooperativeId)}`);
    const catalogIds = [
      ...(Array.isArray(cooperative.catalogObjectId) ? cooperative.catalogObjectId : [cooperative.catalogObjectId]),
      ...(Array.isArray(cooperative.catalog) ? cooperative.catalog : [])
    ].flatMap((value) => typeof value === 'object' ? [value?.objectId] : String(value || '').split(',').map((item) => item.trim())).filter(Boolean).map(String);
    if (!catalogIds.includes(String(product.catalog?.objectId || product.catalog || ''))) return res.status(403).json({ error: 'Vous ne pouvez modifier que les produits de votre catalogue.' });
  }
  const updated = await payParseRequest(`classes/CompanyProduct/${encodeURIComponent(req.params.id)}`, { method: 'PUT', body: JSON.stringify({ code }) });
  res.status(updated.error ? updated.code || 502 : 200).json(updated);
});

app.post('/api/ligne/:id/cooperatives', requireAuth, requireAdmin, async (req, res) => {
  const ids = [...new Set(Array.isArray(req.body.cooperatives) ? req.body.cooperatives : [])];
  const where = encodeURIComponent(JSON.stringify({ ligneVariance: { __type: 'Pointer', className: 'CppLigneVariance', objectId: req.params.id } }));
  const existing = await parseRequest(`classes/CppLigneVarianceCooperative?where=${where}&limit=1000`);
  if (!existing.error) for (const item of existing.results || []) await parseRequest(`classes/CppLigneVarianceCooperative/${item.objectId}`, { method: 'DELETE' });
  const relations = [];
  for (const cooperative of ids) { const relation = await parseRequest('classes/CppLigneVarianceCooperative', { method: 'POST', body: JSON.stringify({ ligneVariance: { __type: 'Pointer', className: 'CppLigneVariance', objectId: req.params.id }, cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperative } }) }); if (relation.error) return res.status(relation.code || 502).json(relation); relations.push(relation); }
  res.json({ relations });
});

app.post('/api/ligne/cooperatives/import', requireAuth, requireAdmin, async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const results = []; const errors = [];
  for (const [index, row] of rows.entries()) {
    if (!row.ligneVariance || !row.cooperative) { errors.push({ row: index + 2, error: 'ligneVariance et cooperative sont obligatoires.' }); continue; }
    const relation = await parseRequest('classes/CppLigneVarianceCooperative', { method: 'POST', body: JSON.stringify({ ligneVariance: { __type: 'Pointer', className: 'CppLigneVariance', objectId: String(row.ligneVariance) }, cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: String(row.cooperative) } }) });
    if (relation.error) errors.push({ row: index + 2, error: relation.error }); else results.push(relation);
  }
  res.status(errors.length && !results.length ? 400 : 200).json({ results, errors });
});

app.get('/api/cooperatives-list', requireAuth, async (req, res) => res.json(await parseRequest('classes/CppCooperative?limit=1000&order=name')));
app.get('/api/proprietaires', requireAuth, requireAdmin, async (req, res) => res.json(await parseRequest('classes/CppProprietaire?include=user_id&limit=1000&order=nom')));
app.post('/api/proprietaires', requireAuth, requireAdmin, async (req, res) => {
  const nom = String(req.body.nom || '').trim(); const prenom = String(req.body.prenom || '').trim(); const email = String(req.body.email || '').trim().toLowerCase(); const password = String(req.body.password || '');
  if (!nom || !prenom || !email || password.length < 4) return res.status(400).json({ error: 'Nom, prénom, email et mot de passe (4 caractères minimum) sont obligatoires.' });
  const username = String(req.body.username || email.split('@')[0] || `${prenom}.${nom}`).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || `proprietaire_${Date.now()}`;
  const user = await parseRequest('users', { method: 'POST', body: JSON.stringify({ username, password, email, fullName: `${prenom} ${nom}`.trim(), role: 'Proprietaire', actif: true }) });
  if (user.error) return res.status(user.code || 502).json({ error: user.error });
  const fields = ['date_de_naissance', 'adresse', 'phone', 'CIN', 'role_id', 'group_prop_id_adelya', 'nif', 'stat', 'validation', 'approbation_coop', 'ville', 'code_postal', 'pays', 'nom_operat', 'idAdhesion', 'rib', 'numero_compte', 'other_number', 'number_flotte', 'nom_banque', 'type_paiement', 'periodiciteVersement', 'tour', 'idSeafile', 'objectIdFidMember', 'photo', 'created_at', 'updated_at'];
  const owner = { nom, prenom, email, role: 'Proprietaire', actif: true, stat: 'Actif', validation: 'Non', approbation_coop: 'Non', user_id: { __type: 'Pointer', className: '_User', objectId: user.objectId } };
  for (const field of fields) if (req.body[field] !== undefined && req.body[field] !== '') owner[field] = field === 'created_at' || field === 'updated_at' ? String(req.body[field]) : String(req.body[field]).trim();
  const proprietor = await parseRequest('classes/CppProprietaire', { method: 'POST', body: JSON.stringify(owner) });
  if (proprietor.error) return res.status(proprietor.code || 502).json({ error: proprietor.error, user: { objectId: user.objectId, username } });
  res.status(201).json({ proprietor, user: { objectId: user.objectId, username, email } });
});
app.get('/api/pay-test/catalog-products', requireAuth, requireAdmin, async (req, res) => {
  const type = encodeURIComponent(JSON.stringify({ type: { __type: 'Pointer', className: 'CppTransportType', objectId: 'FzSbvDYRCr' } }));
  const cooperatives = await parseRequest(`classes/CppCooperative?where=${type}&include=type&limit=1000&order=name`);
  if (cooperatives.error) return res.status(cooperatives.code || 502).json(cooperatives);
  const rows = cooperatives.results || [];
  const catalogObjectIds = [...new Set(rows.map((row) => row.catalogObjectId).filter(Boolean).map(String))];
  if (!catalogObjectIds.length) return res.json({ cooperatives: rows, catalogObjectIds: [], products: [] });
  const catalogPointers = catalogObjectIds.map((objectId) => ({ __type: 'Pointer', className: 'CompanyCatalog', objectId }));
  const where = encodeURIComponent(JSON.stringify({ catalog: { $in: catalogPointers } }));
  const products = await payParseRequest(`classes/CompanyProduct?where=${where}&include=catalog&limit=1000&order=name`);
  if (products.error) return res.status(products.code || 502).json({ cooperatives: rows, catalogObjectIds, products: [], error: products.error });
  res.json({ cooperatives: rows, catalogObjectIds, products: products.results || [] });
});

app.get('/api/cooperative/reservation-stats', requireAuth, async (req, res) => {
  const companyId = 'yKm1BqyB11';
  const now = new Date(); const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0); const weekStart = new Date(dayStart); weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7)); const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const company = { __type: 'Pointer', className: 'Company', objectId: companyId }; const where = encodeURIComponent(JSON.stringify({ company, createdAt: { $gte: { __type: 'Date', iso: monthStart.toISOString() }, $lte: { __type: 'Date', iso: now.toISOString() } } }));
  const result = await payParseRequest(`classes/CompanyReservation?where=${where}&include=catalog,transaction,status&limit=1000&order=-createdAt`);
  if (result.error) return res.status(result.code || 502).json({ error: result.error });
  const reservations = result.results || []; const statusIds = [...new Set(reservations.flatMap((row) => [row.status?.objectId, row.transaction?.status?.objectId]).filter(Boolean))]; const statusNames = {};
  await Promise.all(statusIds.map(async (id) => { const status = await payParseRequest(`classes/Status/${encodeURIComponent(id)}`); if (!status.error) statusNames[id] = String(status.name || status.label || status.code || '').toLowerCase(); }));
  const classify = (row) => { const reservationStatus = statusNames[row.status?.objectId] || String(row.status?.name || '').toLowerCase(); const transactionStatus = statusNames[row.transaction?.status?.objectId] || String(row.transaction?.status?.name || '').toLowerCase(); const pending = reservationStatus.includes('attente') || reservationStatus.includes('pending'); const confirmed = !pending && (reservationStatus.includes('reserv') || reservationStatus.includes('confirm') || reservationStatus.includes('valid')); const paid = !transactionStatus.includes('attente') && !transactionStatus.includes('pending') && (transactionStatus.includes('pay') || transactionStatus.includes('regl') || transactionStatus.includes('paid') || Number(row.transaction?.amount_net || 0) > 0); return { pending, confirmed, paid }; };
  const build = (start) => reservations.filter((row) => new Date(row.createdAt || 0) >= start).reduce((stats, row) => { const state = classify(row); const amountGross = Number(row.transaction?.amount_initial || 0); const amountNet = Number(row.transaction?.amount_net || 0); stats.reservations += 1; stats.confirmed += state.confirmed ? 1 : 0; stats.pending += state.pending ? 1 : 0; stats.paid += state.paid ? 1 : 0; stats.gross += amountGross; stats.net += amountNet; return stats; }, { reservations: 0, confirmed: 0, pending: 0, paid: 0, gross: 0, net: 0 });
  const quitusWhere = encodeURIComponent(JSON.stringify({ createdAt: { $gte: { __type: 'Date', iso: dayStart.toISOString() }, $lte: { __type: 'Date', iso: now.toISOString() } } })); const quitus = await parseRequest(`classes/CppQuitus?where=${quitusWhere}&limit=1000`); const activeVehicles = new Set((quitus.results || []).map((row) => String(row.guest || row.vehiculeNumero || '').trim().toLowerCase()).filter(Boolean)).size;
  const transactionWhere = encodeURIComponent(JSON.stringify({ month: now.getUTCMonth() + 1, year: now.getUTCFullYear() })); const transactions = await payParseRequest(`classes/Transaction?where=${transactionWhere}&limit=1000`); const transactionRows = transactions.results || []; const transactionNet = (start) => transactionRows.filter((row) => new Date(row.createdAt || 0) >= start).reduce((sum, row) => sum + Number(row.amount_net || 0), 0);
  const todayStats = build(dayStart); const weekStats = build(weekStart); const monthStats = build(monthStart); todayStats.activeVehicles = activeVehicles; todayStats.net = transactionNet(dayStart); weekStats.net = transactionNet(weekStart); monthStats.net = transactionNet(monthStart);
  res.json({ companyId, today: todayStats, week: weekStats, month: monthStats, source: 'CompanyReservation + CppQuitus + Transaction' });
});

app.get('/api/trajets', requireAuth, async (req, res) => {
  const trips = await parseRequest('classes/CppTrajet?include=ligne&limit=1000&order=-createdAt');
  if (trips.error) return res.status(trips.code || 502).json(trips);
  const links = await parseRequest('classes/CppTrajetCooperative?include=cooperative&limit=1000');
  if (links.error) return res.status(links.code || 502).json(links);
  const byTrip = new Map();
  for (const link of links.results || []) { const id = link.trajet?.objectId; if (!id) continue; if (!byTrip.has(id)) byTrip.set(id, []); byTrip.get(id).push(link.cooperative); }
  res.json({ results: (trips.results || []).map(trip => ({ ...trip, cooperatives: byTrip.get(trip.objectId) || [] })) });
});

app.post('/api/trajets', requireAuth, async (req, res) => {
  const cooperativeIds = Array.isArray(req.body.cooperatives) ? req.body.cooperatives : [];
  if (!req.body.depart || !req.body.arrivee || !cooperativeIds.length) return res.status(400).json({ error: 'Départ, arrivée et au moins une coopérative sont obligatoires.' });
  const trip = await parseRequest('classes/CppTrajet', { method: 'POST', body: JSON.stringify({ depart: String(req.body.depart), arrivee: String(req.body.arrivee), date: String(req.body.date || ''), heure: String(req.body.heure || ''), statut: String(req.body.statut || 'Planifié') }) });
  if (trip.error) return res.status(trip.code || 502).json(trip);
  const relations = [];
  for (const cooperative of cooperativeIds) { const link = await parseRequest('classes/CppTrajetCooperative', { method: 'POST', body: JSON.stringify({ trajet: { __type: 'Pointer', className: 'CppTrajet', objectId: trip.objectId }, cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperative } }) }); if (link.error) return res.status(link.code || 502).json({ trip, error: link.error }); relations.push(link); }
  res.status(201).json({ trip, relations });
});

function cooperativePayload(input) {
  const body = {};
  for (const field of ['name', 'email', 'logoUrl', 'urlCityLogo', 'status', 'idGroupAdelya', 'catalog', 'category', 'adresse', 'address', 'phone', 'telephone']) if (input[field] !== undefined) body[field] = String(input[field] || '').trim();
  if (input.logo) body.logo = input.logo;
  if (input.logoCity) body.logoCity = input.logoCity;
  if (input.type?.__type === 'Pointer' && input.type.className === 'CppTransportType' && input.type.objectId) body.type = input.type;
  return body;
}

async function createCooperativeAccount(cooperativeId, input) {
  const username = String(input.username || '').trim();
  const password = String(input.password || '1234');
  const email = String(input.email || '').trim();
  if (!username) return { error: 'Identifiant du compte obligatoire.', code: 400 };
  const user = await parseRequest('users', { method: 'POST', body: JSON.stringify({ username, password, email, fullName: input.fullName || username, role: 'Cooperative', actif: true, cooperativeId: String(cooperativeId) }) });
  if (user.error) return user;
  const link = await parseRequest('classes/CppUserCooperative', { method: 'POST', body: JSON.stringify({ cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId }, user: { __type: 'Pointer', className: '_User', objectId: user.objectId } }) });
  if (link.error) return link;
  return { user, link };
}

app.post('/api/cooperative', requireAuth, async (req, res) => {
  const result = await parseRequest('classes/CppCooperative', { method: 'POST', body: JSON.stringify(cooperativePayload(req.body)) });
  if (result.error) return res.status(result.code || 502).json(result);
  const base = String(req.body.name || 'cooperative').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'cooperative';
  const suffix = Math.random().toString(36).slice(2, 6);
  const username = `${base}_${suffix}`;
  const password = sixDigitPassword();
  const account = await createCooperativeAccount(result.objectId, { username, password, email: req.body.email, fullName: req.body.name });
  if (account.error) return res.status(account.code || 502).json({ cooperative: result, error: account.error });
  res.status(201).json({ cooperative: result, account: account.user, credentials: { username, password } });
});

app.post('/api/cooperative/bulk', requireAuth, async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const created = []; const errors = [];
  for (const [index, row] of rows.entries()) {
    const result = await parseRequest('classes/CppCooperative', { method: 'POST', body: JSON.stringify(cooperativePayload(row)) });
    if (result.error) errors.push({ row: index + 1, error: result.error }); else created.push(result);
  }
  res.status(errors.length && !created.length ? 400 : 200).json({ created, errors });
});

app.post('/api/cooperative/:id/account', requireAuth, requireAdmin, async (req, res) => {
  const result = await createCooperativeAccount(req.params.id, req.body);
  res.status(result.error ? result.code || 502 : 201).json(result);
});

app.post('/api/cooperative/with-account', requireAuth, requireAdmin, async (req, res) => {
  const cooperative = await parseRequest('classes/CppCooperative', { method: 'POST', body: JSON.stringify(cooperativePayload(req.body)) });
  if (cooperative.error) return res.status(cooperative.code || 502).json(cooperative);
  const account = await createCooperativeAccount(cooperative.objectId, req.body.account || {});
  if (account.error) return res.status(account.code || 502).json({ cooperative, ...account });
  res.status(201).json({ cooperative, ...account });
});

app.post('/api/cooperative/upload', requireAuth, async (req, res) => {
  const filename = String(req.body.filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  const base64 = String(req.body.base64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64) return res.status(400).json({ error: 'Fichier vide.' });
  if (!process.env.SEAFILE_BASIC_TOKEN) return res.status(500).json({ error: 'SEAFILE_BASIC_TOKEN n’est pas configuré.' });
  const seafileUrl = process.env.SEAFILE_URL || 'https://cseafile.cpp-system.com';
  const tokenResponse = await fetch(`${seafileUrl}/getpayload`, { method: 'POST', headers: { Authorization: `Basic ${process.env.SEAFILE_BASIC_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) return res.status(tokenResponse.status || 502).json({ error: tokenData.message || 'Impossible de récupérer le token Seafile.' });
  const form = new FormData();
  form.append('name', filename);
  form.append('files', new Blob([Buffer.from(base64, 'base64')], { type: req.body.contentType || 'application/octet-stream' }), filename);
  form.append('parent_dir', '');
  form.append('src', 'TRP');
  const uploadResponse = await fetch(`${seafileUrl}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${tokenData.access_token}` }, body: form });
  const uploadData = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || uploadData.error) return res.status(uploadResponse.status || 502).json({ error: uploadData.message || 'Échec de l’envoi vers Seafile.' });
  res.status(201).json({ url: uploadData.message, seafile: uploadData });
});

app.get('/api/admin/vehicules', requireAuth, async (req, res) => { const cooperativeId = await cooperativeIdForUser(req); if (!isAdmin(req) && !cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' }); const criteria = { type: 'TAXIBROUSSE', ...(cooperativeId ? { cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId } } : {}) }; const where = encodeURIComponent(JSON.stringify(criteria)); const transport = await parseRequest(`classes/CppTransportVehicule?where=${where}&include=cooperative,chauffeur,ligne&limit=1000&order=numero`); const unique = new Map(); for (const vehicle of transport.results || []) { const number = String(vehicle.numero || vehicle.numeroVehicule || '').trim().toLowerCase(); const key = number || vehicle.objectId; if (!unique.has(key)) unique.set(key, vehicle); } res.json({ results: [...unique.values()] }); });
app.post('/api/admin/vehicules', requireAuth, requireAdmin, async (req, res) => {
  const body = { numero: String(req.body.numero || '').trim(), modele: String(req.body.modele || '').trim(), placeMax: Number(req.body.placeMax || req.body.capacite || 0), statut: String(req.body.statut || 'Disponible'), type: 'TAXIBROUSSE' };
  if (req.body.chauffeur) body.chauffeur = { __type: 'Pointer', className: 'CppChauffeur', objectId: String(req.body.chauffeur) };
  const cooperativeId = req.body.cooperative || req.body.proprietaire;
  if (cooperativeId) body.cooperative = { __type: 'Pointer', className: 'CppCooperative', objectId: String(cooperativeId) };
  if (req.body.ligne) body.ligne = { __type: 'Pointer', className: 'CppLigneVariance', objectId: String(req.body.ligne) };
  if (req.body.photoUrl) body.photoUrl = String(req.body.photoUrl);
  if (req.body.photos) body.photos = req.body.photos;
  if (!body.numero) return res.status(400).json({ error: 'Le numéro du véhicule est obligatoire.' });
  const result = await parseRequest('classes/CppTransportVehicule', { method: 'POST', body: JSON.stringify(body) });
  res.status(result.error ? result.code || 502 : 201).json(result);
});
app.put('/api/admin/vehicules/:id', requireAuth, async (req, res) => {
  const cooperativeId = await cooperativeIdForUser(req);
  if (!isAdmin(req)) {
    if (!cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' });
    const current = await parseRequest(`classes/CppTransportVehicule/${encodeURIComponent(req.params.id)}`);
    if (current.error) return res.status(current.code || 404).json(current);
    if (current.cooperative?.objectId !== cooperativeId) return res.status(403).json({ error: 'Vous ne pouvez modifier que les véhicules de votre coopérative.' });
  }
  const body = {};
  for (const field of ['numero', 'modele', 'statut']) if (req.body[field] !== undefined) body[field] = String(req.body[field] || '').trim();
  if (req.body.placeMax !== undefined || req.body.capacite !== undefined) body.placeMax = Number(req.body.placeMax || req.body.capacite || 0);
  for (const [field, className] of [['chauffeur', 'CppChauffeur'], ['ligne', 'CppLigneVariance']]) if (req.body[field]) body[field] = { __type: 'Pointer', className, objectId: String(req.body[field]) };
  if (isAdmin(req) && (req.body.cooperative || req.body.proprietaire)) body.cooperative = { __type: 'Pointer', className: 'CppCooperative', objectId: String(req.body.cooperative || req.body.proprietaire) };
  if (!isAdmin(req)) body.cooperative = { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId };
  let result = await parseRequest(`classes/CppTransportVehicule/${encodeURIComponent(req.params.id)}`, { method: 'PUT', body: JSON.stringify(body) });
  if (result.error) result = await parseRequest(`classes/CppVehicule/${encodeURIComponent(req.params.id)}`, { method: 'PUT', body: JSON.stringify(body) });
  res.status(result.error ? result.code || 502 : 200).json(result);
});
app.post('/api/admin/vehicules/bulk', requireAuth, requireAdmin, async (req, res) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const created = []; const errors = [];
  for (const [index, row] of rows.entries()) {
    const body = { numero: String(row.numero || '').trim(), modele: String(row.modele || '').trim(), capacite: Number(row.capacite || 0), statut: String(row.statut || 'Disponible').trim() };
    if (!body.numero) { errors.push({ row: index + 1, error: 'Numéro obligatoire.' }); continue; }
    const result = await parseRequest('classes/CppVehicule', { method: 'POST', body: JSON.stringify(body) });
    if (result.error) errors.push({ row: index + 1, error: result.error }); else created.push(result);
  }
  res.status(errors.length && !created.length ? 400 : 200).json({ created, errors });
});
app.put('/api/admin/documents/:type/:id', requireAuth, async (req, res) => {
  const isVehicle = req.params.type === 'vehicules';
  let className = isVehicle ? 'CppVehicule' : req.params.type === 'chauffeurs' ? 'CppChauffeur' : '';
  if (!className) return res.status(400).json({ error: 'Type de document invalide.' });
  let current = await parseRequest(`classes/${className}/${encodeURIComponent(req.params.id)}`);
  if (isVehicle && current.error) { className = 'CppTransportVehicule'; current = await parseRequest(`classes/${className}/${encodeURIComponent(req.params.id)}`); }
  if (current.error) return res.status(current.code || 404).json(current);
  if (!isAdmin(req) && normalizedRole(req.user?.role) !== 'att') { const cooperativeId = await cooperativeIdForUser(req); if (!cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' }); if (current.cooperative?.objectId !== cooperativeId) return res.status(403).json({ error: 'Vous ne pouvez modifier que les papiers de vos véhicules.' }); }
  const documentExpiry = { ...(current.documentExpiry || {}), ...(req.body.documentExpiry || {}) };
  const documentDates = { ...(current.documentDates || {}), ...(req.body.documentDates || {}) };
  const documentFiles = { ...(current.documentFiles || {}), ...(req.body.documentFiles || {}) };
  const metadata = Array.isArray(current.documentMetadata) ? [...current.documentMetadata] : [];
  const typeLabels = { assurance: 'Assurance', licence: 'Licence', carteGrise: 'CarteGrise', visiteTechnique: 'VisiteTechnique', permis: 'Permis', visitePermis: 'VisitePermis' };
  Object.entries(req.body.documentFiles || {}).forEach(([key, url]) => { if (!url) return; const orientation = key.endsWith('Verso') ? 'verso' : 'recto'; const baseKey = key.replace(/Verso$/, ''); const type = typeLabels[baseKey] || baseKey; const index = metadata.findIndex((item) => item.type === type && item.orientation === orientation); const item = { type, url, orientation }; if (index >= 0) metadata[index] = item; else metadata.push(item); });
  const result = await parseRequest(`classes/${className}/${encodeURIComponent(req.params.id)}`, { method: 'PUT', body: JSON.stringify({ documentExpiry, documentDates, documentFiles, documentMetadata: metadata }) });
  res.status(result.error ? result.code || 502 : 200).json(result);
});
app.get('/api/controle-papiers', requireAuth, async (req, res) => {
  const cooperativeId = await cooperativeIdForUser(req); if (!isAdmin(req) && !cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' });
  const where = encodeURIComponent(JSON.stringify({ type: 'TAXIBROUSSE', ...(cooperativeId ? { cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId } } : {}) }));
  const [transport, drivers] = await Promise.all([parseRequest(`classes/CppTransportVehicule?where=${where}&limit=1000&order=numero`), parseRequest('classes/CppChauffeur?limit=1000&order=nom')]);
  const vehicleRows = (transport.results || []).map((row) => { const numero = row.numero || row.numeroVehicule || row.vehicleNumber || ''; return { ...row, numero, documentSubject: numero || 'Véhicule', documentKind: 'Véhicule', documentType: 'vehicle' }; });
  const driverRows = (drivers.results || []).map((row) => ({ ...row, documentSubject: `${row.nom || ''} ${row.prenom || ''}`.trim() || 'Chauffeur', documentKind: 'Chauffeur' }));
  res.json({ results: [...vehicleRows, ...driverRows] });
});
app.get('/api/admin/chauffeurs', requireAuth, requireAdmin, async (req, res) => res.json(await parseRequest('classes/CppChauffeur?limit=1000&order=nom')));
app.post('/api/admin/chauffeurs', requireAuth, requireAdmin, async (req, res) => {
  const numeroPermis = String(req.body.numeroPermis || req.body.numPermis || req.body.permisNumero || '').trim();
  const body = { nom: String(req.body.nom || '').trim(), prenom: String(req.body.prenom || '').trim(), telephone: String(req.body.telephone || '').trim(), adresse: String(req.body.adresse || '').trim(), categoriePermis: String(req.body.categoriePermis || '').trim(), numeroPermis, numPermis: numeroPermis, permisNumero: numeroPermis, statut: 'Actif' };
  if (req.body.photos) body.photos = req.body.photos;
  if (!body.nom) return res.status(400).json({ error: 'Le nom du chauffeur est obligatoire.' });
  const result = await parseRequest('classes/CppChauffeur', { method: 'POST', body: JSON.stringify(body) });
  res.status(result.error ? result.code || 502 : 201).json(result);
});
app.put('/api/admin/chauffeurs/:id', requireAuth, requireAdmin, async (req, res) => {
  const body = {}; for (const field of ['nom', 'prenom', 'telephone', 'adresse', 'categoriePermis', 'numeroPermis', 'numPermis', 'permisNumero']) if (req.body[field] !== undefined) body[field] = String(req.body[field] || '').trim(); body.statut = 'Actif';
  const result = await parseRequest(`classes/CppChauffeur/${encodeURIComponent(req.params.id)}`, { method: 'PUT', body: JSON.stringify(body) }); res.status(result.error ? result.code || 502 : 200).json(result);
});
app.delete('/api/admin/chauffeurs/:id', requireAuth, requireAdmin, async (req, res) => {
  const result = await parseRequest(`classes/CppChauffeur/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' }); res.status(result.error ? result.code || 502 : 204).json(result.error ? result : { ok: true });
});
app.get('/api/planning-models', requireAuth, async (req, res) => { const cooperativeId = await cooperativeIdForUser(req); if (!isAdmin(req) && !cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' }); const filter = cooperativeId ? `&where=${templateWhere(cooperativeId)}` : ''; const result = await parseRequest(`classes/CppPlanningModel?include=vehicleModel,cooperative&limit=1000&order=name${filter}`); if (result.results) result.results = result.results.map((item) => ({ ...item, distanceKm: item.distanceKm ?? routeDistanceKm(item.depart, item.destination) })); res.json(result); });
app.get('/api/vehicle-models', requireAuth, async (req, res) => res.json(await parseRequest('classes/CppVehicleModel?limit=1000&order=name')));
app.post('/api/vehicle-models', requireAuth, requireAdmin, async (req, res) => { const places = Number(req.body.places || 0); const inputLayout = req.body.seatLayout && !Array.isArray(req.body.seatLayout) ? req.body.seatLayout : {}; const seats = (Array.isArray(inputLayout.seats) ? inputLayout.seats : Array.from({ length: Math.max(0, places - 2) }, (_, index) => ({ number: index + 3, label: `P${index + 3}`, status: 'available' }))).slice(0, Math.max(0, places - 2)).map((seat, index) => ({ number: Number(seat.number || index + 3), label: String(seat.label || `P${index + 3}`), status: String(seat.status || 'available') })); const seatLayout = { driver: inputLayout.driver || { label: 'Chauffeur', steeringWheel: true }, frontSeats: Array.isArray(inputLayout.frontSeats) ? inputLayout.frontSeats.slice(0, 2) : [{ number: 1, label: 'P1', status: 'available' }, { number: 2, label: 'P2', status: 'available' }].slice(0, places), columns: Number(inputLayout.columns || 4), rows: Number(inputLayout.rows || Math.ceil(seats.length / Number(inputLayout.columns || 4))), seats }; const body = { name: String(req.body.name || '').trim(), vehiculeModele: String(req.body.vehiculeModele || '').trim(), places, heure: String(req.body.heure || '').trim(), seatLayout }; if (!body.name || !body.places) return res.status(400).json({ error: 'Nom et nombre de places sont obligatoires.' }); const result = await parseRequest('classes/CppVehicleModel', { method: 'POST', body: JSON.stringify(body) }); res.status(result.error ? result.code || 502 : 201).json(result); });
app.get('/api/planning-vehicles', requireAuth, async (req, res) => { const cooperativeId = await cooperativeIdForUser(req); if (!isAdmin(req) && !cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' }); const where = encodeURIComponent(JSON.stringify({ type: 'TAXIBROUSSE', ...(cooperativeId ? { cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId } } : {}) })); const result = await parseRequest(`classes/CppTransportVehicule?where=${where}&include=cooperative&limit=1000&order=numero`); res.json({ results: result.results || [] }); });
app.get('/api/planning-drivers', requireAuth, async (req, res) => { const result = await parseRequest('classes/CppChauffeur?limit=1000&order=nom'); res.json({ results: result.results || [] }); });
app.post('/api/planning-models', requireAuth, requirePlanningGeneration, async (req, res) => {
  const body = planningPayload(req.body); if (!body.name) return res.status(400).json({ error: 'Le nom du modèle est obligatoire.' }); const cooperativeId = await cooperativeIdForUser(req); if (!isAdmin(req) && !cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' }); if (cooperativeId) body.cooperative = { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId }; const distanceKm = routeDistanceKm(body.depart, body.destination); if (distanceKm !== null) body.distanceKm = distanceKm;
  const result = await parseRequest('classes/CppPlanningModel', { method: 'POST', body: JSON.stringify(body) }); res.status(result.error ? result.code || 502 : 201).json(result);
});
app.post('/api/planning-models/:id/generate', requireAuth, requirePlanningGeneration, requirePlanningModelAccess, async (req, res) => {
  const model = await parseRequest(`classes/CppPlanningModel/${encodeURIComponent(req.params.id)}`); if (model.error) return res.status(model.code || 404).json(model); const cooperativeId = await cooperativeIdForUser(req); const vehicleModel = model.vehicleModel?.objectId ? await parseRequest(`classes/CppVehicleModel/${encodeURIComponent(model.vehicleModel.objectId)}`) : {};
  const start = new Date(`${req.body.startDate}T12:00:00`); const end = new Date(`${req.body.endDate || req.body.startDate}T12:00:00`); if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return res.status(400).json({ error: 'Période invalide.' });
  const existing = await parseRequest('classes/CppPlanning?limit=1000'); const created = []; const cursor = new Date(start); const days = String(model.jours || '').split(',').map((day) => day.trim().toLowerCase()).filter(Boolean); const names = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  while (cursor <= end) { const date = cursor.toISOString().slice(0, 10); const allowedDay = !days.length || days.includes(names[cursor.getDay()]); const quota = [0, 6].includes(cursor.getDay()) ? Number(model.weekendCount || 0) : Number(model.weekdayCount || 0); const already = (existing.results || []).filter((item) => String(item.date || '').slice(0, 10) === date && (item.model?.objectId === model.objectId || item.model === model.objectId) && (!cooperativeId || item.cooperative?.objectId === cooperativeId)).length; if (allowedDay && quota > already) { for (let index = already; index < quota; index += 1) { const payload = { name: model.name, depart: model.depart || '—', destination: model.destination, heure: model.heureIndicative || model.heure || vehicleModel.heure || '', places: Number(model.capacitePrevisionnelle || model.places || vehicleModel.places || 0), date, model: { __type: 'Pointer', className: 'CppPlanningModel', objectId: model.objectId }, ...(cooperativeId ? { cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId } } : {}) }; const result = await parseRequest('classes/CppPlanning', { method: 'POST', body: JSON.stringify(payload) }); if (!result.error) created.push(result); } } cursor.setDate(cursor.getDate() + 1); }
  res.status(201).json({ created, count: created.length, message: `${created.length} départ(s) généré(s).` });
});
app.post('/api/planning-models-legacy/:id/generate', requireAuth, requirePlanningGeneration, async (req, res) => {
  const model = await parseRequest(`classes/CppPlanningModel/${encodeURIComponent(req.params.id)}`);
  if (model.error) return res.status(model.code || 404).json(model);
  const start = new Date(`${req.body.startDate || new Date().toISOString().slice(0, 10)}T00:00:00`);
  const end = new Date(`${req.body.endDate || req.body.startDate || new Date().toISOString().slice(0, 10)}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return res.status(400).json({ error: 'Période de génération invalide.' });
  const frequency = String(req.body.frequence || 'Hebdomadaire');
  const selectedDays = String(model.jours || '').split(',').map((day) => day.trim().toLowerCase()).filter(Boolean);
  const dayNames = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  const existing = await parseRequest('classes/CppPlanning?limit=1000');
  const existingKeys = new Set((existing.results || []).filter((item) => item.model?.objectId === model.objectId).map((item) => `${item.model.objectId}|${String(item.date || '').slice(0, 10)}`));
  const created = []; const cursor = new Date(start); let monthKey = '';
  while (cursor <= end) { const dateKey = cursor.toISOString().slice(0, 10); const dayMatch = !selectedDays.length || selectedDays.includes(dayNames[cursor.getDay()]); const currentMonth = `${cursor.getFullYear()}-${cursor.getMonth()}`; const allowed = frequency === 'Jour' ? dayMatch : frequency === 'Mensuel' ? dayMatch && currentMonth !== monthKey : dayMatch; if (allowed && !existingKeys.has(`${model.objectId}|${dateKey}`)) { const payload = { name: model.name || `Planning ${model.destination || ''}`.trim(), depart: model.depart || '—', destination: model.destination || '', heure: model.heureIndicative || model.heure || '', mode: model.mode || 'Fixe', jours: model.jours || '', places: Number(model.capacitePrevisionnelle || model.places || 0), date: dateKey, model: { __type: 'Pointer', className: 'CppPlanningModel', objectId: model.objectId } }; const result = await parseRequest('classes/CppPlanning', { method: 'POST', body: JSON.stringify(payload) }); if (!result.error) { created.push(result); existingKeys.add(`${model.objectId}|${dateKey}`); } } if (allowed && frequency === 'Mensuel') monthKey = currentMonth; cursor.setDate(cursor.getDate() + 1); }
  res.status(201).json({ created, count: created.length, message: `${created.length} départ(s) prévisionnel(s) généré(s).` });
});
app.get('/api/planning', requireAuth, async (req, res) => { const cooperativeId = await cooperativeIdForUser(req); if (!isAdmin(req) && !cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' }); const filter = cooperativeId ? `&where=${cooperativeWhere(cooperativeId)}` : ''; res.json(await parseRequest(`classes/CppPlanning?include=cooperative,model&limit=1000&order=date${filter}`)); });
app.post('/api/planning', requireAuth, async (req, res) => { const body = planningPayload(req.body); if (!body.date || !body.depart || !body.destination) return res.status(400).json({ error: 'Date, départ et destination sont obligatoires.' }); const cooperativeId = await cooperativeIdForUser(req); if (!isAdmin(req) && !cooperativeId) return res.status(403).json({ error: 'Aucune coopérative n’est liée à cet utilisateur.' }); if (cooperativeId) body.cooperative = { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId }; if (await vehicleAlreadyAssigned(body.date, body.vehiculeNumero)) return res.status(409).json({ error: `Le véhicule ${body.vehiculeNumero} est déjà affecté le ${body.date}.` }); const distanceKm = routeDistanceKm(body.depart, body.destination); if (distanceKm !== null) body.distanceKm = distanceKm; const result = await parseRequest('classes/CppPlanning', { method: 'POST', body: JSON.stringify(body) }); res.status(result.error ? result.code || 502 : 201).json(result); });
app.put('/api/planning/:id', requireAuth, async (req, res) => { const id = String(req.params.id || '').trim(); const body = planningPayload(req.body); if (!id) return res.status(400).json({ error: 'Identifiant du planning manquant.' }); if (!body.date || !body.depart || !body.destination) return res.status(400).json({ error: 'Date, départ et destination sont obligatoires.' }); const current = await parseRequest(`classes/CppPlanning/${encodeURIComponent(id)}`); if (current.error) return res.status(current.code || 404).json(current); const cooperativeId = await cooperativeIdForUser(req); if (!isAdmin(req) && (!cooperativeId || current.cooperative?.objectId !== cooperativeId)) return res.status(403).json({ error: 'Vous ne pouvez modifier que le planning de votre coopérative.' }); if (cooperativeId) body.cooperative = { __type: 'Pointer', className: 'CppCooperative', objectId: cooperativeId }; if (await vehicleAlreadyAssigned(body.date, body.vehiculeNumero, id)) return res.status(409).json({ error: `Le véhicule ${body.vehiculeNumero} est déjà affecté le ${body.date}.` }); const distanceKm = routeDistanceKm(body.depart, body.destination); if (distanceKm !== null) body.distanceKm = distanceKm; const result = await parseRequest(`classes/CppPlanning/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }); if (result.error) return res.status(result.code || 502).json(result); const saved = await parseRequest(`classes/CppPlanning/${encodeURIComponent(id)}?include=cooperative,model`); if (saved.error) return res.status(saved.code || 502).json(saved); res.status(200).json(saved); });
function planningPayload(input) { const body = {}; for (const field of ['name', 'depart', 'destination', 'axe', 'zone', 'category', 'date', 'heure', 'heureIndicative', 'mode', 'frequence', 'jours', 'vehiculeNumero', 'chauffeurNom', 'vehiculeModele']) if (input[field] !== undefined) body[field] = String(input[field] || '').trim(); for (const field of ['places', 'capacitePrevisionnelle', 'weekdayCount', 'weekendCount', 'distanceKm']) if (input[field] !== undefined) body[field] = Number(input[field] || 0); for (const [field, className] of [['cooperative', 'CppCooperative'], ['model', 'CppPlanningModel'], ['vehicleModel', 'CppVehicleModel']]) if (input[field]) body[field] = { __type: 'Pointer', className, objectId: String(input[field]) }; return body; }

app.put('/api/cooperative/:id', requireAuth, async (req, res) => {
  const body = {};
  for (const field of ['name', 'adresse', 'address', 'phone', 'telephone', 'email', 'logoUrl']) {
    if (req.body[field] !== undefined) body[field] = String(req.body[field] || '').trim();
  }
  if (req.body.type?.__type === 'Pointer' && req.body.type.className === 'CppTransportType' && req.body.type.objectId) body.type = req.body.type;
  const result = await parseRequest(`classes/CppCooperative/${encodeURIComponent(req.params.id)}`, { method: 'PUT', body: JSON.stringify(body) });
  res.status(result.error ? result.code || 502 : 200).json(result);
});
app.delete('/api/cooperative/:id', requireAuth, requireAdmin, async (req, res) => {
  const result = await parseRequest(`classes/CppCooperative/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
  res.status(result.error ? result.code || 502 : 204).json(result.error ? result : { ok: true });
});

app.get('/api/cooperative/:id/details', requireAuth, async (req, res) => {
  const id = encodeURIComponent(req.params.id);
  const cooperative = await parseRequest(`classes/CppCooperative/${id}`);
  if (cooperative.error) return res.status(cooperative.code || 502).json(cooperative);
  const pointer = encodeURIComponent(JSON.stringify({ cooperative: { __type: 'Pointer', className: 'CppCooperative', objectId: req.params.id } }));
  const lines = await parseRequest(`classes/CppLigneTransport?where=${pointer}&include=ligne,type&limit=1000`);
  const accounts = await parseRequest(`classes/CppUserCooperative?where=${pointer}&include=user&limit=1000`);
  if (lines.error) return res.status(lines.code || 502).json(lines);
  if (accounts.error) return res.status(accounts.code || 502).json(accounts);
  res.json({ cooperative, lines: lines.results || [], accounts: accounts.results || [] });
});

app.get('/api/:className', requireAuth, requireAdmin, async (req, res) => res.json(await parseRequest(`classes/${req.params.className}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`)));
app.post('/api/:className', requireAuth, requireAdmin, async (req, res) => res.json(await parseRequest(`classes/${req.params.className}`, { method: 'POST', body: JSON.stringify(req.body) })));
app.put('/api/:className/:id', requireAuth, requireAdmin, async (req, res) => res.json(await parseRequest(`classes/${req.params.className}/${req.params.id}`, { method: 'PUT', body: JSON.stringify(req.body) })));
app.delete('/api/:className/:id', requireAuth, requireAdmin, async (req, res) => res.json(await parseRequest(`classes/${req.params.className}/${req.params.id}`, { method: 'DELETE' })));

const currentDir = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(currentDir, 'dist')));
app.use((req, res) => res.sendFile(path.join(currentDir, 'dist', 'index.html')));
// Vercel importe l'application comme une fonction serverless. En local, on
// conserve le serveur HTTP classique utilisé par `npm start` et le script de
// développement.
export default app;

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Coop Taxi-Brousse: http://localhost:${port}`));
}
