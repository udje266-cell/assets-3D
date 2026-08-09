<!-- Transcription fidèle du cahier des charges fourni (Cahier_des_charges_plateforme_mobilite.docx).
     Document de référence : ne pas modifier le fond ici, les décisions de mise en œuvre
     sont documentées dans les autres fichiers de docs/. -->

# CAHIER DES CHARGES

Plateforme de mobilité et de réservation de transport

Projet inspiré des modèles de plateformes de mobilité à la demande (sans reproduction d’une solution propriétaire)

## 1. Présentation du projet

- Nom provisoire : à définir.
- Type : plateforme numérique de réservation de transport.
- Zone de lancement envisagée : Côte d’Ivoire.
- Plateformes : application mobile Android, application mobile iOS, interface web d’administration et backend/API centralisé.
- Objectif : mettre en relation des clients avec des chauffeurs disponibles, permettre la réservation et le suivi d’une course, le paiement et l’évaluation du service.

## 2. Applications et interfaces

- Application client : inscription, recherche d’itinéraire, estimation du prix, commande, suivi, paiement, historique et notation.
- Application chauffeur : inscription, vérification, disponibilité, réception et acceptation des courses, navigation, revenus et historique.
- Administration web : supervision de la plateforme, gestion des utilisateurs, chauffeurs, courses, tarifs, paiements, promotions, litiges et statistiques.

## 3. Application client

- Inscription par numéro de téléphone avec OTP, nom/prénom et adresse e-mail facultative.
- Accueil avec position actuelle, destination, estimation du prix, temps estimé et moyen de paiement.
- Commande : départ → destination → catégorie de véhicule → estimation → confirmation.
- Suivi en temps réel du chauffeur et accès aux informations du véhicule.
- Historique des courses, reçus, paiements et évaluations.

## 4. Géolocalisation

- Localisation GPS du client et du chauffeur.
- Calcul de distance et d’itinéraire.
- Estimation du temps d’arrivée.
- Suivi de la position du chauffeur pendant la course.
- Gestion des données de localisation conformément aux règles applicables.

## 5. Application chauffeur

- Création de compte et transmission des informations nécessaires.
- Documents possibles : identité, permis, documents du véhicule, assurance et immatriculation, sous réserve des exigences réglementaires applicables.
- Statut en ligne/hors ligne.
- Réception, acceptation ou refus des demandes de course.
- Navigation jusqu’au client puis jusqu’à la destination.
- Consultation de l’historique et des revenus.

## 6. Déroulement d’une course

- États principaux : demande → recherche chauffeur → chauffeur trouvé → chauffeur en route → chauffeur arrivé → passager à bord → course en cours → course terminée → paiement → évaluation.
- Chaque changement d’état doit être enregistré côté serveur afin de permettre le suivi, l’audit et la gestion des litiges.

## 7. Tarification

- Formule configurable : prix = tarif de base + distance × tarif/km + durée × tarif/minute.
- Les tarifs doivent être configurables depuis l’administration sans nécessiter de mise à jour de l’application.
- Le système doit permettre différentes catégories de véhicules et, si nécessaire, différentes grilles tarifaires.

## 8. Commission et revenus

- Le système calcule automatiquement la commission de la plateforme.
- Exemple indicatif : course de 5 000 FCFA avec commission de 20 % = 1 000 FCFA pour la plateforme et 4 000 FCFA pour le chauffeur, avant éventuels autres frais.
- Les montants doivent être enregistrés séparément pour faciliter la comptabilité et les rapprochements.

## 9. Paiements

- Moyens possibles selon les prestataires et autorisations disponibles : espèces, portefeuille électronique, carte bancaire et autres moyens locaux.
- Chaque transaction doit enregistrer le montant, le moyen de paiement, l’identifiant de transaction, le statut, la commission et la course associée.
- Les paiements électroniques doivent être intégrés via des prestataires de paiement appropriés plutôt que par un système bancaire construit directement par la plateforme.

## 10. Portefeuille chauffeur

- Chaque chauffeur dispose d’un solde permettant de suivre ses gains, commissions et retraits.
- Le système doit enregistrer les crédits, débits, retraits et statuts des opérations.
- Les règles de retrait doivent être configurables par l’administration.

## 11. Notation et signalement

- Le client peut noter le chauffeur de 1 à 5 étoiles.
- Le chauffeur peut noter le client de 1 à 5 étoiles.
- Possibilité de signaler un incident : comportement dangereux, problème de paiement, problème avec le véhicule, objet oublié ou autre problème.

## 12. Sécurité

- Authentification sécurisée et protection des comptes.
- Chiffrement des communications.
- Protection des données personnelles.
- Limitation des tentatives de connexion et détection des activités suspectes.
- Journalisation des événements importants.
- Fonctionnalités d’urgence et partage de course à étudier selon les exigences locales.

## 13. Promotions

- Création de codes promotionnels depuis l’administration.
- Paramètres : montant fixe ou pourcentage, nombre d’utilisations, dates de validité, utilisateurs concernés et plafond de réduction.
- Exemple : code BIENVENUE donnant une réduction sur la première course.

## 14. Administration

- Dashboard : courses, chauffeurs en ligne, clients actifs, volume de transactions, commissions et indicateurs clés.
- Gestion des chauffeurs : validation, suspension, documents, courses, revenus et évaluations.
- Gestion des clients : recherche, historique, suspension et assistance.
- Gestion des courses : statut, client, chauffeur, prix, trajet et paiement.
- Gestion des tarifs, promotions, paiements, remboursements et paramètres de la plateforme.

## 15. Gestion des litiges

- Création de tickets par les clients ou chauffeurs.
- Catégories : chauffeur absent, prix incorrect, paiement, objet oublié, incident, etc.
- Consultation des informations de la course et des événements associés.
- Possibilité de contacter les parties, effectuer un remboursement lorsque justifié et clôturer le dossier.

## 16. Notifications

- Client : chauffeur trouvé, chauffeur arrivé, course commencée, course terminée, paiement, promotions.
- Chauffeur : nouvelle course, annulation, paiement, retrait, avertissement administratif.
- Les notifications peuvent être push, SMS ou autres selon le besoin et le coût.

## 17. Architecture technique

- Architecture recommandée : application client + application chauffeur + API/backend + base de données + services de géolocalisation + système de paiement + interface d’administration.
- Le backend centralise les utilisateurs, chauffeurs, véhicules, courses, positions, tarification, paiements, commissions, notifications, promotions et statistiques.
- Prévoir une architecture évolutive permettant d’augmenter progressivement le nombre d’utilisateurs et de courses.

## 18. Base de données

- Tables principales : USERS, DRIVERS, VEHICLES, DRIVER_DOCUMENTS, RIDES, RIDE_LOCATIONS, PAYMENTS, DRIVER_WALLETS, WITHDRAWALS, REVIEWS, PROMOTIONS, SUPPORT_TICKETS, NOTIFICATIONS et ADMIN_USERS.
- Chaque course doit avoir un identifiant unique.

## 19. Attribution des courses

- Le système recherche les chauffeurs disponibles dans une zone définie.
- Critères possibles : distance, disponibilité, catégorie de véhicule, temps estimé d’arrivée et règles opérationnelles.
- En cas de refus ou d’absence de réponse, la demande peut être proposée à un autre chauffeur selon la stratégie définie.

## 20. Modèle économique

- Sources de revenus possibles : commission sur les courses, frais de réservation, tarification dynamique, abonnements chauffeurs, publicité et services professionnels.
- Les taux et frais doivent être configurables.

## 21. MVP – Première version

- Client : inscription, GPS, départ/destination, estimation, commande, suivi, historique, paiement et notation.
- Chauffeur : inscription, validation, disponibilité, réception de courses, navigation, historique et revenus.
- Administration : dashboard, gestion chauffeurs, clients, courses, tarifs, paiements et statistiques.
- Le MVP doit privilégier la fiabilité des courses et des paiements avant l’ajout de fonctionnalités secondaires.

## 22. Phase 2

- Portefeuille, promotions, parrainage, réservation à l’avance, catégories de véhicules, livraison, transport de colis et comptes entreprises.

## 23. Phase 3

- Abonnements, publicité, API entreprises, programme de fidélité, optimisation avancée de l’attribution, prédiction de la demande et expansion vers d’autres villes ou pays.

## 24. Indicateurs clés de performance

- Nombre de courses, volume total des transactions (GMV), commissions, revenu plateforme, revenu moyen par course, chauffeurs actifs, clients actifs, taux d’annulation, temps moyen d’attente, taux d’acceptation, coût d’acquisition client, coût d’acquisition chauffeur et marge.

## 25. Exemple économique indicatif

- Hypothèse : 5 000 courses/jour à 5 000 FCFA en moyenne.
- Transactions : 25 000 000 FCFA/jour, soit 750 000 000 FCFA sur 30 jours.
- Avec une commission de 20 % : 150 000 000 FCFA de revenus bruts de plateforme sur cette hypothèse.
- Ces chiffres sont des simulations et ne constituent pas une prévision financière. Les coûts de personnel, infrastructure, marketing, paiement, support, promotions, fraude, fiscalité et autres charges doivent être déduits pour déterminer la rentabilité réelle.

## 26. Organisation du projet

- Phase 1 : étude réglementaire et commerciale.
- Phase 2 : conception UX/UI.
- Phase 3 : architecture technique et base de données.
- Phase 4 : développement du MVP.
- Phase 5 : intégration des paiements et services cartographiques.
- Phase 6 : tests techniques, sécurité et tests utilisateurs.
- Phase 7 : recrutement et vérification d’un premier réseau de chauffeurs.
- Phase 8 : lancement pilote dans une zone géographique limitée.
- Phase 9 : analyse des indicateurs et amélioration.
- Phase 10 : déploiement progressif à plus grande échelle.

## 27. Livrables attendus

- Maquettes UX/UI.
- Application client.
- Application chauffeur.
- Backend/API.
- Base de données.
- Interface d’administration.
- Intégration cartographique.
- Intégration des paiements.
- Documentation technique.
- Documentation utilisateur et administrateur.
- Procédure de maintenance et de sauvegarde.
- Rapport de tests avant mise en production.

## 28. Points réglementaires et opérationnels à valider

- Avant le lancement commercial, vérifier les obligations applicables en Côte d’Ivoire concernant le transport, les chauffeurs, les véhicules, les assurances, la fiscalité, les paiements électroniques, la protection des données personnelles et les conditions d’exploitation d’une plateforme numérique.
- Les exigences exactes doivent être confirmées avec les autorités compétentes et des conseils juridiques locaux ; elles ne sont pas détaillées ici comme des faits juridiques définitifs.

## 29. Conclusion

Le projet consiste à construire une plateforme complète de mobilité, et non uniquement une application mobile. La réussite dépendra autant de la technologie que de l’acquisition et de la gestion des chauffeurs, de l’acquisition des clients, du service client, des paiements, de la sécurité, de la conformité et de l’économie unitaire de chaque course.
