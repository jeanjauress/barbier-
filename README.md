# Le Fil du Rasoir

Site du barbier. Les demandes de réservation sont enregistrées dans une base PostgreSQL et le propriétaire reçoit un message WhatsApp à chaque nouvelle demande.

## Démarrer

1. Installer **Node.js 22.13 ou plus récent** (version LTS sur https://nodejs.org) et **PostgreSQL** (https://www.postgresql.org/download/).
2. Copier `.env.example` en `.env` et remplir les valeurs, dont `PGPASSWORD` (mot de passe de l'utilisateur `postgres`).
3. Installer les dépendances :

   ```
   npm install
   ```

4. Créer la base et y copier les réservations de l'ancienne base SQLite `data/reservations.db` (sans risque à relancer) :

   ```
   npm run migrate
   ```

5. Lancer :

   ```
   npm start
   ```

6. Ouvrir http://localhost:3000

Le tableau `reservations` est créé automatiquement au démarrage s'il n'existe pas.

Sans fournisseur WhatsApp configuré, le message est simplement affiché dans la console : pratique pour tester.

## Configurer WhatsApp

### Option 1 : CallMeBot (gratuit, le plus simple)

Idéal pour envoyer des messages à **son propre numéro**.

1. Suivre les instructions sur https://www.callmebot.com/blog/free-api-whatsapp-messages/ : ajouter le numéro de CallMeBot dans ses contacts et lui envoyer le message d'autorisation depuis le WhatsApp du propriétaire.
2. CallMeBot répond avec une clé API.
3. Dans `.env` :

   ```
   OWNER_WHATSAPP=+2250700000000
   WHATSAPP_PROVIDER=callmebot
   CALLMEBOT_APIKEY=la-cle-recue
   ```

### Option 2 : Twilio (payant, plus fiable)

1. Créer un compte sur https://www.twilio.com et activer le *WhatsApp Sandbox* (ou un expéditeur WhatsApp validé).
2. Dans `.env` :

   ```
   WHATSAPP_PROVIDER=twilio
   TWILIO_ACCOUNT_SID=ACxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxx
   TWILIO_FROM=+14155238886
   ```

## Consulter les réservations

Ouvrir `/admin` (en ligne : https://barbier.onrender.com/admin) et saisir le mot de passe `ADMIN_TOKEN`.

Ou en ligne de commande :

```
curl http://localhost:3000/api/reservations -H "Authorization: Bearer <ADMIN_TOKEN>"
```

Chaque réservation indique `notified = true` si le WhatsApp est parti, sinon `notify_error` donne la raison. La réservation est toujours enregistrée, même si l'envoi WhatsApp échoue.

La base peut aussi s'ouvrir avec pgAdmin (installé avec PostgreSQL) ou DBeaver.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | La page du site |
| `admin.html` | La page `/admin` : liste des réservations, protégée par `ADMIN_TOKEN` |
| `server.js` | Serveur web, API `/api/reservations` |
| `db.js` | Connexion PostgreSQL et création du tableau |
| `whatsapp.js` | Envoi du message au propriétaire |
| `migrate-sqlite.js` | Copie unique des anciennes réservations SQLite vers PostgreSQL |
| `.env` | Configuration (non versionné) |
| `data/reservations.db` | Ancienne base SQLite, gardée comme sauvegarde (non versionnée) |

## Hébergement

Il faut un hébergeur qui exécute Node.js et une base PostgreSQL hébergée (Render, Neon, Supabase…). Mettez l'adresse de connexion fournie dans `DATABASE_URL` : elle remplace les variables `PG…`.

### Sur Render

- Base : `barbier-db` (Francfort). L'offre gratuite expire au bout de 30 jours : passez-la en payant avant, sinon les réservations sont perdues.
- Service web : runtime Node, build `npm install`, démarrage `npm start`, région Francfort.
- Variables d'environnement du service : `DATABASE_URL` (adresse *interne* de la base), `ADMIN_TOKEN`, `OWNER_WHATSAPP`, `WHATSAPP_PROVIDER`, `CALLMEBOT_APIKEY` (ou les variables Twilio). `PORT` est fourni par Render.
- Chaque `git push` sur `main` redéploie le site automatiquement.
