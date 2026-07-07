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

## Thèmes visuels

Le thème actif est choisi côté serveur avec la variable `APP_THEME` :

```bash
APP_THEME=academy
```

Quatre variantes sont disponibles :

- `academy` : thème chaleureux et pédagogique, inspiré du second visuel ;
- `cosmic` : thème sombre et compétitif, inspiré du premier visuel ;
- `orbit` : thème pastel et ludique, inspiré du troisième visuel ;
- `arcade` : thème original à fort contraste, inspiré des jeux télévisés rétro.

Après une modification de `APP_THEME`, redémarrez le serveur local ou redéployez le service Render. Pour comparer ponctuellement un thème sans toucher à la configuration, ajoutez `?theme=cosmic`, `?theme=orbit`, `?theme=academy` ou `?theme=arcade` à l'URL. Cette option ne modifie pas le thème des autres visiteurs.

## Dictionnaire d'oeuvres

Pour generer une liste initiale d'oeuvres depuis Wikidata :

```bash
npm run dictionary:generate
```

Le fichier produit est `data/dictionnaires/oeuvres-wikidata.txt`. Il contient une valeur par ligne au format `Titre (type, annee, attribution : valeur)` et peut etre utilise pour remplir un dictionnaire dans l'interface admin.

Exemples :

```text
Forrest Gump (film, 1994, realisateur : Robert Zemeckis)
Fondation (livre, 1942, auteur : Isaac Asimov)
Minecraft (jeu video, 2011, studio : Mojang Studios)
```

Le script trie localement les resultats Wikidata par nombre de liens interwiki afin de favoriser les oeuvres les plus connues, puis deduplique les valeurs.

Les dictionnaires volumineux sont acceptes par l'API avec la limite `JSON_BODY_LIMIT` (`25mb` par defaut). Cote Firestore, les valeurs sont decoupees dans des sous-documents pour eviter la limite de taille d'un document Firebase.

Si votre environnement local intercepte les certificats HTTPS, utilisez :

```bash
npm run dictionary:generate -- --insecure
```

## Quiz depuis le sondage

Pour generer une premiere version de quiz depuis le fichier Excel de sondage place dans `data/` :

```bash
npm run survey:generate
```

Pour generer une version ou les questions oeuvres utilisent la recherche avec autocompletion :

```bash
npm run survey:generate -- --answer-mode autocomplete
```

Le script produit :

- `data/generated/quiz-sondage-preview.json` : payload de quiz pret a relire ou importer.
- `data/generated/quiz-sondage-controle.csv` : controle des titres normalises, ouvrable dans Excel.
- `data/generated/quiz-sondage-summary.json` : resume de generation et points a verifier.
- `data/generated/quiz-sondage-oeuvres-dictionnaire.txt` : valeurs d'oeuvres a ajouter dans un dictionnaire pour garantir l'import en mode autocompletion.

La generation cree une manche par personne, trois questions oeuvre, puis la question sur la personne reliee. Les propositions QCM sont generees automatiquement.

Pour importer dans l'interface admin :

1. Creer ou modifier un dictionnaire d'oeuvres avec le contenu du fichier `*-oeuvres-dictionnaire.txt`.
2. Dans `Mes quiz`, selectionner ce dictionnaire dans `Dictionnaire oeuvres`.
3. Cliquer sur `Importer JSON` et choisir le fichier `*-preview.json`.

## Preparation des indices

Pour creer un espace de travail avec un dossier par oeuvre depuis un JSON d'import :

```bash
npm run clues:prepare -- --input data/generated/quiz-sondage-autocomplete-preview.json
```

Le script genere par defaut `data/generated/indices-quiz-sondage-autocomplete-preview/` avec :

- `index.csv` : suivi des oeuvres et des dossiers.
- `index.json` : plan structure des indices.
- `oeuvres/<type-titre-annee>/README.md` : fiche de preparation.
- `oeuvres/<type-titre-annee>/manifest.json` : manifeste exploitable par d'autres scripts.
- `sources/` et `assets/` dans chaque dossier d'oeuvre.

Les plans proposes sont adaptes au type :

- musique : extraits audio de 1, 5 et 10 secondes ;
- film : deux screenshots puis un court extrait de bande annonce ;
- livre : courts extraits ou indices textuels a saisir manuellement ;
- jeu video : son iconique, extrait de BO et screenshot.

Le script ne telecharge pas de contenus proteges. Si vous disposez de fichiers source locaux, vous pouvez les placer dans un dossier miroir et demander une generation technique des assets :

```bash
npm run clues:prepare -- --input data/generated/quiz-sondage-autocomplete-preview.json --media-root contenu_quizz/sources
```

Pour chaque oeuvre, le dossier source attendu porte le meme nom que le dossier genere et peut contenir `source-audio.mp3`, `source-video.mp4` ou `source-image.jpg`. Le traitement local utilise `ffmpeg` s'il est installe.

Pour preparer des pistes depuis des sources specialisees, utilisez :

```bash
npm run clues:prepare -- --input data/generated/quiz-sondage-autocomplete-preview.json --discover-web-sources
```

Ce mode genere `sources/suggestions-web.json` dans les dossiers concernes :

- films : recherche TMDB. Avec `TMDB_READ_ACCESS_TOKEN` ou `TMDB_API_KEY`, le script peut recuperer poster, backdrop et liens de bandes annonces TMDB/YouTube.
- jeux video : liens de recherche jeuxvideo.com et recherche ciblee.
- musiques : liens de recherche YouTube pour selection manuelle d'une source officielle ou exploitable legalement.
- livres : liens de recherche Google Books / Wikisource.

Pour telecharger directement des fichiers quand une API le permet :

```bash
npm run clues:prepare -- --input data/generated/quiz-sondage-autocomplete-preview.json --download-provider-assets
```

Ce mode telecharge :

- livres : couvertures Open Library et fichier texte d'indices de travail ;
- jeux video : image header et screenshots Steam si le jeu est disponible sur Steam, sinon background et screenshots RAWG si `RAWG_API_KEY` est configure ;
- films : utilisez `--discover-web-sources` avec `TMDB_READ_ACCESS_TOKEN` ou `TMDB_API_KEY` pour recuperer les images TMDB.

Pour activer TMDB :

```bash
TMDB_READ_ACCESS_TOKEN=token-api-read-access-tmdb
# ou
TMDB_API_KEY=cle-api-tmdb
RAWG_API_KEY=cle-api-rawg
```

ou ponctuellement :

```bash
npm run clues:prepare -- --input data/generated/quiz-sondage-autocomplete-preview.json --discover-web-sources --tmdb-read-access-token token-api-read-access-tmdb
```

Options utiles :

- `--limit 5` : traiter seulement les 5 premieres oeuvres pour tester.
- `--discover-web-sources` : utiliser TMDB, jeuxvideo.com, YouTube ou recherches livres selon le type.
- `--download-provider-assets` : telecharger les fichiers disponibles depuis Open Library ou RAWG.
- `--tmdb-read-access-token` ou `--tmdb-api-key` : fournir ponctuellement les identifiants TMDB si vous ne passez pas par `.env`.
- `--rawg-api-key` : fournir ponctuellement la cle RAWG pour les assets jeux video.
- `--download-free-sources` : mode secondaire Wikimedia Commons, utile surtout pour contenus du domaine public ou images libres generiques.
- `--max-downloads-per-type 2` : telecharger jusqu'a 2 candidats par type de media.
- `--max-source-mb 25` : ignorer les fichiers sources trop volumineux.
- `--download-delay-ms 500` : ralentir les appels pour rester courtois avec l'API publique.
- `--insecure` : uniquement en local si votre environnement intercepte les certificats HTTPS.

Verifiez toujours que le fichier ou le lien correspond bien a l'oeuvre, que la licence convient a votre usage et que l'attribution est conservee. Le script ne contourne pas les droits d'auteur et ne telecharge pas l'audio depuis YouTube, Spotify ou d'autres plateformes non libres.
