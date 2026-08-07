# Modèle de données

> Répond au §18 du cahier des charges. La source de vérité est
> `apps/api/migrations/001_init.sql` ; sa contrepartie TypeScript est
> `apps/api/src/db/types.ts`.

## 1. Conventions

| Règle | Motif |
|---|---|
| Identifiants **UUID** (`gen_random_uuid()`) | Générables côté client, non devinables, pas de collision entre environnements. |
| Montants en **BIGINT entiers** | Le FCFA n'a pas de sous-unité. Aucun montant ne passe par un flottant. |
| Taux en **points de base** (bps) | 2000 = 20 %. Permet une arithmétique entière exacte sur les commissions et les remises. |
| Horodatages **TIMESTAMPTZ** en UTC | Une plateforme de mobilité raisonne en instants, pas en heures locales. |
| Suppression **logique** (`deleted_at`) | Une entité portant un historique financier ne se supprime pas. |
| Tables d'événements en **ajout seul** | `ride_events`, `wallet_transactions`, `audit_logs` ne sont jamais modifiées. |

## 2. Tables demandées au §18

| Table | Rôle |
|---|---|
| `users` | Clients (§3). Téléphone unique, note moyenne, compteur de courses. |
| `drivers` | Chauffeurs (§5). Statut du dossier, disponibilité, statistiques d'acceptation. |
| `vehicles` | Véhicules rattachés à un chauffeur, avec catégorie. |
| `driver_documents` | Pièces justificatives et leur examen. |
| `rides` | Courses : trajet, états, distances, montants figés, moyen de paiement. |
| `ride_locations` | Trace GPS horodatée pendant la course (§4). |
| `payments` | Transactions : montant, moyen, identifiant prestataire, statut, commission (§9). |
| `driver_wallets` | Solde et cumuls par chauffeur (§10). |
| `withdrawals` | Demandes de retrait et leur instruction. |
| `reviews` | Évaluations croisées client ↔ chauffeur (§11). |
| `promotions` | Codes promotionnels et leurs paramètres (§13). |
| `support_tickets` | Litiges et signalements (§15). |
| `notifications` | Messages émis, par canal, avec statut (§16). |
| `admin_users` | Comptes d'administration et rôles (§14). |

## 3. Tables ajoutées, et pourquoi

Le §18 énumère les tables principales ; l'exploitation en impose quelques autres.
Chacune répond à une exigence explicite du cahier des charges :

| Table | Exigence servie |
|---|---|
| `ride_events` | §6 : « chaque changement d'état doit être enregistré côté serveur afin de permettre le suivi, l'audit et la gestion des litiges ». |
| `ride_offers` | §19 : attribution séquentielle, et §24 : taux d'acceptation. |
| `pricing_rules` | §7 : tarifs configurables depuis l'administration, versionnés par dates d'effet. |
| `vehicle_categories` | §7 : « différentes catégories de véhicules ». |
| `wallet_transactions` | §8 : « les montants doivent être enregistrés séparément pour faciliter la comptabilité et les rapprochements ». |
| `promotion_redemptions` | §13 : nombre d'utilisations, par code et par client. |
| `refunds` | §15 : « effectuer un remboursement lorsque justifié ». |
| `support_ticket_messages` | §15 : échanges avec les parties, avec notes internes. |
| `driver_locations` | §4 : dernière position connue, base de l'attribution. |
| `otp_codes`, `refresh_tokens` | §12 : authentification et sessions révocables. |
| `audit_logs` | §12 : « journalisation des événements importants ». |
| `platform_settings` | Paramètres modifiables sans redéploiement. |

## 4. Relations principales

```
vehicle_categories ──< pricing_rules
        │
        └──< vehicles >── drivers ──< driver_documents
                            │  │
                            │  └──< driver_wallets ──< wallet_transactions
                            │            │
                            │            └──< withdrawals
                            │
users ──< rides >───────────┘
   │       │
   │       ├──< ride_events        (journal des états)
   │       ├──< ride_locations     (trace GPS)
   │       ├──< ride_offers        (attribution)
   │       ├──< payments ──< refunds
   │       ├──< reviews
   │       └──< promotion_redemptions >── promotions
   │
   └──< support_tickets ──< support_ticket_messages
```

## 5. Contraintes qui portent des règles métier

Certaines règles ne sont pas laissées au code applicatif : la base les refuse.

| Contrainte | Ce qu'elle empêche |
|---|---|
| `rides_one_active_per_driver_idx` (index unique partiel) | Qu'un chauffeur soit affecté à deux courses simultanées, même en cas d'acceptations concurrentes. |
| `rides_one_active_per_user_idx` | Qu'un client lance deux courses en parallèle. |
| `wallet_transactions_ride_entry_idx` | Qu'une course soit créditée deux fois au portefeuille : une seule écriture de gain, une seule de commission par course. |
| `reviews_ride_author_idx` | Qu'un participant note deux fois la même course. |
| `promotion_redemptions_ride_idx` | Qu'une même course consomme deux fois un code. |
| `payments_provider_ref_idx` | Qu'un même identifiant de transaction prestataire soit enregistré deux fois. |
| `CHECK` sur les montants | Des montants négatifs là où ils n'ont pas de sens. |

Ces garde-fous comptent : sous charge, la course concurrente n'est pas un cas
d'école, et un doublon de crédit se paie en argent réel.

## 6. Immutabilité des montants facturés

`rides` conserve `pricing_rule_id` **et** `pricing_snapshot` (copie JSON des
paramètres appliqués et du détail du calcul). Publier une nouvelle grille clôt
l'ancienne (`effective_to`, `is_active = false`) sans l'effacer.

Conséquence : le prix d'une course passée reste explicable des mois plus tard,
ligne par ligne — ce que le §15 exige pour instruire un litige sur le prix.

## 7. Géolocalisation : index et évolution

`driver_locations` porte un index B-tree sur `(latitude, longitude)`. La
recherche de chauffeurs applique d'abord un filtre par cadre englobant
(indexable), puis calcule la distance haversine exacte en mémoire sur
l'ensemble déjà réduit.

Ce choix évite d'imposer PostGIS dès le départ. Lorsque le volume le justifiera,
le passage à `geography` + index GIST + `ST_DWithin` ne touchera qu'une fonction :
`findCandidates` dans `apps/api/src/services/dispatch.ts`.

## 8. Volumétrie et exploitation

Les tables qui croissent linéairement avec le trafic sont `ride_locations`
(plusieurs points par minute et par course), `notifications` et `audit_logs`.
Leurs index sont orientés `(clé, date)`, ce qui les rend partitionnables par mois
sans réécriture applicative. Prévoir une politique de rétention :

- `ride_locations` : conserver la trace complète le temps du délai de
  contestation, puis n'en garder qu'un échantillon ;
- `notifications` : purge après quelques mois ;
- `audit_logs` : rétention longue, c'est la pièce justificative des décisions
  d'administration.
