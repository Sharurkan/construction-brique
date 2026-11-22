/**
 * Assemblage du jeu : moteur voxel + joueur + entrées + HUD + sauvegarde + PWA + sons.
 * Chaque module est écrit et testé séparément ; ce fichier ne fait que les relier.
 */
import * as THREE from 'three';
import { BlockId, SAVE_VERSION, type GameActions, type RaycastHit, type SavedWorld } from '../core/types';
import { BLOCKS, PALETTE, World, WorldRenderer, findSpawn, generateWorld } from '../engine';
import { InputManager } from '../controls/input';
import { Player } from '../player/player';
import { Hud } from '../ui/hud';
import { createSaveStore, hasPreviousSlot } from '../platform/save';
import { createAutosave } from '../platform/autosave';
import { registerPwa, requestFullscreenAndLandscape, requestPersistentStorage } from '../platform/pwa';
import { WebAudioSoundPlayer } from '../audio/sound';
import type { SoundName } from '../core/types';
import { loadBlockTextures } from './atlas';
import { renderBlockIcon } from './blockIcons';
import { applyUiAssets } from './uiAssets';
import { SOUNDS } from '../assets/manifest';
import { BlockHighlight } from './highlight';
import { BreakParticles } from './particles';
import { CreditsPanel, showStartScreen } from './screens';
import { CREDITS_TEXT } from './credits';
import { DebugOverlay } from './debug';
import { PixelRatioAdjuster } from './pixelRatio';

const SKY = 0x7ec8ff;
/** Portée de la main (blocs). */
const REACH = 6;
/**
 * Plafond du pixel ratio (perf tablette Mali-G52 / Adreno 610). Ajusté ensuite automatiquement
 * (PixelRatioAdjuster, plancher 0.75) ; `?pr=1` dans l'URL force une valeur fixe.
 */
const DEFAULT_MAX_PIXEL_RATIO = 1.25;
/** Brouillard et distance de vue : monde 96 × 96, du centre au coin ≈ 68 blocs. */
const FOG_NEAR = 32;
const FOG_FAR = 90;
const CAMERA_FAR = 120;
/** Chunks remaillés par frame : normal / juste après une action du joueur (réponse immédiate). */
const REMESH_PER_FRAME = 2;
const REMESH_AFTER_ACTION = 8;
/** Pas de dt plus grand que ça (onglet ralenti, gros à-coup). */
const MAX_FRAME_DT = 0.1;
const STEP_INTERVAL = 0.45;
/** Vérification « le joueur a bougé » pour la sauvegarde. */
const MOVE_SAVE_INTERVAL = 5;

function randomSeed(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

export async function startGame(app: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  const forcedPixelRatio = Number(params.get('pr')) > 0 ? Number(params.get('pr')) : null;

  registerPwa();

  // Sons Kenney (manifeste) : téléchargés et décodés seulement après le premier geste.
  const sound = new WebAudioSoundPlayer(SOUNDS);
  // Icônes Kenney du HUD, images du joystick, police des crédits.
  applyUiAssets();

  // ---------- Premier geste utilisateur (une seule fois) ----------
  let gestured = false;
  const firstGesture = (): void => {
    if (gestured) return;
    gestured = true;
    sound.unlock();
    void requestFullscreenAndLandscape();
    void requestPersistentStorage();
  };
  // Filet de sécurité si le geste arrive ailleurs que sur le bouton « jouer ».
  // pointerup (pas pointerdown) : c'est lui qui active le geste utilisateur au toucher.
  window.addEventListener('pointerup', firstGesture, { capture: true, once: true });
  showStartScreen(document.body, firstGesture);

  // ---------- Three.js ----------
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  // Pixel ratio : forcé par ?pr=, sinon plafonné puis réglé selon le temps moyen d'image.
  const pixelRatioAdjuster = forcedPixelRatio
    ? null
    : new PixelRatioAdjuster({ initial: Math.min(window.devicePixelRatio || 1, DEFAULT_MAX_PIXEL_RATIO) });
  renderer.setPixelRatio(forcedPixelRatio ?? pixelRatioAdjuster?.value ?? 1);
  renderer.setClearColor(SKY);
  app.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, CAMERA_FAR);

  const resize = (): void => {
    const w = Math.max(1, app.clientWidth);
    const h = Math.max(1, app.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // ---------- Monde (sauvegarde ou nouvelle génération) ----------
  const [{ atlas, tiles }, store] = await Promise.all([loadBlockTextures(debug), createSaveStore()]);
  const saved = await store.load().catch(() => null);
  const world = new World();
  let seed = randomSeed();
  let restored: SavedWorld | null = null;
  if (saved && saved.sizeX === world.sizeX && saved.sizeY === world.sizeY && saved.sizeZ === world.sizeZ) {
    try {
      world.load(saved.blocks);
      seed = saved.seed;
      restored = saved;
    } catch {
      restored = null;
    }
  }
  if (!restored) generateWorld(world, seed);

  const worldRenderer = new WorldRenderer(world, scene, atlas);
  worldRenderer.rebuildAll();

  // ---------- Joueur ----------
  const spawn = findSpawn(world);
  const player = new Player(spawn);
  player.setSpawn(spawn);
  player.setBounds({ minX: 0, maxX: world.sizeX, minZ: 0, maxZ: world.sizeZ });
  if (restored) {
    player.teleport(restored.player.position);
    player.state.yaw = restored.player.yaw;
    player.state.pitch = restored.player.pitch;
  }

  let selected: BlockId =
    restored && PALETTE.includes(restored.selected as BlockId) ? (restored.selected as BlockId) : PALETTE[0];

  const highlight = new BlockHighlight(scene);
  const particles = new BreakParticles(scene);

  // ---------- Sauvegarde ----------
  const currentState = (): SavedWorld => ({
    version: SAVE_VERSION,
    sizeX: world.sizeX,
    sizeY: world.sizeY,
    sizeZ: world.sizeZ,
    seed,
    blocks: world.serialize(),
    player: {
      position: { ...player.state.position },
      yaw: player.state.yaw,
      pitch: player.state.pitch,
    },
    selected,
    savedAt: Date.now(),
  });
  const autosave = createAutosave(store, currentState);
  world.onChange(() => autosave.markDirty());

  // ---------- Sons ----------
  // Le HUD signale chaque appui (clic) ; si l'appui déclenche aussi un vrai son
  // (casser, poser, choisir un bloc…) dans la même tâche, le clic est remplacé par ce son.
  let clickPending = false;
  const sfx = (name: SoundName, blockId?: BlockId): void => {
    clickPending = false;
    sound.play(name, blockId === undefined ? undefined : { blockId });
  };
  const buttonClick = (): void => {
    clickPending = true;
    queueMicrotask(() => {
      if (clickPending) sound.play('click');
      clickPending = false;
    });
  };

  // ---------- Actions ----------
  let boostRemesh = false;
  const target = (): RaycastHit | null => {
    const ray = player.getLookRay();
    return world.raycast(ray.origin, ray.dir, REACH);
  };

  let hud: Hud | null = null;
  const setFlyingUi = (): void => hud?.setFlying(player.flying);

  const actions: GameActions = {
    breakBlock() {
      const hit = target();
      if (!hit) return;
      const [x, y, z] = hit.block;
      if (!world.setBlock(x, y, z, BlockId.Air)) return; // ex. socle indestructible
      particles.burst(x, y, z, BLOCKS[hit.id].color);
      sfx('break', hit.id);
      boostRemesh = true;
    },
    placeBlock() {
      const hit = target();
      if (!hit) return;
      const x = hit.block[0] + hit.normal[0];
      const y = hit.block[1] + hit.normal[1];
      const z = hit.block[2] + hit.normal[2];
      if (!world.inBounds(x, y, z)) return;
      if (world.getBlock(x, y, z) !== BlockId.Air) return;
      if (player.wouldIntersectPlayer(x, y, z)) return;
      if (!world.setBlock(x, y, z, selected)) return;
      sfx('place', selected);
      boostRemesh = true;
    },
    selectBlock(id) {
      selected = id;
      sfx('select');
      autosave.markDirty();
    },
    newWorld() {
      // Copie du monde actuel dans l'emplacement « précédent » (restaurable depuis la zone
      // parents). Instantané pris AVANT la régénération ; écriture en tâche de fond, échec ignoré.
      if (hasPreviousSlot(store)) {
        const snapshot = currentState();
        void store
          .savePrevious(snapshot)
          .then(() => credits.setRestoreAvailable(true))
          .catch((err: unknown) => console.warn('[nouveau monde] copie du monde précédent impossible', err));
      }
      seed = randomSeed();
      generateWorld(world, seed);
      worldRenderer.rebuildAll();
      const s = findSpawn(world);
      player.setSpawn(s);
      player.teleport(s);
      player.state.yaw = 0;
      player.state.pitch = 0;
      if (player.flying) {
        player.toggleFly();
        setFlyingUi();
      }
      autosave.markDirty();
      void autosave.flush();
      sfx('newWorld');
    },
    // Appelé par le bouton vol du HUD ; renvoie l'état réel, que le HUD affiche.
    toggleFly() {
      player.toggleFly();
      return player.flying;
    },
  };

  // ---------- Entrées ----------
  // Élément = conteneur #app (et non le canvas) : InputManager y ajoute le visuel du joystick,
  // qui ne s'afficherait pas comme enfant d'un <canvas>.
  const input = new InputManager(app, {
    onPrimary: () => actions.breakBlock(),
    onSecondary: () => actions.placeBlock(),
    onSlot: (i) => hud?.selectIndex(i),
    onScroll: (d) => hud?.selectRelative(d),
    onToggleFly: () => {
      player.toggleFly();
      setFlyingUi();
    },
  });

  // ---------- HUD, crédits ----------
  /** Remplace le monde en cours par une sauvegarde (blocs, graine, joueur, bloc choisi). */
  const applySaved = (s: SavedWorld): boolean => {
    if (s.sizeX !== world.sizeX || s.sizeY !== world.sizeY || s.sizeZ !== world.sizeZ) return false;
    try {
      world.load(s.blocks);
    } catch {
      return false;
    }
    seed = s.seed;
    worldRenderer.rebuildAll();
    player.setSpawn(findSpawn(world));
    player.teleport(s.player.position);
    player.state.yaw = s.player.yaw;
    player.state.pitch = s.player.pitch;
    if (PALETTE.includes(s.selected as BlockId)) {
      selected = s.selected as BlockId;
      hud?.select(selected, false);
    }
    return true;
  };

  // Restaurer = échanger courant ↔ précédent (un 2e appui annule la restauration).
  let restoring = false;
  const restorePrevious = async (): Promise<void> => {
    if (restoring || !hasPreviousSlot(store)) return;
    restoring = true;
    credits.setRestoreBusy(true);
    try {
      await autosave.flush(); // aucune écriture du monde actuel ne doit passer APRÈS l'échange
      const back = await store.swapWithPrevious(currentState());
      if (!back || !applySaved(back)) return;
      // Réécrit le monde restauré : écrase une éventuelle écriture lancée pendant l'échange.
      autosave.markDirty();
      void autosave.flush();
      sfx('newWorld');
    } catch (err) {
      console.warn('[restauration] échec', err);
    } finally {
      restoring = false;
      credits.setRestoreBusy(false);
    }
  };
  const refreshRestoreButton = (): void => {
    if (!hasPreviousSlot(store)) return;
    void store.hasPrevious().then((has) => credits.setRestoreAvailable(has), () => {});
  };

  const credits = new CreditsPanel(document.body, CREDITS_TEXT, { onRestorePrevious: () => void restorePrevious() });
  refreshRestoreButton();
  hud = new Hud(document.body, actions, PALETTE, (id) => BLOCKS[id].color, {
    initialSelected: selected,
    initialSoundOn: sound.enabled,
    onJumpChange: (down) => input.setButton('jump', down),
    onDescendChange: (down) => input.setButton('descend', down),
    onCredits: () => {
      refreshRestoreButton();
      credits.show();
    },
    onSoundToggle: (on) => {
      sound.setEnabled(on);
      sound.unlock();
    },
    onButtonPress: buttonClick,
  });
  // Vignettes de la palette (mini-cubes avec les vraies tuiles) ; le HUD les reprend aussi
  // sur la pastille du bouton POSER.
  if (tiles) {
    for (const id of PALETTE) {
      const icon = renderBlockIcon(id, tiles);
      if (icon) hud.setBlockIcon(id, icon);
    }
  }

  const debugOverlay = debug
    ? new DebugOverlay(document.body, renderer, worldRenderer.stats, () => {
        const p = player.state.position;
        return `\npos        ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}${player.flying ? ' (vol)' : ''}\nseed       ${seed}\npr mode    ${forcedPixelRatio ? 'forcé (?pr)' : 'auto'}`;
      })
    : null;

  // ---------- Boucle ----------
  let raf = 0;
  let last = performance.now();
  let stepTimer = 0;
  let wasOnGround = player.onGround;
  let moveSaveTimer = 0;
  const lastSavedPos = { x: player.state.position.x, y: player.state.position.y, z: player.state.position.z };

  const frame = (now: number): void => {
    raf = requestAnimationFrame(frame);
    const frameMs = now - last;
    const dt = Math.min(Math.max(frameMs / 1000, 0), MAX_FRAME_DT);
    last = now;
    // Pas de mesure pendant un remaillage en cours (démarrage, nouveau monde) : coût passager.
    const pr = worldRenderer.stats.pending === 0 ? pixelRatioAdjuster?.sample(frameMs) : null;
    if (pr) renderer.setPixelRatio(pr);

    player.update(dt, input.state, world);
    input.consumeLook();
    player.applyToCamera(camera);

    // Sons de pas et de saut.
    const p = player.state.position;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    if (player.onGround && !player.flying && speed > 0.5) {
      stepTimer += dt;
      if (stepTimer >= STEP_INTERVAL) {
        stepTimer = 0;
        sfx('step', world.getBlock(p.x, p.y - 0.05, p.z));
      }
    } else {
      stepTimer = STEP_INTERVAL * 0.6; // le premier pas arrive vite à la reprise
    }
    if (wasOnGround && !player.onGround && !player.flying && player.velocity.y > 0) sfx('jump');
    wasOnGround = player.onGround;

    // Sauvegarde si le joueur a bougé (toutes les ~5 s).
    moveSaveTimer += dt;
    if (moveSaveTimer >= MOVE_SAVE_INTERVAL) {
      moveSaveTimer = 0;
      if (Math.hypot(p.x - lastSavedPos.x, p.y - lastSavedPos.y, p.z - lastSavedPos.z) > 0.25) {
        lastSavedPos.x = p.x;
        lastSavedPos.y = p.y;
        lastSavedPos.z = p.z;
        autosave.markDirty();
      }
    }

    highlight.update(target());
    particles.update(dt);
    worldRenderer.update(boostRemesh ? REMESH_AFTER_ACTION : REMESH_PER_FRAME, p);
    boostRemesh = false;

    renderer.render(scene, camera);
    debugOverlay?.frame();
  };

  const start = (): void => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stop = (): void => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  if (!document.hidden) start();

  // Accès console (débogage, tests navigateur).
  Object.assign(window, {
    __game: { world, player, hud, input, actions, autosave, store, sound, renderer, worldRenderer, scene, camera, credits, get seed() { return seed; }, get selected() { return selected; } },
  });
}
