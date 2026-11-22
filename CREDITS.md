# Crédits

Merci aux créateurs qui partagent leur travail librement. Tous les fichiers
ci-dessous sont dans `public/assets/` (les fichiers ont été renommés, leur
contenu n'a pas été modifié). Le nom d'origine de chaque fichier est indiqué
dans les tableaux ci-dessous.

## Graphismes et sons : Kenney (CC0)

Auteur : **Kenney Vleugels — Kenney** (https://www.kenney.nl)
Licence : **Creative Commons Zero (CC0 1.0), domaine public** —
https://creativecommons.org/publicdomain/zero/1.0/
La mention de l'auteur n'est pas obligatoire, mais nous la faisons avec plaisir.
(Licence vérifiée dans le fichier `License.txt` de chaque archive officielle.)

### Voxel Pack — textures des blocs et pioche

Source : https://kenney.nl/assets/voxel-pack

Dossier `textures/` (PNG 128 × 128, depuis `PNG/Tiles/`) :

| Fichier du jeu | Fichier Kenney |
| --- | --- |
| grass_top.png | grass_top.png |
| grass_side.png | dirt_grass.png |
| dirt.png | dirt.png |
| stone.png | stone.png |
| cobblestone.png | gravel_stone.png |
| log_top.png | trunk_top.png |
| log_side.png | trunk_side.png |
| planks.png | wood.png |
| leaves.png | leaves_transparent.png |
| brick.png | brick_red.png |
| glass.png | glass.png |
| sand.png | sand.png |
| ore_diamond.png | stone_diamond.png |
| ore_gold.png | stone_gold.png |
| ore_emerald.png | redstone_emerald.png |
| ore_ruby.png | greystone_ruby.png |
| ore_coal.png | stone_coal.png |
| ore_iron.png | stone_iron.png |
| ore_silver.png | stone_silver.png |
| wool.png | cotton_tan.png |
| bedrock.png | greystone.png |
| wool_red.png | cotton_red.png |
| wool_green.png | cotton_green.png |
| wool_blue.png | cotton_blue.png |
| stone_brick.png | brick_grey.png |
| planks_red.png | wood_red.png |
| snow.png | snow.png |
| ice.png | ice.png |
| glass_frame.png | glass_frame.png |

Dossier `icons/` : `btn_break.png` ← `PNG/Items/pick_diamond.png`.

Dans le jeu, les tuiles sont réduites à 64 × 64 et la tuile `wool.png`
(cotton_tan) est recolorée en 9 couleurs de laine vives (blanc, rouge, orange,
jaune, vert, bleu, violet, rose, noir).

Blocs pleins d'or et de diamant : le Voxel Pack n'en contient pas. Ils sont
obtenus en **recolorant** la tuile Kenney `glass_frame.png` (cadre biseauté) au
chargement du jeu, en jaune or et en bleu diamant opaques (transformation de
couleur seule, rien n'est dessiné en plus ; voir `recolorGem` dans
`src/game/atlas.ts` et `GEM_BLOCK_TILES` dans `src/assets/manifest.ts`). Œuvre
dérivée d'une tuile CC0, donc CC0 également. Le fichier `glass_frame.png` est
livré tel quel. Les vignettes de la palette sont de
petits cubes dessinés avec ces mêmes tuiles.

Icône de l'application (`public/icons/*.png`, `public/favicon.png`) : cube
isométrique dessiné avec `grass_top.png` et `dirt_grass.png` (grass_side) du
Voxel Pack, sur fond bleu ciel (œuvre dérivée, CC0 également ; générée par
`src/platform/tools/make-icons.mjs`).

### Mobile Controls — joystick et icônes de boutons

Source : https://kenney.nl/assets/mobile-controls

Dossier `icons/` (SVG, depuis `Vector/`) :

| Fichier du jeu | Fichier Kenney |
| --- | --- |
| joystick_base.svg | Style H/joystick_circle_pad_a.svg |
| joystick_knob.svg | Style H/joystick_circle_nub_a.svg |
| btn_bg.svg | Style H/button_circle.svg |
| btn_place.svg | Icons/icon_hand.svg |
| btn_jump.svg | Icons/icon_jump.svg |
| btn_fullscreen.svg | Icons/icon_size_larger.svg |
| btn_fullscreen_exit.svg | Icons/icon_size_smaller.svg |
| btn_sound_on.svg | Icons/icon_sound.svg |
| btn_sound_off.svg | Icons/icon_sound_disabled.svg |

### Game Icons — icônes complémentaires

Source : https://kenney.nl/assets/game-icons

Dossier `icons/` (PNG 100 × 100, depuis `PNG/White/2x/`) :

| Fichier du jeu | Fichier Kenney |
| --- | --- |
| btn_new_world.png | home.png |
| btn_credits.png | information.png |
| btn_fly.png | arrowUp.png |
| btn_fly_down.png | arrowDown.png |

### Impact Sounds — casser, poser, marcher

Source : https://kenney.nl/assets/impact-sounds

Dossier `sounds/` (OGG, depuis `Audio/`) :

| Fichier du jeu | Fichier Kenney |
| --- | --- |
| break_wood_1..3.ogg | impactPlank_medium_000..002.ogg |
| break_stone_1..3.ogg | impactMining_000..002.ogg |
| break_glass_1..2.ogg | impactGlass_light_000..001.ogg |
| break_soft_1..3.ogg | impactSoft_medium_000..002.ogg |
| place_1..3.ogg | impactGeneric_light_000..002.ogg |
| step_grass_1..3.ogg | footstep_grass_000..002.ogg |
| step_wood_1..2.ogg | footstep_wood_000..001.ogg |
| step_stone_1..2.ogg | footstep_concrete_000..001.ogg |

### Interface Sounds — saut et sélection

Source : https://kenney.nl/assets/interface-sounds

| Fichier du jeu | Fichier Kenney |
| --- | --- |
| jump_1.ogg | maximize_001.ogg |
| select_1.ogg | select_001.ogg |

### UI Audio — clic

Source : https://kenney.nl/assets/ui-audio

| Fichier du jeu | Fichier Kenney |
| --- | --- |
| click_1.ogg | click1.ogg |

### Music Jingles — jingle « nouveau monde »

Source : https://kenney.nl/assets/music-jingles

| Fichier du jeu | Fichier Kenney |
| --- | --- |
| new_world_1.ogg | Pizzicato jingles/jingles_PIZZI00.ogg |

## Police : Andika (SIL)

- Fichiers : `fonts/Andika-Regular.woff2`, `fonts/Andika-Bold.woff2`
  (version 7.000, dossier `web/` de la publication officielle) et `fonts/OFL.txt`.
- Source : https://github.com/silnrsi/font-andika/releases (Andika-7.000.zip)
  — page du projet : https://software.sil.org/andika/
- Copyright (c) 2004-2025 SIL Global (https://www.sil.org/), avec les noms de
  police réservés « Andika » et « SIL ».
- Licence : **SIL Open Font License 1.1** — texte complet dans
  `public/assets/fonts/OFL.txt` et sur https://openfontlicense.org
- Nom réservé : la police est utilisée telle quelle. Une version modifiée
  (par exemple un sous-ensemble de caractères) ne pourrait pas s'appeler
  « Andika » ni « SIL ».

## Code : Three.js

- Moteur 3D **Three.js** — https://threejs.org — © 2010-2025 three.js authors.
- Licence : **MIT** — https://github.com/mrdoob/three.js/blob/dev/LICENSE
