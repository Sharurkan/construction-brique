/**
 * Texte des crédits (pour les parents). Import tolérant : CREDITS.md est fourni par l'agent
 * chargé des assets ; tant qu'il n'existe pas, un texte de secours est affiché.
 */
const files = import.meta.glob<string>('/CREDITS.md', { query: '?raw', import: 'default', eager: true });

const FALLBACK = `# Construction Brique

Un jeu de construction de blocs pour enfants, sans publicité, sans compte, hors ligne.

Crédits des textures, sons, icônes et police : à venir.
Réalisé avec Three.js (licence MIT) et Vite.`;

export const CREDITS_TEXT: string = files['/CREDITS.md'] ?? FALLBACK;
