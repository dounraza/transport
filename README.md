# Coop Taxi-Brousse — React + Parse

Application React pour gérer les membres, véhicules, trajets, recettes et dépenses de la coopérative.

## Lancer le projet

```bash
npm install
npm run dev
```

Le serveur Parse proxy utilise les variables de `.env`. La clé Master reste uniquement côté serveur et n'est jamais intégrée dans le navigateur.

Pour une version de production :

```bash
npm run build
npm start
```

Les classes Parse attendues sont `membres`, `vehicules`, `trajets` et `finances`. Le fichier `.env.example` sert de modèle de configuration.

## Utilisateurs et rôles

Le champ `role` est ajouté dans la classe Parse `_User`. Les rôles prévus sont : `ATT`, `CPCTRV`, `Admin`, `Membre Cpp`, `Cooperative` et `Membre_Cooperative`.

Pour créer un utilisateur par rôle avec le mot de passe initial `1234` :

```bash
npm run seed:users
```

L’utilisateur `admin` est le seul à accéder aux vues de gestion complètes. Les autres rôles disposent d’une vue séparée en attente de leurs règles métier.
