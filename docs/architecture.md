# Architecture technique

> Répond au §17 du cahier des charges.

## 1. Vue d'ensemble

```
┌───────────────┐   ┌───────────────┐   ┌────────────────────┐
│  App client   │   │ App chauffeur │   │  Admin web (React) │
│ (à réaliser)  │   │ (à réaliser)  │   │   apps/admin       │
└───────┬───────┘   └───────┬───────┘   └─────────┬──────────┘
        │  REST + WebSocket │                     │ REST
        └─────────┬─────────┴──────────┬──────────┘
                  ▼                    ▼
        ┌──────────────────────────────────────────┐
        │        API / Backend (apps/api)          │
        │  Fastify · JWT · Zod · Socket.IO         │
        │                                          │
        │  domain/   pricing · state machine ·     │
        │            dispatch · commission · promo │
        │  services/ otp · paiements · wallet ·    │
        │            notifications                 │
        │  routes/   client · chauffeur · admin    │
        └───────┬───────────────┬──────────────────┘
                │               │
                ▼               ▼
      ┌──────────────┐   ┌─────────────────────────┐
      │ PostgreSQL   │   │ Adaptateurs externes    │
      │ (Kysely)     │   │ SMS · Push · Paiements  │
      │              │   │ Cartographie            │
      └──────────────┘   └─────────────────────────┘
```

Le backend centralise, comme demandé au §17 : utilisateurs, chauffeurs, véhicules,
courses, positions, tarification, paiements, commissions, notifications, promotions
et statistiques. Les applications mobiles ne détiennent aucune règle métier — elles
n'affichent que ce que l'API calcule.

## 2. Choix techniques et justifications

| Choix | Raison |
|---|---|
| **Node.js + TypeScript** | Un seul langage pour l'API et l'admin ; typage strict sur des montants et des états critiques. |
| **Fastify** | Serveur HTTP performant, validation de schéma intégrée, écosystème de plugins (JWT, rate-limit, helmet, CORS). |
| **PostgreSQL** | Transactions ACID indispensables pour la comptabilité (course ↔ paiement ↔ commission ↔ portefeuille). |
| **Kysely (SQL typé)** | Le schéma SQL est un livrable du cahier des charges (§18) : il reste lisible dans `migrations/`, sans couche d'abstraction opaque, tout en étant typé de bout en bout. |
| **Socket.IO** | Suivi temps réel de la position du chauffeur (§4) avec repli automatique en long-polling sur réseaux mobiles instables. |
| **Zod** | Validation d'entrée unique, partagée entre routes et tests. |
| **Montants entiers** | Le FCFA n'a pas de sous-unité : tous les montants sont des entiers (`BIGINT`), jamais des flottants. |

## 3. Découpage du code

```
apps/api/src/
├── config/env.ts         Lecture et validation des variables d'environnement
├── db/                   Connexion, types du schéma, migrations, seed
├── domain/               Règles métier PURES (sans I/O) — 100 % testables unitairement
│   ├── pricing.ts        Formule tarifaire configurable (§7)
│   ├── ride-state.ts     Machine à états d'une course (§6)
│   ├── dispatch.ts       Sélection et classement des chauffeurs (§19)
│   ├── commission.ts     Répartition plateforme / chauffeur (§8)
│   ├── promotions.ts     Éligibilité et calcul des remises (§13)
│   └── geo.ts            Distance haversine, cadre englobant, ETA
├── services/             Orchestration avec effets de bord (base, réseau)
│   ├── otp.ts            Génération, hachage, vérification des codes
│   ├── rides.ts          Cycle de vie d'une course, transactions
│   ├── dispatch.ts       Boucle d'offres aux chauffeurs
│   ├── payments/         Adaptateurs de paiement (espèces, mobile money, carte)
│   ├── wallet.ts         Grand livre du portefeuille chauffeur (§10)
│   └── notifications.ts  Push / SMS (§16)
├── routes/               Surface HTTP (client, chauffeur, admin)
├── realtime/             Passerelle Socket.IO
└── plugins/              Authentification, gestion d'erreurs
```

**Règle structurante :** `domain/` ne fait aucun accès base ni réseau. Toute la
logique sensible (prix, commission, transitions d'état, éligibilité promo) y vit et
est testée sans infrastructure. `services/` compose ces fonctions dans des
transactions.

## 4. Sécurité (§12)

- Authentification par téléphone + OTP ; les codes sont **hachés** (scrypt) en base,
  avec expiration, compteur de tentatives et limitation de débit par téléphone et par IP.
- Jetons JWT courts (15 min) + jetons de rafraîchissement persistés, révocables et
  rotatifs (un jeton de rafraîchissement ne sert qu'une fois).
- Mots de passe administrateurs : scrypt avec sel aléatoire par utilisateur.
- En-têtes de sécurité via Helmet, CORS limité aux origines déclarées.
- Journalisation des événements sensibles dans `audit_logs` (qui, quoi, quand, sur quoi).
- Chiffrement des communications : TLS terminé en amont (reverse proxy / balanceur).
  L'API refuse de démarrer en production avec un `JWT_SECRET` par défaut.

## 5. Temps réel et géolocalisation (§4)

- Le chauffeur publie sa position sur le canal `driver:location`. Elle est écrite dans
  `driver_locations` (dernière position connue, indexée) et, si une course est active,
  ajoutée à `ride_locations` (trace horodatée pour l'audit et les litiges).
- Le client rejoint la salle `ride:<id>` et reçoit les changements d'état et les
  positions du chauffeur.
- Les distances sont calculées en SQL par formule haversine, précédée d'un filtre par
  cadre englobant pour exploiter l'index `(latitude, longitude)`. Le passage à PostGIS
  (`geography` + `ST_DWithin`) est prévu et documenté dans `docs/modele-de-donnees.md`
  lorsque le volume l'exigera : il ne change que `services/dispatch.ts`.
- La distance et l'itinéraire réels doivent provenir d'un service cartographique
  (adaptateur `services/routing.ts`) ; par défaut, la distance à vol d'oiseau est
  corrigée par un facteur de sinuosité configurable, ce qui permet de développer
  sans dépendre d'un fournisseur.

## 6. Évolutivité

- L'API est **sans état** : elle peut être répliquée derrière un balanceur. Les seuls
  états partagés sont en base.
- Socket.IO est prêt pour un adaptateur Redis lorsque plusieurs instances seront
  nécessaires (un seul point à brancher, `realtime/socket.ts`).
- Les écritures comptables passent toutes par des transactions et un grand livre en
  ajout seul (`wallet_transactions`) : aucun solde n'est modifié sans écriture
  correspondante, ce qui rend les rapprochements possibles (§8).
- Les tables volumineuses (`ride_locations`, `notifications`, `audit_logs`) sont
  candidates au partitionnement par date ; leurs index sont déjà orientés en ce sens.

## 7. Ce qui reste à brancher avant production

Le code isole volontairement ces dépendances derrière des adaptateurs :

| Adaptateur | Implémentation fournie | À brancher |
|---|---|---|
| SMS (OTP) | journalisation console | agrégateur SMS local |
| Push | journalisation console | FCM / APNs |
| Mobile money | simulateur | prestataire agréé (§9) |
| Carte bancaire | simulateur | prestataire agréé (§9) |
| Cartographie / itinéraires | haversine + facteur de sinuosité | fournisseur cartographique |

Le §9 du cahier des charges est explicite : les paiements électroniques passent par
des prestataires, jamais par un système bancaire construit par la plateforme. Le code
respecte cette contrainte — aucun flux monétaire externe n'est simulé en production,
le simulateur refuse de s'activer si `NODE_ENV=production`.
