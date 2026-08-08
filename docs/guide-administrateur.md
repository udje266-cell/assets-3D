# Guide administrateur

> Livrable du §27. Destiné aux équipes d'exploitation, d'assistance et
> financières qui utilisent l'interface d'administration (§14, §15).

## 1. Accès et rôles

Connexion par adresse e-mail et mot de passe sur la console web.

| Rôle | Ce qu'il peut faire |
|---|---|
| `viewer` | Consultation seule : tableau de bord, courses, chauffeurs, clients, paiements |
| `support` | + suspension de clients, annulation de courses, traitement des litiges |
| `operations` | + validation des chauffeurs, examen des documents, tarifs, promotions |
| `finance` | + remboursements, instruction des retraits, corrections de portefeuille |
| `super_admin` | Tous les droits, y compris le journal d'audit |

Un rôle inclut les droits de `viewer`. `super_admin` a tous les droits.

**Toute action sensible est tracée** dans le journal d'audit : qui, quoi, quand,
valeur avant et après. Ce journal est la pièce justificative de vos décisions —
il n'est ni modifiable ni effaçable.

## 2. Tableau de bord

Deux blocs distincts, à ne pas confondre.

**Activité en cours** — instantané temps réel : chauffeurs en ligne, en course,
courses en recherche, dossiers à valider, litiges ouverts, retraits à traiter.
C'est votre écran de veille : tout chiffre anormal dans « courses en recherche »
signale un manque de chauffeurs sur la zone.

**Indicateurs de la période** — sélectionnable par dates. Les définitions
comptent :

| Indicateur | Définition exacte |
|---|---|
| Volume de transactions (GMV) | Somme des prix facturés des courses payées |
| Commissions | Commission **brute** perçue sur ces courses |
| Revenu net plateforme | Commissions **moins** les remises promotionnelles |
| Revenu chauffeurs | Somme des parts revenant aux chauffeurs |
| Marge plateforme | Revenu net rapporté au volume |
| Taux d'annulation | Courses annulées sur courses demandées |
| Temps d'attente moyen | De la demande à l'arrivée du chauffeur sur place |
| Taux d'acceptation | Offres acceptées sur offres émises |

**Les coûts d'acquisition sont volontairement vides.** Ils exigent le budget
marketing de la période, qui ne transite pas par la plateforme. Divisez ce
budget par le nombre de nouveaux inscrits affiché pour les obtenir. Les inventer
leur ôterait toute valeur.

**Attention à la marge affichée** : c'est une marge brute de commission. Elle ne
déduit ni le personnel, ni l'infrastructure, ni le marketing, ni les frais de
paiement, ni le support, ni la fraude, ni la fiscalité.

## 3. Valider un chauffeur (§5, §14)

1. Ouvrez le dossier depuis la liste des chauffeurs (filtre « En attente »).
2. Examinez chaque document : validez, ou refusez avec un motif — le motif est
   affiché au chauffeur, rédigez-le pour qu'il sache quoi corriger.
3. Validez le dossier.

**La validation est refusée tant qu'un document reste en attente d'examen.**
C'est délibéré : un chauffeur ne doit pas être mis en circulation sur un dossier
non instruit.

À la validation, un portefeuille est ouvert automatiquement.

**Suspendre un chauffeur** exige un motif. Un chauffeur **en course** ne peut pas
être suspendu : clôturez ou réattribuez la course d'abord — sans quoi son client
resterait sans information.

## 4. Tarification (§7)

Les tarifs se modifient depuis la console, **sans mise à jour des
applications**. Une grille comprend : tarif de base, tarif au kilomètre, tarif à
la minute, tarif minimum, frais de réservation, frais d'annulation, commission,
multiplicateur dynamique et pas d'arrondi.

Publier une nouvelle grille **clôt la précédente sans l'effacer**. Conséquence
importante : les courses déjà facturées conservent leurs montants et restent
justifiables des mois plus tard. Ne cherchez pas à « corriger » un ancien prix
en modifiant une grille — cela n'aurait aucun effet, et c'est voulu.

La nouvelle grille s'applique immédiatement aux nouvelles estimations.

## 5. Promotions (§13)

Créez un code avec : type (pourcentage ou montant fixe), valeur, plafond de
réduction, montant minimum de course, nombre total d'utilisations, utilisations
par client, réservation à la première course, date de fin.

**Qui paie la remise ?** La plateforme. La commission est calculée sur le prix
brut de la course et la part du chauffeur n'est pas réduite. Une promotion est
une dépense commerciale, pas une baisse de rémunération du chauffeur — c'est
pourquoi le revenu net de la plateforme peut être inférieur à la commission
affichée, voire négatif sur une course très remisée.

Désactiver un code est immédiat et n'affecte pas les courses passées.

## 6. Traiter un litige (§15)

Le dossier d'un ticket livre **la course concernée, son journal d'états complet
et ses paiements** — vous n'avez pas à chercher ailleurs pour décider.

Le journal d'états est la pièce maîtresse : il enregistre chaque changement avec
son auteur et son horodatage. Un client qui conteste l'heure d'arrivée du
chauffeur, une distance facturée, un montant : la réponse y est.

Actions possibles : répondre au déclarant, ajouter une **note interne**
(invisible du déclarant), mettre en attente, résoudre avec une résolution
écrite.

## 7. Rembourser (§9, §15)

Depuis la liste des paiements, sur un paiement abouti.

Indiquez le montant, le motif, et **si le remboursement est imputé au
chauffeur** :

- **Non** (défaut) : la plateforme supporte le remboursement.
- **Oui** : le montant est débité du portefeuille du chauffeur. À réserver aux
  cas où il en est la cause établie — un remboursement imputé à tort ampute un
  revenu.

Un remboursement ne peut pas dépasser le montant encaissé, remboursements
antérieurs déduits.

**Les paiements en espèces ne se remboursent pas automatiquement** : aucun flux
n'a transité par la plateforme. Passez par un avoir sur le portefeuille ou un
virement manuel.

## 8. Instruire un retrait (§10)

Le chauffeur demande un retrait ; le montant est **débité de son solde dès la
demande**, ce qui l'empêche de l'engager deux fois.

Trois issues :

- **Approuver** puis **marquer payé** après exécution du virement — saisissez la
  référence, elle figurera au dossier.
- **Refuser** avec un motif — le montant **revient automatiquement au solde** du
  chauffeur.

Vérifiez les coordonnées avant de payer : un versement à un mauvais numéro ne se
rattrape pas depuis la console.

## 9. Corriger un portefeuille

Réservé au rôle `finance`. Un montant positif crée une prime, un montant négatif
une correction. Le motif est obligatoire et figure au grand livre du chauffeur
ainsi qu'au journal d'audit.

Le grand livre est en **ajout seul** : une écriture erronée ne se supprime pas,
elle se corrige par une écriture inverse. C'est ce qui rend les comptes
vérifiables.

## 10. Suspendre un client

Depuis la liste des clients, avec un motif. Un client suspendu ne peut plus
commander ; il en est informé à sa prochaine tentative. Le rétablissement est
immédiat.

## 11. Ce que la console ne fait pas

- **Modifier un prix déjà facturé** — par conception. Utilisez un remboursement.
- **Supprimer une course, un paiement ou une écriture comptable** — l'historique
  financier ne s'efface pas.
- **Voir les codes OTP** — ils sont hachés, personne ne peut les lire.
- **Rembourser des espèces automatiquement** — aucun flux n'a transité.
