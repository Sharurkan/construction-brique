import './game.css';
import { NO_LOOK_ATTR } from '../controls/input';

const svg = (body: string): string =>
  `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const PLAY_ICON = svg('<path d="M17 10 L39 24 L17 38 Z" fill="currentColor" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>');
const CLOSE_ICON = svg('<path d="M12 12 L36 36 M36 12 L12 36" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>');

/**
 * Écran de démarrage sans texte : un grand bouton « jouer » sur fond ciel.
 * Le clic sert de geste utilisateur (plein écran, déverrouillage audio).
 * `onPlay` est appelé une seule fois, puis l'écran disparaît en fondu.
 */
export function showStartScreen(parent: HTMLElement, onPlay: () => void): HTMLElement {
  const screen = document.createElement('div');
  screen.className = 'cb-start';
  screen.setAttribute(NO_LOOK_ATTR, '');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'cb-start-play';
  btn.setAttribute('aria-label', 'Jouer');
  btn.innerHTML = PLAY_ICON;
  screen.appendChild(btn);

  let done = false;
  const go = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    if (done) return;
    done = true;
    onPlay();
    screen.classList.add('is-leaving');
    window.setTimeout(() => screen.remove(), 350);
  };
  // pointerup (et pas pointerdown) : Chrome accepte le plein écran sur la fin du geste.
  btn.addEventListener('pointerup', go);
  btn.addEventListener('click', go); // clavier (Entrée / Espace)
  screen.addEventListener('pointerdown', (e) => e.stopPropagation());
  parent.appendChild(screen);
  return screen;
}

/** Transforme le Markdown très simple de CREDITS.md en nœuds DOM (sans innerHTML). */
function renderCredits(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let para: string[] = [];
  const flush = (): void => {
    if (para.length === 0) return;
    const p = document.createElement('p');
    p.textContent = para.join('\n');
    frag.appendChild(p);
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    // Liens [texte](url) → « texte (url) » ; emphase retirée.
    const line = raw.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)').replace(/\*\*|__|`/g, '');
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const el = document.createElement(h[1].length <= 1 ? 'h2' : 'h3');
      el.textContent = h[2];
      frag.appendChild(el);
    } else if (line.trim() === '') {
      flush();
    } else {
      para.push(line.replace(/^\s*[-*]\s+/, '• '));
    }
  }
  flush();
  return frag;
}

/** Panneau des crédits (pour les parents) avec un gros bouton fermer. */
export class CreditsPanel {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement, text: string, onClose?: () => void) {
    const el = document.createElement('div');
    el.className = 'cb-credits';
    el.setAttribute(NO_LOOK_ATTR, '');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Crédits');
    el.hidden = true;

    const box = document.createElement('div');
    box.className = 'cb-credits-box';
    box.appendChild(renderCredits(text));

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'cb-credits-close';
    close.setAttribute('aria-label', 'Fermer');
    close.innerHTML = CLOSE_ICON;
    close.addEventListener('click', () => {
      this.hide();
      onClose?.();
    });

    el.append(box, close);
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    parent.appendChild(el);
    this.el = el;
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  show(): void {
    this.el.hidden = false;
    this.el.querySelector('.cb-credits-box')?.scrollTo(0, 0);
  }

  hide(): void {
    this.el.hidden = true;
  }
}
