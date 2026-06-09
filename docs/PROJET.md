# Projet Quizz Teammates

## Objectif

Creer un site web proche de Kahoot permettant :

- de creer des quiz ;
- de creer un salon de jeu ;
- de rejoindre le salon via un QR code ou un code court ;
- d'afficher le classement au fil des questions ;
- d'afficher un classement final.

La mecanique differenciee du quiz est la suivante : pour chaque manche, les joueurs doivent d'abord deviner trois oeuvres a partir d'indices, puis deviner la personne reliee a ces trois oeuvres. Chaque question est un QCM a quatre propositions.

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
- `person` : personne cible a trouver apres les trois oeuvres.
- `room` : salon de jeu cree depuis un quiz, avec etat de partie, question active et timer serveur.
- `player` : joueur dans un salon.
- `answer` : reponse donnee par un joueur.

## Regles retenues pour la premiere version

- Une manche contient exactement trois oeuvres.
- Une manche a une seule personne cible.
- Chaque oeuvre a quatre propositions de reponse, dont une bonne.
- La question personne a quatre propositions de reponse, dont une bonne.
- Le score est calcule cote serveur.
- Bonne oeuvre trouvee : 100 points.
- Personne cible trouvee : 300 points.
- Le classement est recalcule apres chaque reponse valide.
- La validation se fait par option QCM choisie, pas par saisie libre.
- Les indices sont stockes comme texte ou URL ; l'upload de fichiers viendra ensuite.
- Lorsqu'une oeuvre a plusieurs indices, ils sont reveles progressivement pendant la question. L'intervalle est calcule selon le nombre d'indices et le temps disponible.
- Les quiz appartiennent a un seul compte Google createur. Un autre compte ne peut pas les lister, les consulter, les modifier, les supprimer ou creer un salon depuis ceux-ci.
- Les joueurs rejoignent toujours une partie sans compte, uniquement avec le code ou le QR code.

## Deroulement de partie

- Le salon demarre en etat `lobby`.
- Les joueurs rejoignent avec le QR code ou le code court.
- L'animateur lance le quiz quand il le souhaite.
- Les questions sont affichees une par une aux joueurs.
- Chaque question a un timer serveur de 20 secondes.
- Si tous les joueurs ont repondu, la question se termine sans attendre la fin du timer.
- A la fin du timer, ou lorsque tous les joueurs ont repondu, la bonne reponse est revelee a tout le monde.
- Les points dependent de la rapidite : une bonne reponse conserve au minimum 50% des points de base et peut monter a 100% si elle est donnee tres vite.
- Apres les trois questions d'oeuvres, la quatrieme question de la manche affiche les trois oeuvres et leurs indices, puis demande la personne reliee avec quatre propositions.
- L'animateur passe manuellement a la question suivante apres la revelation.
- Les joueurs ne voient pas le classement complet pendant la partie ; ils voient leur resultat, leurs points gagnes et leur position apres chaque question.
- Les joueurs voient aussi leur total de points apres chaque question.
- L'animateur voit le top 5 a chaque revelation.
- Le classement final cote animateur est presente comme un podium, avec revelation visuelle du 3e, puis du 2e, puis du 1er.

## Parcours utilisateur

### Createur / animateur

1. Cree un quiz.
2. Ajoute des manches.
3. Pour chaque manche, renseigne trois oeuvres, leurs indices, quatre propositions pour chaque oeuvre, la bonne proposition, puis la personne cible avec ses quatre propositions.
4. Cree un salon depuis le quiz.
5. Partage le QR code ou le code court.
6. Lance les questions et suit le classement.

### Joueur

1. Rejoint un salon via QR code ou code court.
2. Saisit un pseudo.
3. Repond aux trois oeuvres.
4. Repond a la personne cible parmi quatre propositions apres la revelation des trois oeuvres.
5. Consulte son resultat, ses points et sa position apres chaque question.

## Etat d'avancement

- [x] Structure de projet Angular + Express.
- [x] Persistance Firestore.
- [x] API de creation de quiz, manches et salons.
- [x] Socket.IO pour rejoindre un salon, envoyer une reponse et recevoir le classement.
- [x] Interface Angular pour creer un quiz QCM, creer un salon, piloter le lancement et rejoindre une partie.
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
- [ ] Upload et stockage des fichiers media.
- [ ] Interface avancee d'animation question par question.
- [ ] Tests automatises.

## Validation technique

- `npm run typecheck` passe.
- Le serveur Express tourne sur `http://localhost:3000`.
- Le salon de demo QCM cree pendant la validation a le code `1WQLMA`.
- Le parcours teste : creation d'un quiz QCM, creation d'un salon, lancement de partie, reponse QCM correcte, scoring, revelation automatique apres timer et affichage animateur dans le navigateur integre.

## Questions ouvertes

- Faut-il accepter des variantes de reponses ou seulement une reponse exacte ?
- Le jeu est-il anime par un maitre du jeu, ou les joueurs avancent-ils chacun a leur rythme ?
- Les scores doivent-ils tenir compte de la rapidite de reponse ?
- Les personnes reliees aux oeuvres sont-elles des membres d'une equipe, des celebrites, des auteurs, ou tout type de personne ?
- Les indices audio/image doivent-ils etre uploades dans l'application ou fournis par URL ?
