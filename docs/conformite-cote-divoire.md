# Conformité — Côte d'Ivoire : dossier préparatoire

> **Ce document n'est pas un avis juridique.** C'est une reconnaissance
> documentaire, réalisée à partir de sources publiques consultées le
> **8 août 2026**, destinée à faire gagner du temps à un conseil juridique
> ivoirien et à orienter les démarches auprès des autorités.
>
> Les textes évoluent, les sources en ligne vieillissent, et une partie des
> informations ci-dessous provient de la presse et non du Journal officiel.
> **Rien ici ne doit être tenu pour acquis sans confirmation** auprès des
> autorités compétentes et d'un conseil local. Le §28 du cahier des charges le
> dit déjà : les exigences exactes ne sont pas des faits juridiques définitifs.
>
> Chaque affirmation porte son niveau de fiabilité :
> **[Officiel]** source publique d'une autorité · **[Presse]** média ou cabinet ·
> **[À vérifier]** incertitude explicite.

---

## 1. Le point qui décide de tout : le marché est fermé

**[Officiel/Presse]** L'exercice de l'activité de mise en relation VTC est
soumis à un **agrément délivré par le ministère chargé des transports
routiers**, sur le fondement du **décret n° 2021-860 du 15 décembre 2021**
portant organisation des transports publics particuliers de personnes.

**[Presse]** Une note des autorités de transport du **28 janvier 2025**
identifiait **trois plateformes autorisées** : Uber, Yango et Heetch. Les
acteurs opérant hors agrément s'exposaient à de « lourdes sanctions » et à la
**désactivation de leur plateforme électronique**.

**[À vérifier — important]** Un article de mars 2026 cite Yango, Bolt et inDrive
comme acteurs du marché. La composition de la liste des plateformes autorisées a
donc évolué entre janvier 2025 et mars 2026, ou les sources se contredisent.
**La liste à jour doit être demandée directement au ministère.**

### Ce que cela signifie pour le projet

C'est le **premier obstacle, et il est de nature administrative, pas
technique**. Une plateforme non agréée ne peut pas opérer légalement, quelle que
soit la qualité de son logiciel — et le risque n'est pas théorique : la sanction
annoncée est la désactivation.

**Première question à poser, avant toute autre dépense :** un nouvel entrant
peut-il obtenir un agrément aujourd'hui, ou le nombre de licences est-il
contingenté ? La réponse conditionne l'existence même du projet.

### Régulateur

**[Officiel]** L'**ARTI** (Autorité de Régulation du Transport Intérieur) publie
les communiqués relatifs au respect des dispositions du décret (communiqué du
15 mars 2022 cité par le ministère). La **DGTTC** (Direction Générale des
Transports Terrestres et de la Circulation) intervient dans le contrôle.

---

## 2. Réforme annoncée en 2026 — à surveiller de près

**[Presse]** En mars 2026, le gouvernement a annoncé une réforme du cadre VTC,
avec un **comité technique constitué début avril 2026** disposant de **trois
mois** pour élaborer le nouveau cadre. Six axes annoncés :

| Axe annoncé | État du code |
|---|---|
| **Plafonnement des commissions** des plateformes | `pricing_rules.commission_bps` est déjà configurable par catégorie et par zone |
| **Tarif minimum** garantissant un revenu au chauffeur | `pricing_rules.minimum_fare` existe déjà |
| Encadrement de la **tarification dynamique** | `pricing_rules.surge_bps` est plafonnable ; le code refuse déjà tout multiplicateur inférieur à ×1 |
| **Transparence algorithmique** | Le détail du calcul est déjà exposé au client à la commande et figé sur la course (`pricing_snapshot`) |
| Indexation automatique des tarifs | À construire |
| **Comparateur officiel des prix** | Suppose une transmission de tarifs à l'administration — **format inconnu** |

**Bonne nouvelle :** les trois premiers axes n'exigent aucune réécriture — ce
sont des paramètres, modifiables depuis l'administration sans mise à jour des
applications, exactement comme le §7 l'exigeait. Ce choix d'architecture se
révèle payant ici.

**[Presse]** Le secteur emploierait environ **50 000 chauffeurs à Abidjan** —
ordre de grandeur utile pour dimensionner l'ambition du §25.

---

## 3. Conditions applicables aux véhicules

**[Presse]** D'après la présentation de la réglementation :

| Critère | Exigence rapportée |
|---|---|
| Nombre de places | **4 à 9 places**, conducteur compris |
| Âge du véhicule | **5 ans maximum** au moment de la mise en service |
| Puissance | **≥ 84 kW (114 ch)** |
| Contrôle technique | Visites régulières obligatoires |
| Importation | Conformité à la réglementation d'importation |

**[À vérifier]** Ces valeurs proviennent de la presse spécialisée, pas du texte
officiel. Le seuil de puissance en particulier exclut une grande partie du parc
de petites cylindrées : **à confirmer impérativement**, car il détermine quels
chauffeurs peuvent être recrutés.

### Impact sur le code

Le modèle de données porte déjà `vehicles.year`, `seats` et
`vehicle_categories.seats`. **Aucun contrôle automatique n'est implémenté** :
l'âge et la puissance sont aujourd'hui vérifiés à l'œil par l'opérateur au
moment de la validation. Une fois les seuils confirmés, ils devraient devenir
des contrôles à l'enregistrement du véhicule — un champ `power_kw` reste à
ajouter.

---

## 4. Conditions applicables aux chauffeurs

**[Presse]** Exigences rapportées : permis de conduire **catégorie B** en cours
de validité ; **permis de conduire international (PCI)** pour les conducteurs
étrangers ; **âge minimum 18 ans** ; contrôles de conformité et **vérification
d'antécédents**.

**[À vérifier]** Les points suivants n'ont pas été confirmés par les sources
consultées et doivent être tranchés :

- existence d'une **carte professionnelle** de chauffeur de transport public ;
- **ancienneté minimale** du permis (souvent 2 à 3 ans dans les cadres
  comparables) ;
- **extrait de casier judiciaire** : exigé ? à quelle fréquence renouvelé ?
- **visite médicale** d'aptitude ;
- **formation** obligatoire préalable ;
- **statut du chauffeur** : indépendant, salarié, ou rattaché à une société de
  transport titulaire d'une licence ? *C'est la question la plus lourde de
  conséquences* — elle détermine le régime social, la fiscalité, et la nature du
  contrat entre la plateforme et le chauffeur.

### Impact sur le code

La liste des documents exigés est une **donnée** (`driver_documents.doc_type`),
pas une contrainte figée — c'était un choix délibéré précisément pour absorber
ce genre d'incertitude. Ajouter « carte professionnelle » ou « casier
judiciaire » ne demande aucune migration.

En revanche, `driver_documents.expires_at` existe mais **aucune mécanique
n'invalide automatiquement un chauffeur dont un document a expiré**. Un index
partiel est déjà en place pour retrouver ces documents ; la règle
d'invalidation reste à écrire, une fois connues les durées de validité.

---

## 5. Facturation : la Facture Normalisée Électronique (FNE)

**[Officiel/Presse]** La **FNE** est le dispositif de la **DGI** (Direction
Générale des Impôts) qui dématérialise la facture normalisée. Fondement cité :
**arrêté n° 0337 du 9 mai 2025**. Le déploiement s'est fait par régime fiscal en
2025, avec une **généralisation effective fin décembre 2025**.

Chaque facture est **transmise au système de la DGI**, qui la contrôle,
l'enregistre et lui attribue des éléments de certification :

- un **numéro à structuration normative** ;
- un **visuel FNE** ;
- un **QR code** permettant à quiconque de vérifier l'authenticité de la facture.

**[Presse]** La réglementation VTC mentionne explicitement l'obligation
d'**intégrer un système de facturation électronique (FNE/RNE)**, avec **QR code
et numérotation officielle sur les reçus**.

### Impact sur le code — c'est le manque le plus concret

**Le modèle de données ne prévoit rien pour la FNE.** La table `payments` porte
`provider_reference` (référence du prestataire de paiement), ce qui n'a aucun
rapport avec une certification fiscale.

Ce qu'il faudra ajouter, une fois les spécifications techniques de la DGI
obtenues :

```
payments.fne_number         numéro certifié attribué par la DGI
payments.fne_qr_payload     contenu du QR code
payments.fne_status         en attente / certifiée / rejetée
payments.fne_submitted_at   horodatage de transmission
```

plus un adaptateur `services/invoicing.ts` sur le même modèle que les
adaptateurs de paiement, et une file de reprise : **si la DGI est
indisponible, la course ne doit pas être bloquée, mais la facture doit être
transmise ensuite**. C'est le même raisonnement que pour les paiements — on
enregistre l'intention avant l'appel externe.

**À demander à la DGI :** la documentation d'intégration technique, les
modalités d'homologation, et le délai de transmission toléré.

---

## 6. Paiements électroniques

**[Officiel]** L'émission de monnaie électronique dans l'UEMOA est régie par
l'**Instruction n° 008-05-2015 du 21 mai 2015** de la **BCEAO**. Pour une
structure qui n'est ni banque ni établissement financier de paiement,
l'activité est soumise à **agrément ou autorisation de la BCEAO**, avec un
**capital minimum de 300 millions de FCFA** intégralement souscrit et libéré en
numéraire avant l'agrément.

**[Officiel]** Les sociétés de télécommunications peuvent, **en partenariat avec
un émetteur**, distribuer de la monnaie électronique ou jouer un rôle
d'opérateur technique.

### Ce que cela confirme

Le §9 du cahier des charges avait raison, et l'architecture le respecte déjà :
**la plateforme ne doit pas émettre de monnaie électronique**, elle doit passer
par un prestataire agréé. Devenir EME supposerait 300 millions de FCFA de
capital et une procédure d'agrément — hors de proportion avec le projet.

**[À vérifier — point sensible]** Le **portefeuille chauffeur** mérite un examen
juridique attentif. Techniquement, c'est un grand livre de créances et de
dettes, pas un compte de monnaie électronique : le chauffeur ne peut ni y
déposer de l'argent, ni payer un tiers avec, seulement demander un reversement
de ce que la plateforme lui doit. **Cette qualification doit être confirmée** —
si l'autorité y voyait un compte de monnaie électronique, l'agrément
deviendrait exigible.

De même, l'**encaissement pour compte de tiers** (la plateforme encaisse le
client puis reverse au chauffeur) doit être qualifié avec un conseil.

---

## 7. Protection des données personnelles

**[Officiel]** La **loi n° 2013-450 du 19 juin 2013** relative à la protection
des données à caractère personnel s'applique. L'autorité de contrôle est
l'**ARTCI**.

**[Officiel]** **Tout traitement de données personnelles doit être déclaré à
l'ARTCI préalablement à sa mise en œuvre.** L'ARTCI rend sa décision dans le
**mois** suivant la réception de la déclaration ou de la demande
d'autorisation, prorogeable d'un mois par décision motivée. Le traitement peut
démarrer dès réception du récépissé.

**[À vérifier]** La **géolocalisation** relève-t-elle du régime de simple
déclaration ou d'une **autorisation préalable** ? C'est une donnée sensible par
nature — la trace GPS d'une personne révèle ses déplacements, ses habitudes,
parfois sa santé ou ses convictions. Beaucoup de régimes soumettent ce
traitement à un régime renforcé. **À trancher avec l'ARTCI avant le pilote.**

### Ce qui est déjà en place

- La position du chauffeur n'est collectée **que lorsqu'il est en service**, et
  la trace détaillée **que pendant une course**.
- Les écrans indiquent explicitement quand la position est transmise et
  pourquoi ; Android affiche une notification permanente pendant la course.
- Les données personnelles sont masquées dans les journaux applicatifs.
- Les jetons de session vivent dans le trousseau sécurisé de l'appareil.

### Ce qui manque

- **La déclaration ARTCI elle-même** — démarche à engager.
- **Une politique de conservation écrite et appliquée.** Le code ne purge rien
  aujourd'hui. `docs/exploitation.md` identifie `ride_locations` comme la table
  concernée, mais la durée reste à décider — et c'est une décision juridique
  autant que technique.
- **Les mentions d'information** dans les applications (finalité, destinataires,
  durée, droits d'accès et de rectification).
- **Le registre des traitements**, si la loi ivoirienne l'exige.
- **La désignation d'un correspondant** à la protection des données, le cas
  échéant.

---

## 8. Fiscalité et sanctions

**[Presse]** Des sanctions pouvant atteindre **2 000 000 FCFA** sont évoquées
pour non-conformité.

**[À vérifier]** Restent entiers : régime de TVA applicable à la commission de
la plateforme ; retenue à la source éventuelle sur les revenus des chauffeurs ;
imposition des chauffeurs (régime de l'entrepreneur individuel ?) ; taxe
spécifique au secteur du transport ; obligations déclaratives périodiques.

**[Presse]** La réglementation exige par ailleurs l'**intégration d'un suivi GPS
et d'alertes de sécurité passager**. Le suivi GPS existe (§4). **Le bouton
d'alerte d'urgence n'est pas implémenté** — le §12 le mentionnait comme « à
étudier selon les exigences locales ». Si l'exigence est confirmée, c'est un
développement à prévoir : bouton d'urgence, partage de course, et destinataire
de l'alerte (plateforme ? services de secours ?).

---

## 9. Démarches à engager, dans l'ordre

| # | Démarche | Auprès de | Pourquoi en premier |
|---|---|---|---|
| 1 | **Un nouvel entrant peut-il être agréé ?** Liste à jour des plateformes autorisées, procédure, délais, cahier des charges | Ministère chargé des transports routiers, ARTI | **Si la réponse est non, le projet s'arrête ici.** Rien d'autre ne mérite d'être engagé avant. |
| 2 | Suivi du **comité technique 2026** : plafond de commission, tarif minimum, encadrement du surge | Ministère, ARTI | Le cadre change dans les mois qui viennent ; s'y conformer par anticipation coûte moins cher que de s'y adapter après |
| 3 | **Déclaration ARTCI**, et régime applicable à la géolocalisation | ARTCI | Délai d'instruction d'un mois, prorogeable. À lancer tôt, en parallèle |
| 4 | **Intégration FNE** : documentation technique, homologation | DGI | Développement à prévoir ; obligation déjà généralisée depuis fin 2025 |
| 5 | Choix d'un **prestataire de paiement agréé** ; qualification juridique du portefeuille chauffeur | Prestataires + conseil juridique | Conditionne les délais de reversement, donc les règles de retrait |
| 6 | **Statut du chauffeur**, contrat, régime social et fiscal | Conseil juridique, CNPS | Structure tout le modèle contractuel |
| 7 | Conditions exactes **chauffeurs et véhicules** (âge, puissance, carte professionnelle, casier, visite médicale) | Ministère, DGTTC | Détermine qui peut être recruté |
| 8 | **Assurance** : garanties exigées pour le transport public de personnes | Assureurs, ministère | Pièce du dossier chauffeur |
| 9 | **Alerte d'urgence** : exigence confirmée ? destinataire ? | Ministère, ARTI | Développement supplémentaire si confirmé |

---

## 10. Écarts identifiés entre le code et les exigences pressenties

| Exigence | État | Effort |
|---|---|---|
| Facture normalisée électronique (FNE) | **Absent** — aucun champ, aucun adaptateur | Moyen ; dépend des spécifications DGI |
| Bouton d'alerte d'urgence passager | **Absent** | Moyen |
| Contrôle automatique âge et puissance du véhicule | Absent (`power_kw` à ajouter) | Petit |
| Invalidation automatique sur document expiré | Absent (données présentes, règle à écrire) | Petit |
| Politique de conservation des traces GPS | Absent (identifié, non décidé) | Petit une fois la durée arrêtée |
| Mentions d'information et registre des traitements | Absent | Petit |
| Plafond de commission, tarif minimum | **Déjà paramétrable** | Aucun |
| Transparence du calcul du prix | **Déjà en place** | Aucun |
| Suivi GPS de la course | **Déjà en place** | Aucun |
| Passage par un prestataire de paiement agréé | **Déjà l'architecture retenue** | Aucun |

---

## Sources consultées le 8 août 2026

- [Ministère des Transports — Réglementation des VTC, précisions du Ministre](https://www.transports.gouv.ci/actualites/reglementation-des-vtc-le-ministre-des-transports-fait-des-precisions)
- [ARTI — Le Régulateur n° 3 (avril 2025)](https://www.arti.ci/wp-content/uploads/2025/04/Le-Regulateur-3.pdf)
- [KOACI — Les trois entreprises autorisées (29 janvier 2025)](https://www.koaci.com/article/2025/01/29/cote-divoire/societe/cote-divoire-vtc-voici-les-trois-entreprises-autorisees-pour-exercer-vers-la-desactivation-des-plateformes-de-ceux-qui-operent-dans-lillegalite_184099.html)
- [KOACI — Décret relatif à la réglementation du transport (30 mars 2022)](https://www.koaci.com/index.php/article/2022/03/30/cote-divoire/societe/cote-divoire-decret-relatif-a-la-reglementation-du-transport-la-condition-qui-fache-les-acteurs-des-vtc_158818.html)
- [Koto CI — Les points clés de la nouvelle réglementation VTC](https://koto.ci/actualite-auto/actualite/16721-vtc-en-cote-divoire-les-points-cles-de-la-nouvelle-reglementation)
- [Pulse CI — Le gouvernement veut réguler les prix des VTC (mars 2026)](https://www.pulse.ci/article/vtc-en-cote-divoire-le-gouvernement-veut-reguler-les-prix-de-yango-et-des-plateformes-2026031605093254540)
- [AutoMag.ci — Tout savoir sur la nouvelle réglementation VTC (août 2025)](https://automag.ci/2025/08/22/vtc-en-cote-divoire-tout-savoir-sur-la-nouvelle-reglementation-pour-un-transport-plus-sur-et-professionnel/)
- [Pulse CI — FNE : ce qui change pour les entreprises en 2026](https://www.pulse.ci/article/facture-normalisee-electronique-fne-tout-ce-qui-change-pour-les-entreprises-ivoiriennes-en-2026-2026022802421220085)
- [EDICOM — Obligation de facturation électronique en Côte d'Ivoire](https://edicomgroup.com/blog/mandatory-e-invoicing-works-ivory-coast)
- [BCEAO — Qui peut émettre de la monnaie électronique dans l'UEMOA ?](https://www.bceao.int/fr/documents/qui-peut-emettre-de-la-monnaie-electronique-dans-luemoa-ou-lun-de-ses-etats-membres)
- [BCEAO — Demande d'agrément en qualité d'établissement émetteur de monnaie électronique](https://www.bceao.int/fr/publications/demande-dagrement-ou-dautorisation-en-qualite-detablissement-emetteur-de-monnaie)
- [ARTCI — Lois et ordonnances](https://www.artci.ci/index.php/lois/Lois-et-Ordonnances/lois.html)
- [African Legal Factory — Se conformer à la loi ivoirienne sur les données personnelles](https://africanlegalfactory.com/2024/01/23/ivorian-startups-learn-how-to-comply-with-ivorian-personal-data-protection-law/?lang=en)

## Textes à se procurer dans leur version officielle

Aucune des sources ci-dessus ne remplace le texte lui-même. À obtenir auprès du
Journal officiel ou des autorités :

- **Décret n° 2021-860 du 15 décembre 2021** portant organisation des transports
  publics particuliers de personnes, **et ses arrêtés d'application** ;
- **Arrêté n° 0337 du 9 mai 2025** relatif aux modalités de mise en œuvre de la
  FNE, et la documentation technique d'intégration ;
- **Loi n° 2013-450 du 19 juin 2013** relative à la protection des données à
  caractère personnel, et ses décrets d'application ;
- **Instruction BCEAO n° 008-05-2015 du 21 mai 2015** relative à l'émission de
  monnaie électronique ;
- Le futur cadre issu du **comité technique de 2026**, dès sa publication.
