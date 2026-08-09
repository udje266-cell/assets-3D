# Marque URIGO

`source/` contient les **originaux fournis**. Ils ne sont pas redessinés :

| Fichier | Contenu |
|---|---|
| `source/urigo-logotype.png` | Logotype « URIGO » et sa signature |
| `source/urigo-symbole.png` | Symbole (le U, l'épingle, la voiture) |

`generate.py` les recadre et les décline en icônes et logotypes pour les deux
applications mobiles et l'administration :

```bash
python3 tools/brand/generate.py
```

Le script réécrit `apps/mobile-client/assets/`, `apps/mobile-driver/assets/` et
`apps/admin/public/`. Ses sorties sont versionnées — l'intégration continue ne
dispose pas de Pillow — mais elles ne se modifient pas à la main : il faut
modifier le script ou les originaux, puis régénérer.

## Décisions

- **La signature « BOUGEZ. PARTAGEZ. ARRIVEZ. » est écartée** dans
  l'application (`WORDMARK_BOX` coupe sous le mot). Elle reste dans l'original.
- **Le logotype et l'écran de lancement sont détourés** (`_cut_out`) : ils
  n'apportent pas leur propre fond, ils se posent sur celui de l'écran. Deux
  noirs encodés séparément ne se raccordent jamais tout à fait ; un visuel sur
  fond noir posé sur un fond noir laisse voir sa découpe.
- **Le fond sur lequel ils se posent doit rester le noir de la marque.** Le
  logotype est blanc et orange : il est présenté dans un bandeau noir courant
  d'un bord à l'autre, jamais dans une plaque au milieu de la page. L'icône,
  elle, garde son fond noir — c'est une image carrée que le système découpe
  lui-même.
- **L'icône chauffeur est l'icône client augmentée d'une pastille « PRO »**,
  posée sous le symbole et jamais dessus. Un chauffeur a les deux applications
  installées : elles doivent se lire comme une même famille et se distinguer
  d'un coup d'œil.
- **Couleurs relevées sur les originaux** : orange `#fd7e02`, noir `#000000`,
  blanc `#ffffff`. Elles sont reprises dans `packages/shared/src/theme.ts`.

## Fonte

`Outfit-Bold.ttf` ne sert qu'au mot « PRO » de la pastille chauffeur. Elle est
diffusée sous SIL Open Font License 1.1 (`Outfit-OFL.txt`), qui autorise cette
redistribution. Le logotype, lui, n'est jamais recomposé : c'est l'image
d'origine qui est utilisée.
