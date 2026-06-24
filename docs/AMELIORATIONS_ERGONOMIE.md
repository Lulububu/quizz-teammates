# Suivi des améliorations ergonomiques

Dernière mise à jour : 22 juin 2026

## Administration

- [x] Séparer `Mes quiz`, `Éditeur` et `Dictionnaires`.
- [x] Ajouter une entrée joueur par code sur l'accueil.
- [x] Replier et déplier les manches.
- [x] Dupliquer, supprimer et réordonner les manches.
- [x] Dupliquer une œuvre et sa configuration.
- [x] Afficher un résumé du quiz.
- [x] Garder les actions d'enregistrement visibles.
- [x] Prévenir en cas de modifications non enregistrées.
- [x] Prévisualiser les indices image.

## Dictionnaires

- [x] Importer un fichier texte ou CSV.
- [x] Afficher le nombre de valeurs et de doublons.
- [x] Rechercher et paginer l'aperçu.
- [x] Confirmer le remplacement d'un dictionnaire.
- [x] Afficher les quiz utilisant chaque dictionnaire.

## Joueur

- [x] Valider le pseudo localement.
- [x] Restaurer la session après actualisation.
- [x] Afficher la réponse envoyée.
- [x] Remplacer le compteur par une progression visuelle.
- [x] Fournir une autocomplétion accessible et filtrée.
- [x] Afficher les erreurs de salon.
- [x] Bloquer les arrivées après le lancement.

## Animateur

- [x] Afficher la liste des participants.
- [x] Retirer un participant du lobby.
- [x] Signaler les pseudos en double.
- [x] Copier le lien d'invitation.
- [x] Confirmer un lancement sans joueur.
- [x] Afficher les erreurs et les chargements des commandes.
- [x] Regrouper les indices de la question finale par œuvre.
- [x] Ne pas répéter l'indice courant dans l'historique.
- [x] Afficher le classement complet après le podium.

## Accessibilité et finition

- [x] Uniformiser le nom `Quiz Teammates`.
- [x] Renforcer les focus clavier et les zones tactiles.
- [x] Ne pas dépendre uniquement de la couleur.
- [x] Respecter `prefers-reduced-motion`.
- [x] Corriger les libellés et accents restants.
- [x] Vérifier la structure responsive desktop et mobile.

## Validation

- [x] `npm run typecheck`
- [x] `npm run build`
- [ ] Parcours public et joueur sur mobile.
- [ ] Parcours administrateur.
- [ ] Parcours animateur.

Le contrôle visuel dans le navigateur intégré reste à reprendre : la navigation locale a été bloquée par la politique du navigateur pendant la passe finale. Les gabarits, breakpoints et débordements statiques ont néanmoins été contrôlés.

## Médias

- [x] Téléversement Cloudinary signé des images.
- [x] Téléversement Cloudinary signé des sons.
- [x] Téléversement Cloudinary signé des vidéos.
- [x] Limites de taille et contrôle du type MIME.
- [x] Aperçu dans l'éditeur.
- [x] Lecteurs audio et vidéo côté joueur et animateur.
- [x] Signature serveur et configuration Render documentées.

## Recherche joueur

- [x] Question personne limitée aux noms des trois œuvres.
- [x] Index de recherche préparé une seule fois par question.
- [x] Liste de résultats intégrée au flux sans masquer le bouton de validation.
- [x] Sélection explicite avant validation.
- [x] État d'envoi visible et protection contre les doubles clics.
- [x] Dictionnaire volumineux envoyé uniquement au début de la question.
- [x] État neutre pendant le calcul du résultat afin d'éviter un faux message de mauvaise réponse.
