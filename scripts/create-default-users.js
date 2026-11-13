import 'dotenv/config';

const roles = ['ATT', 'CPCTRV', 'Admin', 'Membre Cpp', 'Cooperative', 'Membre_Cooperative'];
const base = `${process.env.CPCTRV_PARSE_HOST}/${process.env.CPCTRV_PARSE_ROUTE}`;
for (const role of roles) {
  const username = role.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const response = await fetch(`${base}/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Parse-Application-Id': process.env.CPCTRV_PARSE_APP_ID, 'X-Parse-Master-Key': process.env.CPCTRV_PARSE_MASTER_KEY }, body: JSON.stringify({ username, password: '1234', role, actif: true }) });
  const body = await response.text();
  let result = {};
  try { result = JSON.parse(body); } catch { result.error = `Réponse non JSON depuis ${base}/users (HTTP ${response.status})`; }
  console.log(`${username} (${role}) : ${response.ok ? 'créé' : result.error || 'non créé'}`);
  if (!response.ok && body.startsWith('<')) console.log('La route Parse configurée renvoie du HTML. Vérifiez CPCTRV_PARSE_HOST et CPCTRV_PARSE_ROUTE dans .env.');
}
