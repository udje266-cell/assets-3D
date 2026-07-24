# GMDI — Gestion Municipale Digitale Intégrée

Prototype fonctionnel de la plateforme municipale **GMDI** décrite dans le cahier
des charges. GMDI n'est pas une juxtaposition d'applications indépendantes : c'est
**une seule plateforme**, structurée en modules métiers, qui partage une
architecture commune de comptes, de rôles et de sécurité.

Ce dépôt implémente cette architecture de bout en bout : la page de connexion
unique, les trois espaces (Portail Citoyen, Back Office Maire, Back Office
Gestionnaires), le flux de démarches unifié, la génération d'actes avec QR Code,
et le journal d'audit.

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

## Architecture des accès (cahier des charges §2)

La plateforme repose sur **trois espaces distincts**, communs à tous les modules.

| Espace | Rôle | Portée |
| --- | --- | --- |
| **Portail Citoyen** | Compte unique, auto-inscription | Ses propres démarches, tous modules |
| **Back Office Maire** | Compte unique de supervision | Vue consolidée + détail de chaque module, **consultation seule** |
| **Back Office Gestionnaire** | Un compte par module | Gestion opérationnelle **de son module uniquement** |
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
→ vérification → validation (acte + QR Code) OU refus motivé → notification citoyen
→ mise à jour des statistiques (gestionnaire + Maire)
```

Le socle est générique : ajouter un module dans `src/config.js` suffit à le voir
apparaître dans les trois espaces, sans toucher à l'architecture des accès.

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

Compte citoyen de démonstration : `koffi.aya@example.ci` / `Citoyen@2026`
(ou créez votre propre compte depuis le Portail Citoyen).

## Sécurité et traçabilité (cahier des charges §4)

- Mots de passe **hachés** (bcrypt), jamais stockés en clair.
- **Message d'erreur générique** à la connexion (ne révèle pas l'élément erroné).
- **Blocage temporaire** du compte après plusieurs échecs.
- **Déconnexion automatique** après inactivité.
- **Journal d'audit** commun : identité, date/heure, IP, module, action.
- Séparation stricte des données entre modules et entre citoyens.
- Actes authentifiables par **QR Code** via une page de vérification publique
  (`/verify/<code>`).

## Structure du projet

```
src/
  config.js      Modules, rôles, démarches, comptes de seed (source de vérité)
  store.js       Persistance JSON (remplaçable par une vraie base en production)
  auth.js        Sessions, hachage, tentatives de connexion, rôles
  audit.js       Journal d'audit commun
  demarches.js   Flux unifié des démarches (création → paiement → validation/refus)
  seed.js        Amorçage des comptes de dev + démonstrations
  server.js      API REST + service des fichiers statiques (une seule application)
public/
  index.html     Coquille de l'application
  app.js         SPA (routeur par hash) : les trois espaces
  styles.css     Charte GMDI aux couleurs de la Côte d'Ivoire (orange/blanc/vert)
  verify.html    Vérification publique d'un acte via QR Code
```

## Identité visuelle (couleurs de la Côte d'Ivoire)

L'interface reprend les couleurs du drapeau ivoirien — **orange, blanc, vert** —
et chaque « partie » porte sa propre teinte :

- **Portail Citoyen / Site public** → orange
- **Back Office Maire** → vert
- **Back Office Gestionnaire** → vert (nuance distincte)
- **Auditeur** → vert-ardoise

Un liseré tricolore surmonte chaque page, les titres sont soulignés d'un rappel
orange/blanc/vert, et les validations restent en vert. La couleur de chaque
espace est pilotée par l'attribut `data-space` sur `<body>` (voir `styles.css`).

## Portée du prototype

Cette version démontre l'architecture complète et le flux métier commun. Les
paiements (Mobile Money / carte) et le téléversement de pièces sont **simulés**.
En production, prévoir : base de données réelle, comptes nominatifs avec mot de
passe temporaire à la première connexion, intégration des agrégateurs de paiement,
stockage documentaire, et signature électronique qualifiée.
