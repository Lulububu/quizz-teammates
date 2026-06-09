# Quizz Teammates

Application de quiz temps reel inspiree de Kahoot, avec des manches ou les joueurs doivent identifier trois oeuvres a partir d'indices, puis retrouver la personne reliee a ces oeuvres.

## Demarrage

```bash
npm install
cp .env.example .env
npm run dev
```

- Client Angular : http://localhost:4200
- API Express / Socket.IO : http://localhost:3000

Le proxy Angular redirige `/api` et `/socket.io` vers le serveur local.

## Firebase

Les createurs de quiz se connectent avec Firebase Auth + Google. Le serveur verifie les ID tokens avec Firebase Admin et stocke les donnees dans Firestore.

Les joueurs n'ont pas besoin de compte : ils rejoignent toujours une partie via le code court ou le QR code.

En local et sur Render, renseignez les variables de `.env.example`.

Pour `FIREBASE_PRIVATE_KEY` sur Render, gardez les `\n` echappes dans la variable d'environnement.

## Deploiement Render

Le fichier `render.yaml` decrit un service web gratuit qui construit Angular + Express avec `npm run build`, puis demarre `npm start`.

Sur Render, ajoutez les variables Firebase listees dans `.env.example`. Dans Firebase Authentication, ajoutez aussi le domaine Render dans les domaines autorises.
