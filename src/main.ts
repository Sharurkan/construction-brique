// Point d'entrée : l'assemblage du jeu est dans src/game/game.ts.
import { startGame } from './game/game';

const app = document.getElementById('app')!;
app.textContent = '';
startGame(app).catch((err: unknown) => {
  // Ne devrait jamais arriver (chaque module se replie seul) ; visible dans la console pour le débogage.
  console.error('[construction-brique] échec du démarrage', err);
});
