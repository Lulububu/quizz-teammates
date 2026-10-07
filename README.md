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

### Test de charge du jeu (Render)

`npm run perf:game` utilise **Artillery** pour lancer 30 joueurs virtuels et mesurer les temps de connexion, d'entree, d'envoi et de resultat. Un organisateur automatise cree un salon, lance le quiz et avance apres chaque revelation. Les joueurs verifient la correction, les points, les resultats et le classement final. Chaque execution cree un salon et des ecritures Firestore : utilisez un quiz de test avec au moins une manche sur le deploiement cible. Lancez le test depuis votre ordinateur, contre l'URL Render, pas sur le service Render lui-meme.

Installez l'outil de charge une seule fois avec `npm run perf:setup` (Node.js 20 ou plus). Il est isole dans `performance/` et n'est pas installe par la construction du site sur Render.
Vous pouvez vérifier l'installation sans Firebase ni Render avec `npm run perf:smoke` ; ce contrôle local utilise deux joueurs et un serveur simulé.
Pour un lancement depuis ce workspace, vous pouvez aussi placer les trois variables `PERF_BASE_URL`, `PERF_QUIZ_ID` et `PERF_ADMIN_TOKEN` dans `.env.perf.local` : le contrôleur charge ce fichier automatiquement et Git l'ignore. `PERF_ADMIN_TOKEN` accepte le jeton seul ou précédé de `Bearer `.

```bash
export PERF_BASE_URL=https://votre-service.onrender.com
export PERF_QUIZ_ID=identifiant-du-quiz-de-test
export PERF_ADMIN_TOKEN=jeton-id-firebase-du-proprietaire
export PERF_REPORT=/tmp/rapport-jeu-artillery.json
npm run perf:game
```

Pour comparer une charge normale et des reponses plus etalees dans le temps :

```bash
PERF_PLAYERS=30 PERF_LAG_MS=800 PERF_REPORT=/tmp/rapport-jeu-standard.json npm run perf:game
PERF_PLAYERS=30 PERF_LAG_MS=3000 PERF_REPORT=/tmp/rapport-jeu-lent.json npm run perf:game
```

Le jeton est le **Firebase ID token** du compte proprietaire du quiz, et non une cle API Firebase. Une fois connecte a l'application, il est consultable dans les outils de developpement du navigateur, sous Application > IndexedDB > `firebaseLocalStorageDb` > `firebaseLocalStorage` > `stsTokenManager.accessToken`. C'est un secret temporaire : ne le placez pas dans le depot et renouvelez-le s'il expire. Les joueurs du test rejoignent le salon sans compte. Artillery enregistre le rapport JSON indique par `PERF_REPORT` et donne un code de sortie non nul si un joueur ou un controle metier echoue. Le scenario detaille precedent reste disponible avec `npm run perf:game:consistency` (options `--players`, `--lag-ms`, `--report`). Le delai d'envoi simule une latence et des temps de reaction variables ; pour mesurer l'effet d'une mauvaise connexion reelle, executez aussi le test depuis un reseau distant ou avec un proxy de limitation reseau. Aucun des deux tests ne mesure le rendu graphique dans un navigateur.

Le scenario d'autocompletion recherche une valeur dans les suggestions visibles, la selectionne, puis l'envoie comme le ferait le joueur. Les mauvaises reponses sont elles aussi choisies dans le dictionnaire. L'organisateur attend que toutes les reponses soient comptabilisees avant de passer au resultat suivant, qui reste affiche 3 secondes (`PERF_REVEAL_MS` pour ajuster). Le seuil par defaut du temps de reception du resultat est de 10 secondes au p95 (`PERF_RESULT_P95_MAX_MS` pour l'ajuster). Le rapport doit aussi compter 30 joueurs virtuels termines, aucune erreur et un resultat pour chaque joueur et chaque question. Ce test Socket.IO ne simule pas un clic dans un navigateur et ne mesure pas le rendu graphique.

## Thèmes visuels

Le thème actif est choisi côté serveur avec la variable `APP_THEME` :

```bash
APP_THEME=studio
```

Cinq variantes sont disponibles :

- `studio` (défaut) : création claire, jeu anthracite, accents citron et corail ;
- `academy` : thème chaleureux et pédagogique, inspiré du second visuel ;
- `cosmic` : thème sombre et compétitif, inspiré du premier visuel ;
- `orbit` : thème pastel et ludique, inspiré du troisième visuel ;
- `arcade` : thème original à fort contraste, inspiré des jeux télévisés rétro.

Après une modification de `APP_THEME`, redémarrez le serveur local ou redéployez le service Render. Pour comparer ponctuellement un thème sans toucher à la configuration, ajoutez par exemple `?theme=studio` ou `?theme=cosmic` à l'URL. Cette option ne modifie pas le thème des autres visiteurs. Sur un service Render existant, mettez explicitement `APP_THEME=studio` si une autre valeur est déjà enregistrée.

L'éditeur affiche une question active, avec les indices au centre et les réponses à droite. Les paramètres du quiz sont dans « Réglages ». Le suivi de la refonte et les contrôles visuels sont dans [l'audit Studio](docs/design/audit-graphique-2026-10-06/AUDIT.md).

## Reprendre une partie

Après connexion avec le compte créateur, ouvrez **Quiz en cours**, à côté de **Mes quiz** et **Dictionnaires**. Cet onglet liste vos salons en attente et vos parties non terminées, avec leur code, leur état et leur progression. **Actualiser** recharge la liste ; **Reprendre** ouvre le salon existant, sans créer de nouvelle partie.

Les joueurs, les réponses enregistrées, les scores et l'ordre des questions sont conservés. Le temps de réponse continue de s'écouler pendant l'absence de l'animateur : une question déjà expirée affiche son résultat à la reprise. Après un redémarrage du serveur, le minuteur est rétabli depuis son échéance enregistrée, jamais remis à zéro. Les parties terminées ne figurent pas dans cet onglet. La modification ou la suppression du quiz supprime toujours ses salons, comme auparavant.

Les joueurs continuent à participer sans compte. La liste des parties et leur pilotage sont réservés à leur propriétaire.

Vérifications locales : `npm run test:rooms` (isolation des comptes et échéances), `npm run test:timing` (indices et révélation). Le scénario navigateur `node output/playwright/resume-rooms/verify.mjs` utilise Chrome, le serveur local sur le port 4200 et des données fictives ; il ne touche pas aux données Firebase.

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
