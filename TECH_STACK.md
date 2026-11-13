# Coop Taxi-Brousse — Stack technique

## Version de l’application

- Nom : Cpp Transport V3
- Version : `3.0.0`

## Technologies et versions

| Technologie | Version |
|---|---:|
| React | 18.3.1 |
| React DOM | 18.3.1 |
| Vite | 5.4.10 |
| @vitejs/plugin-react | 4.3.3 |
| Node.js | 20 LTS recommandé |
| Express | 4.21.1 |
| Sass | 1.80.6 |
| dotenv | 16.4.5 |
| XLSX | 0.18.5 |
| npm | 10.x recommandé |

## Stack principale

- Frontend : React avec Vite
- Backend : Node.js avec Express
- Styles : SCSS/Sass
- Base de données et API : Parse Server REST API
- Authentification : Parse `_User`, sessions et cookies HTTP-only
- Cartographie : Leaflet et OpenStreetMap
- Import/export : XLSX
- Stockage des images : Parse Files
- Stockage des documents administratifs : Seafile API (`https://cseafile.cpp-system.com`)

## Architecture

```text
React/Vite → Express/Node.js → Parse Server REST API
```

En production, Express sert le dossier `dist/` et les routes backend `/api/*`.

## Prérequis serveur

- Node.js 20 LTS
- npm 10.x
- Nginx ou Apache comme reverse proxy
- HTTPS recommandé
- Accès au serveur Parse distant
- PM2 recommandé pour maintenir le serveur Node actif




## Installation et lancement

```bash
npm install
npm run build
npm start
```

L’application démarre sur :

```text
http://localhost:3000
```

## Lancement avec PM2

```bash
npm install -g pm2
pm2 start server.js --name coop-taxi-brousse
pm2 save
pm2 startup
```

## Configuration Nginx exemple

```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

## Classes Parse principales

- `_User`
- `CppCooperative`
- `CppVehicule`
- `CppChauffeur`
- `CppPlanning`
- `CppPlanningModel`
- `CppLigneVariance`
- `CppTransportType`


