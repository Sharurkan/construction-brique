/**
 * Intégration PWA : service worker (hors ligne), plein écran, orientation paysage,
 * stockage persistant. Toutes les fonctions sont sûres sur un navigateur qui ne supporte
 * pas l'API concernée (elles ne lèvent jamais).
 */
import { registerSW } from 'virtual:pwa-register';
import { createUpdatePolicy, type UpdateServiceWorker } from './pwaUpdate';

export interface RegisterPwaOptions {
  /** Le jeu est en cache : il fonctionnera hors ligne. */
  onOfflineReady?: () => void;
  onError?: (err: unknown) => void;
  /**
   * Vrai tant qu'on peut recharger la page sans gêner l'enfant (écran de démarrage encore
   * affiché). Défaut : jamais (la mise à jour attend le prochain lancement).
   */
  canReloadNow?: () => boolean;
}

/**
 * Enregistre le service worker (mode `prompt` : une nouvelle version s'installe puis ATTEND).
 * Elle est appliquée tout de suite seulement si `canReloadNow()` (écran de démarrage) ;
 * sinon au prochain lancement du jeu — jamais de rechargement en pleine partie.
 * À appeler une fois au démarrage.
 */
export function registerPwa(opts: RegisterPwaOptions = {}): void {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    let updateSW: UpdateServiceWorker | null = null;
    const policy = createUpdatePolicy(
      () => updateSW,
      opts.canReloadNow ?? (() => false),
      (err) => opts.onError?.(err),
    );
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => policy.onNeedRefresh(),
      onOfflineReady: opts.onOfflineReady,
      onRegisterError: (err: unknown) => opts.onError?.(err),
    });
  } catch (err) {
    opts.onError?.(err);
  }
}

interface FullscreenElementCompat {
  requestFullscreen?: (options?: FullscreenOptions) => Promise<void>;
  webkitRequestFullscreen?: () => void;
}
interface FullscreenDocumentCompat {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
}
interface OrientationCompat {
  lock?: (orientation: string) => Promise<void>;
}

/**
 * Passe en plein écran puis verrouille l'orientation en paysage.
 * DOIT être appelée dans un gestionnaire de geste utilisateur (pointerup, click…).
 * Résout `true` si le plein écran est actif à la fin, `false` sinon. Ne rejette jamais.
 */
export async function requestFullscreenAndLandscape(el?: HTMLElement): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const doc = document as Document & FullscreenDocumentCompat;
  const target = (el ?? document.documentElement) as HTMLElement & FullscreenElementCompat;
  try {
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (target.requestFullscreen) await target.requestFullscreen({ navigationUI: 'hide' });
      else target.webkitRequestFullscreen?.();
    }
  } catch {
    /* refusé ou non supporté */
  }
  try {
    const orientation = (screen as Screen & { orientation?: OrientationCompat }).orientation;
    // lock() n'est accepté qu'en plein écran (ou en PWA installée) ; rejette ailleurs.
    await orientation?.lock?.('landscape');
  } catch {
    /* non supporté (iOS, bureau) ou refusé */
  }
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Vrai si le jeu tourne comme application installée (écran d'accueil). */
export function isStandalone(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const mm = (q: string) => window.matchMedia?.(q).matches ?? false;
    return (
      mm('(display-mode: fullscreen)') ||
      mm('(display-mode: standalone)') ||
      mm('(display-mode: minimal-ui)') ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/**
 * Demande un stockage persistant pour que le navigateur n'efface pas la sauvegarde
 * en cas de manque d'espace. Résout `true` si accordé (ou déjà accordé).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.persist) return false;
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
