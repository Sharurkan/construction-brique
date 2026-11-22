import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages : https://sharurkan.github.io/construction-brique/
// Propriétaire de ce fichier : Agent E (PWA + déploiement).
const BASE = '/construction-brique/';
const SKY = '#7ec8ff';

export default defineConfig({
  base: BASE,
  // Seul index.html est une entrée de build : les pages demos/*.html ne sont pas publiées.
  build: { target: 'es2020' },
  plugins: [
    VitePWA({
      // « prompt » : une nouvelle version attend ; pwa.ts ne l'applique que sur l'écran de démarrage
      // (sinon au prochain lancement). Jamais de rechargement en pleine partie.
      registerType: 'prompt',
      // L'enregistrement est fait par src/platform/pwa.ts (registerPwa).
      injectRegister: false,
      // Les icônes et le favicon sont déjà couverts par globPatterns (dossier public/).
      includeManifestIcons: false,
      manifest: {
        id: BASE,
        name: 'Construction Brique',
        short_name: 'Briques',
        description: 'Jeu de construction de blocs en 3D pour enfants, hors ligne.',
        lang: 'fr',
        dir: 'ltr',
        start_url: BASE,
        scope: BASE,
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'landscape',
        theme_color: SKY,
        background_color: SKY,
        categories: ['games', 'kids', 'education'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Tout le build est précaché : le jeu doit marcher hors ligne après la 1re visite.
        globPatterns: ['**/*.{js,mjs,css,html,png,jpg,jpeg,webp,gif,svg,ico,ogg,mp3,wav,m4a,woff,woff2,ttf,json,txt}'],
        globIgnores: ['**/demos/**', '**/node_modules/**'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: `${BASE}index.html`,
        navigateFallbackDenylist: [/\/demos\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
