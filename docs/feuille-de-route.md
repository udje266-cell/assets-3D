# Feuille de route

> Reprend les §21 à §23 et §26 du cahier des charges, en indiquant ce qui est
> déjà livré dans ce dépôt et ce qui reste à faire.

## État actuel

Les quatre briques du §17 sont en place : base de données, règles métier, API,
interface d'administration et les deux applications mobiles. Les applications
mobiles ne portent aucune règle métier — elles consomment l'API décrite dans
`docs/api.md`.

Ce qui reste tient à des **dépendances externes** (prestataire de paiement,
cartographie, passerelle SMS, stockage de documents) et à ce qui ne peut être
validé qu'**en conditions réelles** : essais sur appareils, campagne de tests
utilisateurs, publication sur les magasins d'applications.

Autrement dit, le code n'est plus le chemin critique : ce sont l'étude
réglementaire (§28) et le choix du prestataire de paiement (§9), dont les délais
se comptent en semaines, qui conditionnent la suite.

| Livrable attendu (§27) | État |
|---|---|
| Maquettes UX/UI | Non produites : les écrans ont été dessinés directement en code |
| Application client | **Livrée** (`apps/mobile-client`) |
| Application chauffeur | **Livrée** (`apps/mobile-driver`) |
| Backend / API | **Livré** |
| Base de données | **Livré** |
| Interface d'administration | **Livré** |
| Intégration cartographique | Contrat défini, fournisseur à brancher |
| Intégration des paiements | Contrat défini, prestataire à brancher |
| Documentation technique | **Livré** (`docs/`) |
| Documentation utilisateur et administrateur | **Livrée** (`guide-utilisateur.md`, `guide-administrateur.md`) |
| Procédure de maintenance et de sauvegarde | **Livrée** (`exploitation.md`) |
| Rapport de tests avant mise en production | Suite automatisée livrée ; campagne à conduire |

## MVP — première version (§21)

| Fonction | État |
|---|---|
| Client : inscription par OTP | **Livré** |
| Client : position, départ/destination, estimation | **Livré** |
| Client : commande, suivi temps réel, historique | **Livré** |
| Client : paiement, notation | **Livré** |
| Chauffeur : inscription, dépôt de documents | **Livré** |
| Chauffeur : validation par l'administration | **Livré** |
| Chauffeur : disponibilité, réception de courses | **Livré** |
| Chauffeur : historique et revenus | **Livré** |
| Administration : tableau de bord, chauffeurs, clients, courses, tarifs, paiements, statistiques | **Livré** |
| Applications mobiles | **Livrées** |
| Navigation embarquée | **Livrée** — l'écran de course ouvre l'application de navigation du téléphone |
| Position en arrière-plan pendant une course | **Livrée** — suivi écran éteint, arrêté hors course |
| Notifications push | Enregistrées côté serveur ; FCM/APNs à brancher |
| Téléversement des documents chauffeur | L'écran transmet une URL ; dépôt de fichier à brancher |

Le §21 demande de « privilégier la fiabilité des courses et des paiements avant
l'ajout de fonctionnalités secondaires ». C'est la raison pour laquelle le
travail a porté d'abord sur la machine à états, la comptabilité et l'audit
plutôt que sur des fonctions annexes.

## Phase 2 (§22)

| Fonction | État |
|---|---|
| Portefeuille chauffeur | **Livré** |
| Promotions | **Livré** |
| Catégories de véhicules | **Livré** |
| Parrainage | À faire |
| Réservation à l'avance | À faire — ajouter `scheduled_at` sur `rides` et une file de déclenchement |
| Livraison, transport de colis | À faire — nouvelles catégories et cycle de vie dérivé |
| Comptes entreprises | À faire — entité `organizations`, facturation groupée |

## Phase 3 (§23)

Abonnements chauffeurs, publicité, API entreprises, programme de fidélité,
optimisation avancée de l'attribution, prédiction de la demande, expansion
géographique. Rien n'est engagé ; le modèle de tarification par zone
(`pricing_rules.zone_code`) et le score d'attribution paramétrable ont toutefois
été prévus pour ne pas bloquer ces évolutions.

## Organisation du projet (§26)

| Phase | Contenu | État |
|---|---|---|
| 1 | Étude réglementaire et commerciale | À conduire — voir §28 et ci-dessous |
| 2 | Conception UX/UI | Écrans réalisés en code ; pas de maquettes formelles |
| 3 | Architecture technique et base de données | **Fait** |
| 4 | Développement du MVP | **Fait** — reste les essais sur appareils |
| 5 | Intégration paiements et cartographie | Adaptateurs prêts, prestataires à choisir |
| 6 | Tests techniques, sécurité, tests utilisateurs | Suite automatisée en place ; audit externe à prévoir |
| 7 | Recrutement et vérification des chauffeurs | Outillage d'administration prêt |
| 8 | Lancement pilote sur une zone limitée | À faire |
| 9 | Analyse des indicateurs et amélioration | Indicateurs disponibles |
| 10 | Déploiement à plus grande échelle | À faire |

## Ce qu'il faut trancher avant le lancement

1. **Conformité (§28).** Les obligations applicables en Côte d'Ivoire —
   transport, chauffeurs, véhicules, assurances, fiscalité, paiements
   électroniques, protection des données — doivent être confirmées auprès des
   autorités compétentes et d'un conseil juridique local. Le code n'en préjuge
   pas : la liste des documents exigés est une donnée (`driver_documents.doc_type`),
   pas une contrainte figée.
2. **Prestataire de paiement.** Le §9 impose de passer par un prestataire agréé.
   Le choix conditionne les délais de règlement et donc les règles de retrait.
3. **Fournisseur cartographique.** Le calcul d'itinéraire actuel est une
   approximation acceptable pour un pilote sur zone restreinte, pas pour une
   facturation à grande échelle.
4. **Grille tarifaire réelle.** Les valeurs du jeu de données initial sont des
   ordres de grandeur, pas une étude de marché.
5. **Politique de rétention des données de localisation.** La trace GPS de
   chaque course est une donnée personnelle sensible : sa durée de conservation
   doit être décidée et documentée.
6. **Comptes de publication.** Apple Developer et Google Play, identifiants de
   paquets (`ci.mobilite.client`, `ci.mobilite.driver`), visuels d'icône et
   d'écran de lancement — ceux du gabarit Expo sont en place.
7. **Essais sur appareils.** L'intégration continue vérifie le typage et
   construit le paquet JavaScript des deux applications, ce qui ne remplace pas
   un essai réel : GPS en conditions urbaines, coupures réseau, autonomie sur
   une journée de service.

## Sur les chiffres du §25

Le cahier des charges présente une simulation : 5 000 courses par jour à
5 000 FCFA, soit 750 millions de FCFA sur trente jours et 150 millions de revenus
bruts à 20 % de commission. Le document précise lui-même qu'il s'agit d'une
simulation et non d'une prévision.

Deux points méritent d'être gardés à l'esprit dans le pilotage :

- 5 000 courses par jour représentent un marché déjà installé, pas un lancement.
  Les indicateurs du §24 sont là pour mesurer la trajectoire réelle, et la marge
  affichée par le tableau de bord est une marge **brute** de commission.
- Le revenu net exige de déduire personnel, infrastructure, marketing, frais de
  paiement, support, promotions, fraude et fiscalité — ce que le §25 rappelle.
  Le tableau de bord ne les connaît pas ; les coûts d'acquisition sont
  volontairement renvoyés vides plutôt qu'estimés.
