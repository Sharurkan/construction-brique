# PLAN – Construction Brique

Bac à sable de blocs 3D pour enfants (5 et 7 ans). Casser / poser seulement. Tablette Android, PWA hors ligne.
Dépôt : `Sharurkan/construction-brique` → https://sharurkan.github.io/construction-brique/

## Stack
- Three.js + Vite + TypeScript (strict), Vitest pour les tests.
- vite-plugin-pwa (Workbox) pour le service worker et le manifest.
- Aucune dépendance réseau à l'exécution : tout est embarqué (textures, sons, police).

## Arborescence et propriétaires
| Chemin | Rôle | Propriétaire |
|---|---|---|
| `src/core/types.ts` | Contrats partagés | Orchestrateur |
| `src/main.ts`, `index.html` | Assemblage | Orchestrateur |
| `src/engine/` | Monde, chunks, greedy meshing, atlas, raycast, génération | Agent C |
| `src/controls/`, `src/player/`, `src/ui/` | Joystick, regard, boutons, palette, caméra, physique joueur | Agent D |
| `src/platform/`, `vite.config.ts`, `public/`, `.github/workflows/` | Sauvegarde, PWA, déploiement Pages | Agent E |
| `src/audio/` | Sons | Phase 2 |
| `asset-research/textures/` | Recherche textures | Agent A |
| `asset-research/audio-ui/` | Recherche sons, icônes, police | Agent B |
| `asset-gallery.html` | Galerie de choix | Orchestrateur |
| `demos/*.html` | Pages de démo par module | Agents C, D |

## Choix techniques
- Monde 96 × 48 × 96, chunks 16³, socle bedrock à y = 0, terrain légèrement vallonné (bruit maison, seedé).
- Greedy meshing par chunk, 2 passes (opaque / transparent), atlas unique en NearestFilter.
- Raycast DDA (Amanatides & Woo), portée ~6 blocs.
- Joueur : AABB 0.6 × 1.7, gravité douce, saut, pas de dégâts de chute. Ne peut pas sortir du monde.
- Tactile : joystick gauche, glisser à droite pour regarder, gros boutons casser / poser / sauter (≥ 64 px), palette en icônes.
- Sauvegarde : IndexedDB (repli localStorage), autosave anti-rebond + `visibilitychange`.
- « Nouveau monde » : appui long 2 s avec anneau de progression.

## Phases
- [x] Phase 0 : plan, contrats (`src/core/types.ts`), squelette Vite, dépôt git local.
- [x] Phase 1 (parallèle) : A textures → galerie · B sons/UI → galerie · C moteur · D contrôles/UI · E PWA/sauvegarde/CI.
- [x] **Point d'arrêt** : choix fait : T1 Kenney Voxel Pack, S1 sons Kenney, I1 Kenney Mobile Controls (+ Kenney Game Icons pour les manques), P1 Andika.
- [ ] Phase 2 (parallèle) : intégration assets + CREDITS.md + écran crédits · sons · réglages perf · tests (unitaires + viewport tablette) · relecture par un agent tiers.
- [ ] Phase 3 : premier push (avec accord), déploiement Pages, vérif chargement + installation, test tablette.

## Règles
- Petits commits clairs. Rien n'est poussé sans accord.
- Assets : CC0 en priorité, sinon CC-BY / CC-BY-SA avec attribution. Jamais d'assets Mojang.
