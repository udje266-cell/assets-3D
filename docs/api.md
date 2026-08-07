# API

Base : `/v1`. Toutes les réponses sont en JSON.

Authentification par jeton `Bearer`. Format d'erreur uniforme :

```json
{ "error": { "code": "invalid_transition", "message": "…", "details": {} } }
```

Le `code` est stable et destiné au traitement automatique ; le `message` est en
français et destiné à l'affichage.

---

## Authentification

| Méthode | Route | Description |
|---|---|---|
| POST | `/v1/auth/otp/request` | Envoi d'un code à usage unique. `{ phone, accountType }` |
| POST | `/v1/auth/otp/verify` | Vérification et ouverture de session. Crée le compte s'il n'existe pas. |
| POST | `/v1/auth/refresh` | Rotation du jeton de rafraîchissement. |
| POST | `/v1/auth/logout` | Révoque toutes les sessions du compte. |
| POST | `/v1/admin/auth/login` | Connexion administrateur (e-mail + mot de passe). |

En développement (`OTP_DEBUG_RETURN=true`), la réponse à la demande d'OTP inclut
le code. C'est refusé au démarrage en production.

---

## Application client (§3)

| Méthode | Route | Description |
|---|---|---|
| GET | `/v1/client/me` | Profil. |
| PATCH | `/v1/client/me` | Nom, e-mail, jeton push, langue. |
| GET | `/v1/client/vehicle-categories` | Catégories disponibles. |
| POST | `/v1/client/rides/estimate` | Estimation prix et durée, par catégorie. |
| POST | `/v1/client/promotions/check` | Éligibilité d'un code et remise applicable. |
| POST | `/v1/client/rides` | Commande d'une course ; lance la recherche de chauffeur. |
| GET | `/v1/client/rides` | Historique. |
| GET | `/v1/client/rides/:id` | Détail : chauffeur, véhicule, journal d'états, paiements. |
| GET | `/v1/client/rides/:id/tracking` | Dernière position du chauffeur. |
| POST | `/v1/client/rides/:id/cancel` | Annulation (frais éventuels). |
| POST | `/v1/client/rides/:id/pay` | Règlement par un moyen électronique. |
| POST | `/v1/client/rides/:id/review` | Évaluation du chauffeur (1 à 5). |
| POST | `/v1/client/support/tickets` | Signalement ou litige. |
| GET | `/v1/client/support/tickets` | Ses signalements. |
| GET | `/v1/client/notifications` | Ses notifications. |

### Exemple — commander une course

```http
POST /v1/client/rides
Authorization: Bearer <jeton>

{
  "pickup":  { "latitude": 5.3364, "longitude": -4.0267, "address": "Plateau" },
  "dropoff": { "latitude": 5.3599, "longitude": -3.9906, "address": "Cocody" },
  "vehicleCategoryId": "…",
  "paymentMethod": "cash",
  "promotionCode": "BIENVENUE"
}
```

```json
{
  "ride": { "id": "…", "reference": "CRS-20260807-K7X2QM", "status": "requested", "…": "…" },
  "dispatch": { "status": "offered", "candidats": 3 }
}
```

---

## Application chauffeur (§5)

| Méthode | Route | Description |
|---|---|---|
| GET | `/v1/driver/me` | Profil, statut, taux d'acceptation, solde. |
| PATCH | `/v1/driver/me` | Coordonnées, numéro de permis, jeton push. |
| POST | `/v1/driver/vehicles` | Déclaration d'un véhicule. |
| GET | `/v1/driver/vehicles` | Ses véhicules. |
| POST | `/v1/driver/vehicles/:id/activate` | Véhicule actif. |
| POST | `/v1/driver/documents` | Dépôt d'un document. |
| GET | `/v1/driver/documents` | État de ses documents. |
| POST | `/v1/driver/availability` | En ligne / hors ligne. |
| POST | `/v1/driver/location` | Publication de position (§4). |
| GET | `/v1/driver/offers/current` | Offre de course en cours. |
| POST | `/v1/driver/offers/:id/accept` | Acceptation. |
| POST | `/v1/driver/offers/:id/reject` | Refus ; la course passe au suivant. |
| POST | `/v1/driver/rides/:id/en-route` | Départ vers le client. |
| POST | `/v1/driver/rides/:id/arrived` | Arrivée sur place. |
| POST | `/v1/driver/rides/:id/start` | Passager à bord. |
| POST | `/v1/driver/rides/:id/complete` | Fin de course : prix final et commission. |
| POST | `/v1/driver/rides/:id/collect-cash` | Confirmation d'encaissement en espèces. |
| POST | `/v1/driver/rides/:id/cancel` | Annulation. |
| GET | `/v1/driver/rides` · `/current` · `/:id` | Historique et course en cours. |
| POST | `/v1/driver/rides/:id/review` | Évaluation du client. |
| GET | `/v1/driver/wallet` · `/wallet/transactions` | Solde et grand livre (§10). |
| GET | `/v1/driver/earnings` | Revenus sur une période. |
| POST | `/v1/driver/withdrawals` | Demande de retrait. |
| GET | `/v1/driver/withdrawals` | Ses retraits. |
| GET | `/v1/driver/notifications` | Ses notifications. |

---

## Administration (§14, §15)

Rôles : `viewer` (lecture), `support`, `operations`, `finance`, `super_admin`.
`super_admin` a tous les droits.

| Méthode | Route | Rôle | Description |
|---|---|---|---|
| GET | `/v1/admin/dashboard` | lecture | Instantané, KPI et série journalière. |
| GET | `/v1/admin/kpis` | lecture | Indicateurs du §24 sur une période. |
| GET | `/v1/admin/drivers` · `/:id` | lecture | Liste et dossier complet. |
| POST | `/v1/admin/drivers/:id/status` | operations | Validation, refus, suspension. |
| POST | `/v1/admin/documents/:id/review` | operations | Examen d'un document. |
| GET | `/v1/admin/users` | lecture | Clients. |
| POST | `/v1/admin/users/:id/suspension` | support | Suspension / rétablissement. |
| GET | `/v1/admin/rides` · `/:id` | lecture | Courses, trace GPS, offres, journal. |
| POST | `/v1/admin/rides/:id/cancel` | support | Annulation administrative. |
| GET/POST | `/v1/admin/vehicle-categories` | operations | Catégories de véhicules. |
| GET/POST | `/v1/admin/pricing-rules` | operations | Grilles tarifaires (§7). |
| GET/POST/PATCH | `/v1/admin/promotions` | operations | Codes promotionnels (§13). |
| GET | `/v1/admin/payments` | lecture | Transactions. |
| POST | `/v1/admin/payments/:id/refund` | finance | Remboursement, imputable au chauffeur. |
| GET | `/v1/admin/withdrawals` | lecture | Retraits. |
| POST | `/v1/admin/withdrawals/:id/status` | finance | Instruction d'un retrait. |
| POST | `/v1/admin/drivers/:id/wallet-adjustment` | finance | Correction de solde, motivée. |
| GET | `/v1/admin/tickets` · `/:id` | lecture | Litiges, avec dossier de course. |
| POST | `/v1/admin/tickets/:id/messages` | support | Réponse ou note interne. |
| POST | `/v1/admin/tickets/:id/status` | support | Changement de statut, résolution. |
| GET | `/v1/admin/audit-logs` | super_admin | Journal des actions (§12). |

---

## Temps réel (§4)

Socket.IO, chemin `/realtime`, authentifié par le même jeton d'accès
(`auth: { token }` à la connexion).

**Émis par le client :**

| Événement | Charge utile | Effet |
|---|---|---|
| `ride:subscribe` | `{ rideId }` | Rejoint la salle d'une course. Refusé si la course n'est pas la sienne. |
| `ride:unsubscribe` | `{ rideId }` | Quitte la salle. |
| `driver:location` | `{ latitude, longitude, heading?, speedKmh? }` | Chauffeur uniquement : met à jour la position et alimente la trace. |

**Reçus :**

| Événement | Destinataires | Contenu |
|---|---|---|
| `ride:status` | salle de la course | Nouvel état, libellé, montant dû le cas échéant. |
| `driver:location` | salle de la course | Position du chauffeur pendant le trajet. |
| `ride:offer` | chauffeur ciblé | Offre de course avec départ, destination, estimation et délai. |

---

## Codes d'erreur courants

| Code | HTTP | Signification |
|---|---|---|
| `validation_error` | 400 | Corps de requête invalide ; `details` liste les champs. |
| `unauthorized` | 401 | Jeton absent, invalide ou expiré. |
| `forbidden` | 403 | Compte non habilité (rôle, type de compte, suspension). |
| `not_found` | 404 | Ressource inexistante. |
| `invalid_transition` | 409 | Transition d'état interdite (§6). |
| `not_your_ride` | 409 | La course appartient à quelqu'un d'autre. |
| `ride_already_active` | 409 | Le client a déjà une course en cours. |
| `offer_expired` · `offer_closed` | 409 | Offre d'attribution périmée. |
| `insufficient_balance` | 422 | Retrait supérieur au solde. |
| `account_suspended` | 422 | Compte suspendu. |
| `promotion_*` | 422 | Code promotionnel inapplicable ; le suffixe précise le motif. |
| `too_many_requests` | 429 | Limitation de débit (§12). |
