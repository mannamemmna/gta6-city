// Menus and saving. The title card, the pause card and the localStorage save file live here: one
// snapshot of everything worth keeping (position, mission index, money, health, wanted level, the
// clock) written to a single key, plus a version tag so an old save is ignored rather than crashing.
import { SAVE_KEY } from './config.js';

const VERSION = 3;

export class Menus {
  constructor(game) {
    this.game = game;
    this.title = document.getElementById('title');
    this.pause = document.getElementById('pause');
    this.saveNote = document.getElementById('save-note');
    this.btnContinue = document.getElementById('btn-continue');
    this.controlsCard = document.getElementById('controls-card');
    this.onStart = null;
    this.onResume = null;
    this.onQuit = null;
    this.onSave = null;
    this.mode = 'title';

    document.getElementById('btn-new').addEventListener('click', () => this.startNew());
    this.btnContinue.addEventListener('click', () => this.continueGame());
    document.getElementById('btn-controls').addEventListener('click', () => {
      this.controlsCard.classList.toggle('hidden');
    });
    document.getElementById('btn-resume').addEventListener('click', () => this.resume());
    document.getElementById('btn-save').addEventListener('click', () => this.save());
    document.getElementById('btn-quit').addEventListener('click', () => this.quit());
    this.refreshContinue();
  }

  refreshContinue() {
    const save = loadSave();
    this.btnContinue.disabled = !save;
    if (save) this.btnContinue.textContent = `CONTINUE — ${save.missionTitle ?? 'Vela Costa'}`;
  }

  showTitle() {
    this.mode = 'title';
    this.title.classList.remove('hidden');
    this.pause.classList.add('hidden');
    this.game.hud.setVisible(false);
    this.refreshContinue();
  }

  hideTitle() {
    this.title.classList.add('hidden');
    this.game.hud.setVisible(true);
  }

  startNew() {
    this.hideTitle();
    this.mode = 'play';
    this.onStart?.(null);
  }

  continueGame() {
    const save = loadSave();
    if (!save) return;
    this.hideTitle();
    this.mode = 'play';
    this.onStart?.(save);
  }

  openPause() {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.pause.classList.remove('hidden');
    this.saveNote.textContent = '';
  }

  closePause() {
    this.pause.classList.add('hidden');
    this.mode = 'play';
  }

  resume() {
    this.closePause();
    this.onResume?.();
  }

  save() {
    const snapshot = this.game.snapshot();
    const ok = writeSave(snapshot);
    this.saveNote.textContent = ok ? 'GAME SAVED' : 'COULD NOT SAVE (storage blocked)';
    if (ok) this.game.hud.toast('Game saved', 1.8);
  }

  quit() {
    if (this.game.snapshot) writeSave(this.game.snapshot());
    this.pause.classList.add('hidden');
    this.mode = 'title';
    this.onQuit?.();
    this.showTitle();
  }
}

export function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ version: VERSION, at: Date.now(), ...data }));
    return true;
  } catch {
    return false;
  }
}

export function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try { window.localStorage.removeItem(SAVE_KEY); } catch { /* storage off */ }
}
