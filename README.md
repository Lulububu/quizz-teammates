# Quiz Teammates

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

### Indices image, audio et video

Les fichiers d'indice sont envoyes directement dans Cloudinary avec une signature temporaire generee par Express pour l'administrateur connecte. Les limites appliquees sont :

- image : 5 Mo ;
- audio : 10 Mo ;
- video : 20 Mo.

Ajoutez les identifiants Cloudinary dans `.env` et sur Render :

```bash
CLOUDINARY_CLOUD_NAME=nom-du-cloud
CLOUDINARY_API_KEY=cle-api
CLOUDINARY_API_SECRET=secret-cloudinary
```

`CLOUDINARY_API_SECRET` ne doit jamais etre expose dans Angular ou commite dans Git. Le serveur signe chaque upload et Cloudinary renvoie une URL publique lisible par les joueurs sans compte.

## Deploiement Render

Le fichier `render.yaml` decrit un service web gratuit qui construit Angular + Express avec `npm run build`, puis demarre `npm start`.

Sur Render, ajoutez les variables Firebase et Cloudinary listees dans `.env.example`. Dans Firebase Authentication, ajoutez aussi le domaine Render dans les domaines autorises.

## Dictionnaire d'oeuvres

Pour generer une liste initiale d'oeuvres depuis Wikidata :

```bash
npm run dictionary:generate
```

Le fichier produit est `data/dictionnaires/oeuvres-wikidata.txt`. Il contient une valeur par ligne au format `Titre (type, annee)` et peut etre utilise pour remplir un dictionnaire dans l'interface admin.

Si votre environnement local intercepte les certificats HTTPS, utilisez :

```bash
npm run dictionary:generate -- --insecure
```
