# Indices - Quiz sondage - 3 œuvres préférées

Espace genere automatiquement depuis `data/generated/quiz-sondage-autocomplete-preview.json`.

## Contenu

- `index.csv` : suivi rapide des oeuvres.
- `index.json` : plan structure des indices.
- `oeuvres/` : un dossier par oeuvre avec manifeste et fiche de preparation.

- `sources/suggestions-web.json` dans chaque dossier concerne : suggestions TMDB, jeuxvideo.com, YouTube ou livres.

## Repartition

- livre : 5

## Utilisation conseillee

1. Ouvrir `index.csv` pour prioriser les oeuvres.
2. Completer les fichiers ou textes dans chaque dossier d'oeuvre.
3. Uploader les fichiers finaux via l'interface d'edition du quiz.
4. Remplacer les indices temporaires par les URLs Cloudinary ou les textes retenus.

Le script cree une structure de travail. Il ne telecharge pas automatiquement de contenus sous droits.

Le mode web specialise peut telecharger des images TMDB si `TMDB_API_KEY` est configure. Les liens YouTube et jeuxvideo.com sont fournis pour selection manuelle.
