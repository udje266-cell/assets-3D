# Plateforme de mobilité et de réservation de transport

Mise en œuvre du cahier des charges fourni
(`docs/cahier-des-charges.md`) : mettre en relation des clients avec des
chauffeurs disponibles, permettre la réservation et le suivi d'une course, le
paiement et l'évaluation du service.

Ce dépôt contient le **socle serveur** et l'**administration web**. Les
applications mobiles client et chauffeur consomment l'API décrite dans
[`docs/api.md`](docs/api.md) et ne portent aucune règle métier.

```
apps/api      API REST + WebSocket, base de données, règles métier
apps/admin    Interface d'administration (React + Vite)
docs/         Cahier des charges, architecture, modèle de données, API, feuille de route
```

## Démarrage

Prérequis : Node.js ≥ 20 et PostgreSQL ≥ 14.

```bash
cp .env.example .env          # puis renseigner DATABASE_URL et JWT_SECRET
npm install

npm run migrate               # applique apps/api/migrations/*.sql
npm run seed                  # catégories, grilles tarifaires, compte d'administration

npm run dev                   # API        → http://localhost:3000
npm run dev:admin             # console web → http://localhost:5173
```

Avec Docker : `docker compose up` démarre PostgreSQL et l'API.

Compte d'administration créé par le jeu de données initial :
`admin@plateforme.local` / `AdminPlateforme2026!` — **à changer avant toute mise
en ligne**.

Pour évaluer les écrans sur des données non triviales :

```bash
npm run demo --workspace apps/api   # ~300 courses réparties sur trois semaines
```

## Tests

```bash
npm test          # 70 tests : unitaires sur le métier + intégration sur PostgreSQL
npm run typecheck
```

Les tests d'intégration s'exécutent contre une vraie base
(`TEST_DATABASE_URL`, à défaut `DATABASE_URL`) : une machine à états, des
contraintes d'unicité partielles et un grand livre comptable ne se vérifient pas
sérieusement contre une base simulée.

## Ce que couvre le code

| § du cahier des charges | Où |
|---|---|
| §3 Application client | `apps/api/src/routes/client.ts` |
| §4 Géolocalisation | `apps/api/src/domain/geo.ts`, `apps/api/src/realtime/socket.ts` |
| §5 Application chauffeur | `apps/api/src/routes/driver.ts` |
| §6 Déroulement d'une course | `apps/api/src/domain/ride-state.ts`, `services/rides.ts` |
| §7 Tarification | `apps/api/src/domain/pricing.ts`, table `pricing_rules` |
| §8 Commission et revenus | `apps/api/src/domain/commission.ts` |
| §9 Paiements | `apps/api/src/services/payments.ts` |
| §10 Portefeuille chauffeur | `apps/api/src/services/wallet.ts` |
| §11 Notation et signalement | `apps/api/src/services/reviews.ts` |
| §12 Sécurité | `plugins/auth.ts`, `lib/crypto.ts`, `services/audit.ts` |
| §13 Promotions | `apps/api/src/domain/promotions.ts` |
| §14 Administration | `apps/api/src/routes/admin.ts`, `apps/admin/` |
| §15 Gestion des litiges | `routes/admin.ts` (tickets), `apps/admin/src/pages/Tickets.tsx` |
| §16 Notifications | `apps/api/src/services/notifications.ts` |
| §17 Architecture | [`docs/architecture.md`](docs/architecture.md) |
| §18 Base de données | `apps/api/migrations/001_init.sql`, [`docs/modele-de-donnees.md`](docs/modele-de-donnees.md) |
| §19 Attribution des courses | `apps/api/src/domain/dispatch.ts`, `services/dispatch.ts` |
| §24 Indicateurs clés | `apps/api/src/services/analytics.ts` |

## Trois décisions qui méritent d'être connues

**Les montants sont des entiers.** Le FCFA n'a pas de sous-unité ; les taux sont
exprimés en points de base (2000 = 20 %). Aucun calcul d'argent ne passe par un
flottant.

**Les promotions sont supportées par la plateforme, pas par le chauffeur.** La
commission est calculée sur le prix brut de la course ; la remise est portée au
compte de la plateforme. Un chauffeur ne doit pas être pénalisé par une opération
commerciale qu'il n'a pas décidée. Le revenu net de la plateforme est donc
`commission − remise`, calculé au niveau des indicateurs et non en écrasant la
commission — ce qui préserve la lisibilité comptable exigée au §8.

**Les tarifs appliqués sont figés sur la course.** Publier une nouvelle grille
clôt l'ancienne sans l'effacer, et chaque course conserve une copie des
paramètres qui lui ont été appliqués. Un prix reste ainsi explicable des mois
plus tard, ce dont dépend l'instruction d'un litige (§15).

## Ce qui reste à brancher

Le code isole ces dépendances derrière des adaptateurs ; aucune n'est simulée en
production, le serveur refuse de démarrer si un simulateur de paiement est actif
avec `NODE_ENV=production`.

| Adaptateur | Fourni | À brancher |
|---|---|---|
| SMS (codes OTP) | journalisation | agrégateur SMS |
| Notifications push | journalisation | FCM / APNs |
| Mobile money, carte | simulateur | prestataire agréé (§9) |
| Itinéraires | haversine × facteur de sinuosité | fournisseur cartographique |

Voir [`docs/feuille-de-route.md`](docs/feuille-de-route.md) pour l'état des
phases du §26 et les points à trancher avant le lancement, notamment les
obligations réglementaires du §28, qui doivent être confirmées auprès des
autorités compétentes et d'un conseil juridique local.
