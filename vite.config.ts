import { defineConfig } from 'vite';

// GitHub Pages : https://sharurkan.github.io/construction-brique/
// Propriétaire de ce fichier : Agent E (PWA + déploiement).
export default defineConfig({
  base: '/construction-brique/',
  build: { target: 'es2020' },
});
