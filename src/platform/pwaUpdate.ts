/**
 * Politique de mise à jour du service worker (mode `prompt`) : une nouvelle version n'est
 * appliquée tout de suite (rechargement) que si l'enfant n'a pas encore commencé à jouer,
 * c'est-à-dire tant que l'écran de démarrage est affiché. Sinon, le nouveau service worker
 * reste en attente et prendra la main au prochain lancement du jeu.
 *
 * Logique pure, sans `virtual:pwa-register` (testable).
 */
export type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

export interface UpdatePolicy {
  /** À brancher sur `onNeedRefresh` de `registerSW`. */
  onNeedRefresh(): void;
  /** Vrai si une mise à jour attend le prochain lancement. */
  readonly pending: boolean;
}

export function createUpdatePolicy(
  getUpdateSW: () => UpdateServiceWorker | null,
  canApplyNow: () => boolean,
  onError: (err: unknown) => void = () => {},
): UpdatePolicy {
  let pending = false;
  return {
    onNeedRefresh() {
      const update = getUpdateSW();
      if (update && canApplyNow()) {
        pending = false;
        update(true).catch(onError);
      } else {
        pending = true; // appliquée au prochain lancement (service worker en attente)
      }
    },
    get pending() {
      return pending;
    },
  };
}
