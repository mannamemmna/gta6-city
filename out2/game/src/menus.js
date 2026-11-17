// Screens: title, pause, wasted, and the mission card. The DOM owns the layout so
// the text stays crisp at any window size; this module just flips classes and
// wires the buttons.

export class Menus {
  constructor(game) {
    this.game = game;
    this.el = {
      loading: document.getElementById('loading'),
      title: document.getElementById('title'),
      pause: document.getElementById('pause'),
      dead: document.getElementById('dead'),
      deadTitle: document.getElementById('dead-title'),
      deadSub: document.getElementById('dead-sub'),
      card: document.getElementById('missioncard'),
      mcKicker: document.getElementById('mc-kicker'),
      mcTitle: document.getElementById('mc-title'),
      mcBody: document.getElementById('mc-body'),
      mcWho: document.getElementById('mc-who'),
      resume: document.getElementById('btn-resume'),
      save: document.getElementById('btn-save'),
      quit: document.getElementById('btn-quit'),
      cont: document.getElementById('btn-continue'),
      respawn: document.getElementById('btn-respawn'),
    };
    this.state = 'loading';
    this.cardTimer = 0;
    this.cardQueue = [];
  }

  bind() {
    const g = this.game;
    document.getElementById('btn-new').addEventListener('click', () => {
      g.audio.start();
      this.hide('title');
      g.startNewGame();
    });
    if (this.el.cont) this.el.cont.addEventListener('click', () => {
      g.audio.start();
      this.hide('title');
      g.loadGame();
    });
    this.el.resume.addEventListener('click', () => { this.hide('pause'); g.resume(); });
    this.el.save.addEventListener('click', () => {
      g.saveGame();
      this.el.save.textContent = 'Saved';
      setTimeout(() => { this.el.save.textContent = 'Save Game'; }, 1200);
    });
    this.el.quit.addEventListener('click', () => { this.hide('pause'); g.toTitle(); });
    this.el.respawn.addEventListener('click', () => { this.hide('dead'); g.respawn(); });
  }

  ready() {
    this.el.loading.style.display = 'none';
    this.show('title');
    this.state = 'title';
    if (localStorage.getItem('cobaltbay.save.v1')) this.el.cont?.classList.remove('hidden');
  }

  show(id) {
    const n = this.el[id];
    if (n) n.classList.remove('hidden');
    this.state = id;
  }
  hide(id) {
    const n = this.el[id];
    if (n) n.classList.add('hidden');
  }
  hideAll() {
    for (const k of ['title', 'pause', 'dead', 'card']) this.hide(k);
    this.state = 'playing';
  }

  pause() {
    this.show('pause');
    this.state = 'pause';
  }

  wasted(busted) {
    this.el.deadTitle.textContent = busted ? 'Busted' : 'Wasted';
    this.el.deadSub.textContent = busted
      ? 'Cobalt Bay PD · $250 fine'
      : 'Cobalt Bay General · $200 billed';
    this.show('dead');
    this.state = 'dead';
  }

  pushCard(card) {
    this.cardQueue.push(card);
    if (!this.cardTimer) this.nextCard();
  }
  nextCard() {
    const card = this.cardQueue.shift();
    if (!card) { this.hide('card'); this.cardTimer = 0; return; }
    this.el.mcKicker.textContent = card.kicker ?? 'Mission';
    this.el.mcTitle.textContent = card.title ?? '';
    this.el.mcBody.textContent = card.body ?? '';
    this.el.mcWho.textContent = card.who ? `— ${card.who}` : '';
    this.el.card.style.display = 'flex';
    this.cardTimer = 4.2;
  }
  update(dt) {
    if (this.cardTimer > 0) {
      this.cardTimer -= dt;
      if (this.cardTimer <= 0) {
        if (this.cardQueue.length) this.nextCard();
        else { this.hide('card'); this.el.card.style.display = 'none'; }
      }
    }
  }
}
