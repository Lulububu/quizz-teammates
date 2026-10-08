# Projet Quiz Teammates

## Objectif

Creer un site web proche de Kahoot permettant :

- de creer des quiz ;
- de creer un salon de jeu ;
- de rejoindre le salon via un QR code ou un code court ;
- d'afficher le classement au fil des questions ;
- d'afficher un classement final.

La mecanique differenciee du quiz est la suivante : pour chaque manche, les joueurs doivent d'abord deviner trois oeuvres a partir d'indices, puis deviner la personne reliee a ces trois oeuvres. Chaque question peut utiliser un QCM a quatre propositions ou une recherche avec autocompletion.

## Stack retenue

- Frontend : Angular standalone.
- Backend : Express.
- Temps reel : Socket.IO.
- Base de donnees : Firestore.
- Authentification admin : Firebase Auth Google cote client et verification d'ID token Firebase cote serveur.

## Modele metier

- `quiz` : ensemble publie ou brouillon de manches.
- `admin_user` : compte Google createur de quiz.
- `round` : manche rattachee a un quiz, associee a une personne cible.
- `work` : oeuvre a deviner dans une manche, avec un type optionnel : jeu video, film, livre, serie, musique, autre.
- `clue` : indice rattache a une oeuvre, sous forme texte, image, audio, video ou lien. Une oeuvre peut avoir plusieurs indices.
- `answer_option` : proposition de reponse rattachee a une oeuvre ou a une personne cible, avec une seule bonne reponse par question.
- `answer_dictionary` : dictionnaire nomme de reponses admin, saisi sous forme de liste de valeurs separees par des sauts de ligne et utilise pour l'autocompletion.
- `person` : personne cible a trouver apres les trois oeuvres.
- `room` : salon de jeu cree depuis un quiz, avec etat de partie, question active et timer serveur.
- `player` : joueur dans un salon.
- `answer` : reponse donnee par un joueur.

## Regles retenues pour la premiere version

- Une manche contient exactement trois oeuvres.
- Une manche a une seule personne cible.
- Chaque question choisit un mode de reponse : quatre propositions ou recherche avec autocompletion.
- En mode QCM, chaque oeuvre et chaque personne cible ont quatre propositions, dont une bonne.
- En mode recherche, chaque oeuvre et chaque personne cible ont une bonne reponse textuelle ; les joueurs cherchent dans le dictionnaire de reponses choisi pour la question, ou dans tous les dictionnaires si aucun dictionnaire precis n'est selectionne.
- Le score est calcule cote serveur.
- Bonne oeuvre trouvee : 100 points.
- Personne cible trouvee : 300 points.
- Le classement est recalcule apres chaque reponse valide.
- La validation se fait par option QCM choisie ou par comparaison de la valeur selectionnee en autocompletion.
- Les indices peuvent etre saisis comme texte ou televerses dans Cloudinary sous forme d'image, de son ou de video.
- Les limites sont de 5 Mo pour une image, 10 Mo pour un son et 20 Mo pour une video.
- Lorsqu'une oeuvre a plusieurs indices, ils sont reveles progressivement pendant la question. L'intervalle est calcule selon le nombre d'indices et le temps disponible.
- Les quiz appartiennent a un seul compte Google createur. Un autre compte ne peut pas les lister, les consulter, les modifier, les supprimer ou creer un salon depuis ceux-ci.
- Les joueurs rejoignent toujours une partie sans compte, uniquement avec le code ou le QR code.

## Deroulement de partie

- Le quiz choisit un mode de déroulement :
  - par manche : les trois œuvres sont suivies immédiatement de la personne reliée ;
  - œuvres mélangées : toutes les œuvres sont présentées dans un ordre aléatoire, puis toutes les questions sur les personnes sont regroupées à la fin.
- L'ordre aléatoire est généré une seule fois à la création du salon et reste identique pour tous les joueurs.
- Un quiz peut masquer les pseudos dans les classements. Chaque joueur reçoit alors un emoji animal ou fruit stable à son inscription, utilisé sur les tops, podiums et classements finaux.
- L'organisateur peut activer ou désactiver ce masquage à tout moment depuis le bandeau du salon.
- Si les pseudos sont masqués au classement final, l'écran animateur révèle les identités en terminant par le 3e, le 2e puis le 1er.
- Le salon demarre en etat `lobby`.
- Les joueurs rejoignent avec le QR code ou le code court.
- L'animateur lance le quiz quand il le souhaite.
- Les questions sont affichees une par une aux joueurs.
- Chaque question a un timer serveur de 40 secondes.
- Si tous les joueurs ont repondu, la question se termine sans attendre la fin du timer.
- A la fin du timer, ou lorsque tous les joueurs ont repondu, la bonne reponse est revelee a tout le monde.
- Les points dependent de la rapidite : une bonne reponse conserve au minimum 50% des points de base et peut monter a 100% si elle est donnee tres vite.
- La question personne rappelle les noms des trois œuvres, sans réafficher leurs indices.
- L'animateur passe manuellement a la question suivante apres la revelation.
- Les joueurs ne voient pas le classement complet pendant la partie ; ils voient leur resultat, leurs points gagnes et leur position apres chaque question.
- Les joueurs voient aussi leur total de points apres chaque question.
- L'animateur voit le top 5 a chaque revelation.
- Le classement final cote animateur est presente comme un podium, avec revelation visuelle du 3e, puis du 2e, puis du 1er.

## Parcours utilisateur

### Createur / animateur

1. Cree un quiz.
2. Ajoute des manches.
3. Administre au besoin plusieurs dictionnaires nommes, chacun avec une valeur par ligne.
4. Pour chaque manche, renseigne trois oeuvres, leurs indices, le mode de chaque question, les propositions QCM ou la bonne reponse textuelle, puis la personne cible.
6. Cree un salon depuis le quiz.
7. Partage le QR code ou le code court.
8. Lance les questions et suit le classement.

### Joueur

1. Rejoint un salon via QR code ou code court.
2. Saisit un pseudo.
3. Repond aux trois oeuvres.
4. Repond a la personne cible selon le mode du quiz apres la revelation des trois oeuvres.
5. Consulte son resultat, ses points et sa position apres chaque question.

## Etat d'avancement

- [x] Structure de projet Angular + Express.
- [x] Persistance Firestore.
- [x] API de creation de quiz, manches et salons.
- [x] Socket.IO pour rejoindre un salon, envoyer une reponse et recevoir le classement.
- [x] Interface Angular pour creer un quiz QCM, creer un salon, piloter le lancement et rejoindre une partie.
- [x] Mode de reponse par recherche avec autocompletion selectionnable question par question.
- [x] Administration de plusieurs dictionnaires nommes par compte createur.
- [x] QR code genere cote serveur pour l'URL de participation.
- [x] Verification locale : creation d'un quiz de demo, creation d'un salon, inscription d'un joueur et scoring d'une bonne reponse.
- [x] Deroulement serveur type Kahoot : lancement animateur, question active, timer, revelation, question suivante.
- [x] Fin anticipee d'une question quand tous les joueurs ont repondu.
- [x] Bonus de points selon la rapidite de reponse.
- [x] Resultat individuel anime cote joueur apres revelation.
- [x] Total de points joueur affiche apres chaque question.
- [x] Top 5 animateur a chaque revelation et classement complet seulement en fin de partie.
- [x] Podium final dedie cote animateur.
- [x] Rendu des indices image lorsque le contenu est une URL d'image.
- [x] Saisie de plusieurs indices par oeuvre.
- [x] Revelation progressive des indices pendant le timer.
- [x] Suppression des champs de creation d'oeuvre non utilises ; le titre technique de l'oeuvre est derive de la bonne proposition.
- [x] Authentification Firebase/Google pour les createurs de quiz.
- [x] Isolation des quiz par compte createur.
- [x] Acces joueur sans compte conserve.
- [x] Migration de SQLite vers Firestore pour un deploiement Render sans disque persistant.
- [x] Configuration Render via `render.yaml`.
- [x] Upload signe et stockage Cloudinary des indices image, audio et video.
- [x] Optimisation du jeu temps reel : diffusions regroupees, lectures Firestore evitees et accuse de reponse apres enregistrement.
- [x] Interface Studio : éditeur question par question et scène animateur adaptée à l'écran.
- [x] Tests automatisés ciblés : timing, reveal et parcours graphiques locaux avec Playwright.

## Refonte Studio, 7 octobre 2026

- Studio devient le thème par défaut, sélectionnable avec `APP_THEME=studio` ou ponctuellement `?theme=studio`.
- Création claire, jeu anthracite, accents citron et corail, icônes Lucide.
- Édition d'une seule question à la fois, réglages séparés, indices sélectionnables avec leur horaire d'apparition, aperçu et navigation directe vers la question en erreur.
- Commandes d'enregistrement accessibles pendant le défilement ; navigation des questions repliable sur mobile.
- Bibliothèque simplifiée : lancement, édition et menu duplication/export/suppression.
- Scène animateur dimensionnée à la fenêtre ; médias complets et indices futurs masqués.
- Joueur : choix explicite, envoi neutre, confirmation, score et rang personnel ; une confirmation tardive ne bloque plus la question suivante.
- Podium 2–1–3 conservant la révélation 3, puis 2, puis 1 et la synchronisation des identités.
- Contrôles locaux sur Chrome avec données fictives et services simulés, sans modification de comptes ou de quiz distants. Les tests de charge Render ne sont pas relancés dans cette passe graphique.

Maquettes, suivi et résultats détaillés : [audit Studio](design/audit-graphique-2026-10-06/AUDIT.md).

## Reprise des parties et autocomplétion, 7 octobre 2026

- [x] Suggestions longues intégralement affichées sur plusieurs lignes, avec une liste défilante sans écrasement des lignes. Même traitement dans l'éditeur et en jeu ; la réponse sélectionnée n'est plus limitée à deux lignes.
- [x] Onglet **Quiz en cours** : code, titre, état, progression et date ; chargement, erreur, liste vide et actualisation manuelle.
- [x] Liste limitée aux quiz du compte connecté, incluant les anciens salons sans migration de données ; parties terminées exclues.
- [x] Reprise du salon existant après restauration de l'authentification, sans réinitialiser les réponses, les scores ou l'ordre des questions.
- [x] Reconnexion de l'animateur après coupure réseau, gestion des échecs et bouton Réessayer ; désabonnement du salon à la sortie.
- [x] Rétablissement du minuteur après redémarrage serveur à partir de l'échéance persistée ; révélation immédiate si elle est dépassée.
- [x] Tests de dépôt avec Firestore simulé : filtrage propriétaire/statut, anciennes données, lots de requêtes et échéances.
- [x] Contrôles navigateur des deux ajouts et non-régression Studio réussis. Sept tests unitaires passent ; accès anonyme à la liste refusé (401). Services simulés pour les parcours, pas de test sur Render dans cette passe.

Le temps continue pendant l'absence de l'animateur : il s'agit d'une reprise, pas d'une pause. La suppression des salons lors de la modification/suppression d'un quiz reste inchangée.

## Navigation des quiz longs, 7 octobre 2026

- [x] Sur ordinateur, liste des manches et formulaire dans deux zones de défilement indépendantes, limitées à la hauteur disponible.
- [x] Enregistrement, onglets Questions/Réglages et ajout d'une manche restent accessibles sans parcourir la liste complète.
- [x] La sélection d'une question ramène son formulaire en haut ; les ajouts, duplications et erreurs de validation rendent la question concernée visible dans la navigation.
- [x] Sur mobile, liste verticale repliable de hauteur limitée, réouverture sur la sélection courante sous le bandeau fixe.
- [x] Contrôles Playwright avec 40 manches : sélection de la dernière, modification, défilements indépendants, duplication/ajout, validation en erreur, clavier, cinq thèmes et fenêtres bureau/tablette/mobile. Aucune exception navigateur ni débordement horizontal.

Scénario et captures : `output/playwright/editor-scroll/`. Données fictives uniquement, aucun quiz distant modifié.

## Espacements des composants, 7 octobre 2026

- [x] Accueil Studio : espace de 40 px entre le séparateur et le bloc de connexion ; sur tablette et mobile, séparation horizontale avec 24 px au-dessus du contenu.
- [x] Dictionnaires : colonnes identifiées par des classes dédiées, marge intérieure du séparateur rétablie et actions pouvant revenir à la ligne. Suppression des styles de panneau hérités sur les sections non encadrées.
- [x] Marges horizontales des onglets, avertissements de l'éditeur, confirmations d'envoi, réponses révélées, statistiques animateur, classement final et lecteur audio joueur harmonisées.
- [x] Autocomplétion Cosmic : suppression du fond du conteneur structurel ; champs, suggestions et sélection conservent leurs surfaces propres.
- [x] Vérifications Chrome/Playwright sur les cinq thèmes, avec fenêtres bureau, tablette et mobile ; non-régression de l'éditeur à 40 manches. Compilation client/serveur réussie, avertissement de taille du paquet initial inchangé.

Scénario, mesures et captures : `output/playwright/spacing/`. Services simulés : aucune donnée Firebase modifiée. Cette passe ne modifie pas l'authentification.

## Partage et pause, 8 octobre 2026

- [x] QR code centré dans le bloc de démarrage, carré et stable avec des nombres de participants différents de chaque côté, sur ordinateur et mobile.
- [x] Copie du lien dans le contenu principal ; composant partagé avec le popover, confirmation et erreur de presse-papiers visibles.
- [x] Fermeture du popover par clic extérieur ou Échap, avec retour du focus au déclencheur au clavier.
- [x] Pause/reprise réservée au propriétaire de la partie. Bouton d'attente pendant la commande et message d'erreur si elle n'est pas confirmée.
- [x] Champ Firestore optionnel `question_paused_at`, exposé via `questionPausedAt`. Les anciens salons sans ce champ restent compatibles ; pas de migration nécessaire.
- [x] Minuteur et indices figés côté animateur/joueurs, réponses refusées pendant la pause, choix joueur préservé. Lecture audio/vidéo animateur suspendue puis reprise sans recommencer l'extrait.
- [x] Reprise par décalage du début et de la fin de question : même temps restant, mêmes intervalles d'indices et même bonus de rapidité. La pause survit à la reconnexion et n'est pas levée par la restauration du minuteur.
- [x] Réponse et points enregistrés ensemble, avec contrôle transactionnel de la question active, de la pause, de l'échéance et des doublons. Un ancien minuteur ne peut pas révéler une question pausée ou déjà remplacée.
- [x] 11 tests automatisés de pause/rythme/reprise ; parcours Socket.IO réel local avec authentification et Firestore simulés, incluant l'autocomplétion et la révélation après toutes les réponses. Aucun test de charge Render ni écriture Firebase réelle.
- [x] Contrôles Chrome sur cinq thèmes, QR centré à 390 / 768 / 840 / 1440 / 1920 px, popover au clavier et à la souris, erreurs simulées, média réellement joué, pause et reprise. Rapport et captures : `output/playwright/game-controls/`.

Compilation client/serveur réussie ; avertissement de taille du paquet initial toujours présent (693,88 ko pour un seuil de 614,40 ko). Redéployer client et serveur ensemble pour activer la pause sur Render.

## Validation technique

- `npm run typecheck` passe.
- Test de charge local Artillery apres optimisation : 30 joueurs, 4 questions, 120 resultats recus, aucun echec. Accuse de reponse p95 1,4 s et resultat p95 2,6 s. Le quiz temporaire a ete supprime. Une validation sur Render reste a faire apres deploiement.
- Le serveur Express tourne sur `http://localhost:3000`.
- Le salon de demo QCM cree pendant la validation a le code `1WQLMA`.
- Le parcours teste : creation d'un quiz QCM, creation d'un salon, lancement de partie, reponse QCM correcte, scoring, revelation automatique apres timer et affichage animateur dans le navigateur integre.

## Questions ouvertes

- Faut-il accepter des variantes de reponses ou seulement une reponse exacte ?
- Le jeu est-il anime par un maitre du jeu, ou les joueurs avancent-ils chacun a leur rythme ?
- Les scores doivent-ils tenir compte de la rapidite de reponse ?
- Les personnes reliees aux oeuvres sont-elles des membres d'une equipe, des celebrites, des auteurs, ou tout type de personne ?
