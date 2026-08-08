# Applications mobiles

> Répond aux §2, §3 et §5 du cahier des charges.

## 1. Deux applications, un seul contrat

```
apps/mobile-client   Application client   (§3)
apps/mobile-driver   Application chauffeur (§5)
packages/shared      Client d'API typé, formatage, canal temps réel, jetons visuels
```

Les deux applications sont écrites avec **Expo (SDK 57)** et **expo-router**.
Elles ne contiennent **aucune règle métier** : prix, transitions d'état,
commissions et éligibilité aux promotions sont calculés par le serveur. Une
application mobile s'installe lentement sur le parc des utilisateurs ; y placer
une règle tarifaire reviendrait à ne plus pouvoir la changer, ce que le §7
interdit explicitement.

`packages/shared` porte ce qui doit rester identique des deux côtés : la forme
des réponses de l'API, les libellés d'états (§6), le formatage des montants et
la connexion temps réel.

## 2. Démarrage

Les applications mobiles ont leur **propre arbre de dépendances**, séparé des
espaces de travail npm de l'API et de l'administration. Ce n'est pas une
commodité : le hissage npm supprimait des dépendances natives d'Expo lors de la
résolution des pairs, et un module natif manquant ne se voit qu'au moment du
paquet.

```bash
# API en cours d'exécution sur le poste (voir le README racine)
npm run dev

# Application client
cd apps/mobile-client
npm install
npm start          # puis « a » pour Android, « i » pour iOS

# Application chauffeur
cd apps/mobile-driver
npm install
npm start
```

L'adresse de l'API est déduite automatiquement de l'hôte qui sert le paquet de
développement (`src/config.ts`) : sur un téléphone physique, « localhost »
désignerait l'appareil lui-même. En production, elle vient de `extra.apiUrl`
dans `app.json`.

En développement, le serveur renvoie le code de vérification dans la réponse
HTTP (`OTP_DEBUG_RETURN=true`) ; l'écran de saisie le pré-remplit, ce qui évite
de brancher une passerelle SMS pour essayer le parcours.

## 3. Application client (§3)

| Écran | Fonction |
|---|---|
| `(auth)/phone` · `(auth)/otp` | Inscription et connexion par téléphone et code à usage unique. Le nom est demandé au premier passage. |
| `(tabs)/index` | Position de départ, destination posée sur la carte, estimation par catégorie, moyen de paiement, code promotionnel, confirmation. |
| `ride/[id]` | Suivi temps réel : état de la course, position du chauffeur, appel du chauffeur, paiement, notation, annulation. |
| `(tabs)/rides` | Historique, montants et reçus. |
| `(tabs)/profile` | Coordonnées, note reçue, déconnexion. |

**Choix de la destination.** Sans service de recherche d'adresses, la
destination se pose d'une pression sur la carte, avec un champ libre pour
l'intitulé lisible par le chauffeur. C'est un geste direct, qui fonctionne sans
annuaire de lieux ; brancher un service d'autocomplétion consistera à ajouter un
champ de recherche au-dessus de la carte, sans toucher au reste.

**Une seule course active.** Le §6 n'autorise qu'une course en cours par client,
et la base l'impose par un index unique partiel. L'écran de commande redirige
donc vers le suivi si une course est déjà en cours.

## 4. Application chauffeur (§5)

| Écran | Fonction |
|---|---|
| `(auth)/phone` · `(auth)/otp` | Inscription ; nom et prénom obligatoires, base du dossier de vérification. |
| `onboarding` | Déclaration du véhicule et transmission des documents ; état d'examen de chaque pièce. |
| `(tabs)/index` | Bascule en service, publication de la position, réception des offres avec compte à rebours, acceptation ou refus. |
| `ride/[id]` | Déroulement de la course : un seul bouton à la fois, correspondant à la transition autorisée. Décompte de la commission en fin de course. |
| `(tabs)/earnings` | Portefeuille, revenus sur trente jours, demande de retrait, grand livre des mouvements. |
| `(tabs)/history` | Historique avec la part revenant au chauffeur. |
| `(tabs)/profile` | Dossier, véhicule, documents, déconnexion. |

**Un seul bouton d'action.** Le chauffeur conduit : il n'a pas à choisir dans
une liste d'actions. L'écran de course expose la seule transition autorisée
depuis l'état courant, la machine à états du serveur restant l'autorité.

**Solde négatif.** Après une course réglée en espèces, le chauffeur a encaissé
la totalité mais ne doit conserver que sa part : son solde porte donc la
commission due. L'écran l'explique plutôt que d'afficher un nombre rouge sans
justification.

**Publication de la position.** Elle n'a lieu que lorsque le chauffeur est en
service. Le serveur écarte de l'attribution tout chauffeur dont la position date
de plus de deux minutes — sans elle, aucune course ne lui est proposée. La
position part par le canal temps réel et par l'API : la seconde voie garantit
l'enregistrement si le socket est coupé.

## 5. Temps réel et repli

Les deux applications ouvrent un canal Socket.IO authentifié par le même jeton
que l'API. Elles conservent **en plus** une interrogation périodique :

| Écran | Canal temps réel | Repli |
|---|---|---|
| Suivi client | états de course, position du chauffeur | rechargement toutes les 8 s |
| Service chauffeur | offres de course | interrogation toutes les 4 s |

Cette redondance est délibérée. Sur un réseau mobile qui coupe, un client qui ne
voit plus son chauffeur n'a que faire de la raison technique, et une offre
manquée coûte une course au chauffeur comme une attente au client.

## 6. Sécurité (§12)

- Les jetons sont conservés dans le trousseau sécurisé de l'appareil
  (`expo-secure-store` : Keychain sur iOS, Keystore sur Android), jamais dans le
  stockage applicatif ordinaire.
- Le jeton d'accès est court ; sa rotation est automatique et mutualisée entre
  requêtes concurrentes, le serveur révoquant toute la chaîne de sessions si un
  jeton de rafraîchissement est rejoué.
- Aucune donnée personnelle n'est mise en cache sur l'appareil au-delà de la
  session.
- Les écrans indiquent explicitement quand la position est transmise et
  pourquoi.

## 7. Ce qui reste à faire avant publication

| Sujet | État |
|---|---|
| Téléversement des documents chauffeur | L'écran transmet une URL. Brancher le dépôt de fichier sur l'espace de stockage retenu (URL signée) — l'application ne doit pas stocker de pièces d'identité. |
| Notifications push | Le serveur enregistre et journalise les notifications ; il reste à brancher FCM/APNs et à transmettre le jeton d'appareil via `PATCH /v1/{client,driver}/me`. |
| Navigation embarquée | Le §5 prévoit la navigation jusqu'au client puis à la destination : ouvrir l'application de navigation du téléphone depuis l'écran de course. |
| Recherche d'adresses | Champ d'autocomplétion au-dessus de la carte, une fois le fournisseur cartographique choisi. |
| Position en arrière-plan | `expo-task-manager` est déjà déclaré côté chauffeur ; la remontée écran éteint reste à activer, avec le service de premier plan Android correspondant. |
| Icônes et écrans de lancement | Les visuels sont ceux du gabarit Expo. |
| Traductions | L'interface est en français uniquement. |

## 8. Vérification

Aucun appareil n'étant disponible en intégration continue, la garantie repose
sur deux contrôles exécutés à chaque modification :

```bash
npm run typecheck   # dans chaque application
npm run bundle      # expo export : Metro résout et compile tout l'arbre
```

Le second est le plus utile : il échoue sur une importation invalide, une
dépendance native absente ou une erreur de syntaxe, dans n'importe quel fichier
atteignable depuis le point d'entrée. Il ne remplace pas un essai sur appareil,
qui reste nécessaire avant tout pilote.
