# GMDI — Gestion Municipale Digitale Intégrée

Prototype fonctionnel de la plateforme municipale **GMDI** décrite dans le cahier
des charges. GMDI n'est pas une juxtaposition d'applications indépendantes : c'est
**une seule plateforme**, structurée en modules métiers, qui partage une
architecture commune de comptes, de rôles et de sécurité.

Ce dépôt implémente cette architecture de bout en bout : le site public, la page
de connexion unique, les espaces (Portail Citoyen, Back Office Maire, Back Office
Gestionnaires, Administration Système, Auditeur), le flux de démarches unifié à
six statuts, les notifications, la génération d'actes avec QR Code, et le journal
d'audit.

## Démarrage rapide

```bash
npm install          # installe express, bcryptjs, cookie-parser
npm start            # démarre le serveur sur http://localhost:3000
```

Au premier lancement, les comptes professionnels de développement et quelques
démarches de démonstration sont créés automatiquement. Ouvrez ensuite
<http://localhost:3000>.

- `npm run dev` — démarrage avec rechargement automatique (`node --watch`).
- `npm run seed` — réinitialise complètement les données de démonstration.

Les données sont persistées dans `data/db.json` (fichier ignoré par git). Il
suffit de le supprimer pour repartir d'une base vierge.

## Architecture des accès (cahier des charges §2 fonctionnel & technique)

La plateforme repose sur des **espaces distincts**, communs à tous les modules.

| Espace | Rôle | Portée |
| --- | --- | --- |
| **Site public** | Aucun compte | Vitrine : présentation, actualités, services, contacts |
| **Portail Citoyen** | Compte unique, auto-inscription | Ses propres démarches, tous modules |
| **Back Office Maire** | Compte unique de supervision | Vue consolidée + détail de chaque module, **consultation seule** |
| **Back Office Gestionnaire** | Un compte par module | Gestion opérationnelle **de son module uniquement** |
| **Administration Système** | Compte technique | Comptes, mots de passe, rôles, activation, journaux — **jamais de métier** |
| **Auditeur** | Lecture seule | Journal d'audit de tous les modules |

Un citoyen ne voit que ses propres dossiers. Un gestionnaire ne peut pas accéder
aux données d'un autre module. Le Maire supervise mais ne traite jamais les
dossiers. Ces cloisonnements sont appliqués côté serveur (voir `src/server.js`,
middlewares `requireRole` et garde `guardModule`).

## Les sept modules (cahier des charges §5)

| Code | Module | Accès citoyen |
| --- | --- | --- |
| 01 | État Civil Numérique | ✅ |
| 02 | Finances Locales & Mobile Money | ✅ |
| 03 | Ressources Humaines (RH) | ❌ (personnel uniquement) |
| 04 | Urbanisme, Cadastre & SIG | ✅ |
| 05 | Services Techniques & Maintenance | ✅ |
| 06 | Communication & Délibérations | ✅ |
| 08 | Patrimoine | ✅ |

## Flux unifié des démarches (cahier des charges §6)

Toute démarche, quel que soit le module, suit la même logique :

```
Dépôt citoyen → paiement (si payant) → n° de suivi → notification gestionnaire
→ prise en charge → (complément demandé ↔ complété par le citoyen)
→ validation (acte + QR Code) OU refus motivé → clôture → notifications citoyen
→ mise à jour des statistiques (gestionnaire + Maire)
```

Les **six statuts officiels** (§6) : `En attente` · `En cours` · `À compléter` ·
`Validé` · `Refusé` · `Terminé`.

Chaque action importante génère une **notification** (interne, + Email/SMS simulés,
§7), consultable via la cloche présente dans chaque espace connecté.

Le socle est générique : ajouter un module dans `src/config.js` suffit à le voir
apparaître dans tous les espaces, sans toucher à l'architecture des accès.

## Comptes de développement (cahier des charges §3)

Convention : `module@mairie-gmdi.ci` + mot de passe standardisé. **Une seule page
de connexion** identifie automatiquement le rôle et le module.

| Fonction | Adresse professionnelle | Mot de passe |
| --- | --- | --- |
| Maire | `maire@mairie-gmdi.ci` | `Maire@2026` |
| Gestionnaire — État Civil (01) | `etatcivil@mairie-gmdi.ci` | `EtatCivil@2026` |
| Gestionnaire — Finances (02) | `finances@mairie-gmdi.ci` | `Finances@2026` |
| Gestionnaire — RH (03) | `rh@mairie-gmdi.ci` | `RH@2026` |
| Gestionnaire — Urbanisme (04) | `urbanisme@mairie-gmdi.ci` | `Urbanisme@2026` |
| Gestionnaire — Services Techniques (05) | `technique@mairie-gmdi.ci` | `Technique@2026` |
| Gestionnaire — Communication (06) | `communication@mairie-gmdi.ci` | `Communication@2026` |
| Gestionnaire — Patrimoine (08) | `patrimoine@mairie-gmdi.ci` | `Patrimoine@2026` |
| Auditeur | `auditeur@mairie-gmdi.ci` | `Auditeur@2026` |
| Administrateur Système | `admin@mairie-gmdi.ci` | `Admin@2026` |

Compte citoyen de démonstration : `koffi.aya@example.ci` / `Citoyen@2026`
(ou créez votre propre compte depuis le Portail Citoyen).

## Sécurité et traçabilité (cahier des charges §4)

- Mots de passe **hachés** (bcrypt), jamais stockés en clair.
- **Message d'erreur générique** à la connexion (ne révèle pas l'élément erroné).
- **Blocage temporaire** du compte après plusieurs échecs.
- **Déconnexion automatique** après inactivité.
- **Comptes activables / désactivables** par l'administrateur ; un compte
  désactivé ne peut plus se connecter.
- **Journal d'audit** commun : identité, date/heure, IP, module, action.
- Séparation stricte des données entre modules et entre citoyens.
- Actes authentifiables par **QR Code** via une page de vérification publique
  (`/verify/<code>`).

## Structure du projet

```
src/
  config.js         Modules, rôles, statuts, démarches, contenu du site public, seed
  store.js          Persistance JSON (remplaçable par une vraie base en production)
  auth.js           Sessions, hachage, tentatives, rôles, activation/désactivation
  audit.js          Journal d'audit commun
  notifications.js  Notifications (interne + Email/SMS simulés)
  demarches.js      Flux unifié des démarches (6 statuts : dépôt → … → terminé)
  seed.js           Amorçage des comptes de dev + démonstrations
  server.js         API REST + service des fichiers statiques (une seule application)
public/
  index.html        Coquille de l'application
  app.js            SPA (routeur par hash) : site public + tous les espaces
  styles.css        Charte GMDI aux couleurs de la Côte d'Ivoire (orange/blanc/vert)
  verify.html       Vérification publique d'un acte via QR Code
```

## Application Android (APK)

L'application est empaquetée en APK via **Capacitor**. Pour que l'app fonctionne
**sans serveur**, un backend embarqué (`public/offline-api.js`) réimplémente toute
l'API dans le navigateur avec persistance `localStorage` (mode démo autonome).

Générer l'APK (nécessite JDK 17+ et le SDK Android) :

```bash
npm install
npm run apk        # build www/ hors-ligne → cap sync → gradlew assembleDebug
# APK : android/app/build/outputs/apk/debug/app-debug.apk
```

- `npm run mobile` prépare uniquement `www/` (public/ + backend embarqué injecté).
- Le mode embarqué s'active automatiquement : `public/app.js` route ses appels
  vers `window.__gmdiApi` s'il existe, sinon vers le serveur (`fetch /api`).
- `window.__gmdiReset()` (console) réinitialise les données locales de démo.

App : `ci.gmdi.app` · label « GMDI » · minSdk 22 · targetSdk 34.
Installez l'APK debug en autorisant les « sources inconnues ».

## Identité visuelle (couleurs de la Côte d'Ivoire)

L'interface reprend les couleurs du drapeau ivoirien — **orange, blanc, vert** —
et chaque « partie » porte sa propre teinte :

- **Portail Citoyen / Site public** → orange
- **Back Office Maire** → vert
- **Back Office Gestionnaire** → vert (nuance distincte)
- **Auditeur** → vert-ardoise
- **Administration Système** → ardoise (espace technique)

Un liseré tricolore surmonte chaque page, les titres sont soulignés d'un rappel
orange/blanc/vert, et les validations restent en vert. La couleur de chaque
espace est pilotée par l'attribut `data-space` sur `<body>` (voir `styles.css`).

## Portée du prototype

Cette version démontre l'architecture complète et le flux métier commun. Les
paiements (Mobile Money / carte) et le téléversement de pièces sont **simulés**.
En production, prévoir : base de données réelle, comptes nominatifs avec mot de
passe temporaire à la première connexion, intégration des agrégateurs de paiement,
stockage documentaire, et signature électronique qualifiée.
