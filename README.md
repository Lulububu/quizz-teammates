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

## Authentification admin

Les createurs de quiz se connectent avec le bouton Google. Le serveur verifie les ID tokens Google avec `GOOGLE_CLIENT_ID`.

Les joueurs n'ont pas besoin de compte : ils rejoignent toujours une partie via le code court ou le QR code.

En local, renseignez votre client ID Google dans `.env` :

```bash
GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```
