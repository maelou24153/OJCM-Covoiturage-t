# OJCM Covoiturage

Site de covoiturage du club de judo OJCM (Sigean / Narbonne), à héberger vous-même.
Il n'a **aucune dépendance** : il suffit de Node.js 18 ou plus récent.

## Ce que contient le site

- **Page publique (`/`)** : liste des compétitions, stages et entraînements à venir. Les conducteurs proposent un trajet, les familles réservent des places. Pas de compte à créer : on indique son nom et son téléphone, et on reçoit un **code d'annulation** pour retrouver ou annuler sa réservation.
- **Espace administrateur (`/admin`)**, protégé par mot de passe :
  - ajout, modification et suppression des rendez-vous ;
  - vue d'ensemble (places proposées et réservées, par ville de départ) ;
  - liste de tous les trajets avec les téléphones, suppression d'un trajet ou d'un passager ;
  - message d'information affiché en haut du site ;
  - export CSV (compatible Excel).
- Les téléphones ne sont visibles que par l'administrateur, par le conducteur (pour ses passagers) et par le passager (pour son conducteur).

## Démarrage en local

```bash
cp .env.example .env        # puis éditez .env et choisissez ADMIN_PASSWORD
node server.js
```

Ouvrez http://localhost:3000 (site) et http://localhost:3000/admin (administration).

## Mise en ligne

Dans tous les cas, il faut un hébergeur qui exécute Node.js (pas un simple hébergement de pages statiques) et un **disque qui conserve les fichiers** : les données sont enregistrées dans le dossier `data/`.

### Option A : un serveur (VPS) avec PM2 et HTTPS

```bash
# sur le serveur (Node 18+ installé)
git clone <votre dépôt> ojcm-covoiturage   # ou copiez le dossier
cd ojcm-covoiturage
cp .env.example .env && nano .env          # ADMIN_PASSWORD, TRUST_PROXY=1, COOKIE_SECURE=1
npm install -g pm2
pm2 start server.js --name ojcm
pm2 save && pm2 startup
```

Placez ensuite Nginx ou Caddy devant, avec un certificat HTTPS. Exemple Caddy (`Caddyfile`) :

```
covoiturage.votre-domaine.fr {
    reverse_proxy localhost:3000
}
```

### Option B : Docker

```bash
docker build -t ojcm-covoiturage .
docker run -d --name ojcm -p 3000:3000 -v ojcm-data:/data \
  -e ADMIN_PASSWORD="votre phrase de passe" -e TRUST_PROXY=1 -e COOKIE_SECURE=1 \
  --restart unless-stopped ojcm-covoiturage
```

### Option C : plateformes (Render, Railway, Fly.io, etc.)

- Commande de démarrage : `node server.js`.
- Variables : `ADMIN_PASSWORD`, `TRUST_PROXY=1`, `COOKIE_SECURE=1`.
- Ajoutez un **disque persistant** (volume), montez-le par exemple sur `/var/data` et définissez `DATA_DIR=/var/data`. Sans disque persistant, les données sont perdues à chaque redémarrage.

### Option D : hébergeur mutualisé avec Node.js (o2switch, Hostinger, etc.)

Utilisez l'outil « Setup Node.js App » de l'hébergeur : racine de l'application = ce dossier, fichier de démarrage = `server.js`, puis ajoutez les variables d'environnement ci-dessus.

## Sauvegarde

Toutes les données sont dans `data/data.json`. Copiez ce fichier régulièrement. Le fichier `data/secret.key` sert à signer les sessions et les codes : conservez-le aussi (sinon les codes d'annulation déjà distribués ne fonctionnent plus).

## Données personnelles

Le site enregistre des noms et des numéros de téléphone. Les rendez-vous terminés depuis plus de 90 jours sont effacés automatiquement avec leurs trajets et réservations (réglable avec `PURGE_DAYS`). Pensez à informer les familles de cet usage, par exemple dans le message d'information du club.

## Sécurité

- Mot de passe administrateur obligatoire, comparé sans fuite d'information, avec limite de 8 essais par 15 minutes et par adresse IP.
- Cookie de session `HttpOnly` et `SameSite=Strict`, requêtes d'administration protégées contre les envois depuis d'autres sites.
- Limitation du nombre de publications et de réservations par visiteur, champ piège contre les robots.
- Contenu saisi toujours échappé à l'affichage, en-têtes de sécurité (CSP) activés.
- Utilisez toujours HTTPS en production.

## Limites à connaître

- Une seule instance du serveur (les données sont dans un fichier). C'est largement suffisant pour un club.
- Il n'y a pas d'envoi d'e-mails ou de SMS : les contacts se font par téléphone.
- Le logo est dans `public/logo.png` : remplacez-le par une autre image du même nom pour le changer.

## Structure

```
server.js          serveur et API
public/            pages du site (index.html, admin.html), style.css, app.js, admin.js, logo
data/              données (créées au premier lancement)
.env.example       configuration à copier en .env
Dockerfile         image Docker
```
