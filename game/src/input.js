// Keyboard and mouse: WASD state, mouse-look deltas consumed once per frame, and one-shot key
// events (enter/exit, horn, camera, pause, map). Pointer lock is requested on the first click.

export const KEY = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
};

export function createInput(canvas) {
  const down = new Set();
  const pressed = new Set();
  let mouseDX = 0;
  let mouseDY = 0;
  let firing = false;
  let aiming = false;
  let locked = false;
  let sensitivity = 0.0022;

  const onKeyDown = (e) => {
    if (e.repeat) {
      return;
    }
    down.add(e.code);
    pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  };
  const onKeyUp = (e) => down.delete(e.code);
  const onBlur = () => { down.clear(); firing = false; aiming = false; };
  const onMove = (e) => {
    if (!locked) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  };
  const onMouseDown = (e) => {
    if (e.button === 0) firing = true;
    if (e.button === 2) aiming = true;
  };
  const onMouseUp = (e) => {
    if (e.button === 0) firing = false;
    if (e.button === 2) aiming = false;
  };
  const onLockChange = () => { locked = document.pointerLockElement === canvas; };
  const onContext = (e) => e.preventDefault();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMove);
  document.addEventListener('pointerlockchange', onLockChange);
  canvas.addEventListener('contextmenu', onContext);

  return {
    axis() {
      const f = (KEY.forward.some((k) => down.has(k)) ? 1 : 0) - (KEY.back.some((k) => down.has(k)) ? 1 : 0);
      const s = (KEY.right.some((k) => down.has(k)) ? 1 : 0) - (KEY.left.some((k) => down.has(k)) ? 1 : 0);
      return { forward: f, strafe: s };
    },
    isDown: (code) => down.has(code),
    sprinting: () => KEY.sprint.some((k) => down.has(k)),
    takePressed(code) {
      if (pressed.has(code)) { pressed.delete(code); return true; }
      return false;
    },
    pressedAny: () => [...pressed],
    endFrame() { pressed.clear(); mouseDX = 0; mouseDY = 0; },
    takeMouse() {
      const d = { x: mouseDX * sensitivity, y: mouseDY * sensitivity };
      return d;
    },
    get firing() { return firing; },
    get aiming() { return aiming; },
    get locked() { return locked; },
    requestLock() {
      if (!locked && canvas.requestPointerLock) canvas.requestPointerLock();
    },
    releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); },
    setSensitivity(v) { sensitivity = v; },
  };
}
