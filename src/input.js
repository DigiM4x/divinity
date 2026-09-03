// ---------------------------------------------------------------------------
// input.js - normalises pointer/keyboard into per-frame flags on state.input.
//
// Systems read state.input; nothing else touches DOM events. Because the hand
// and the camera both want the left button, the hand runs first each frame and
// calls capture('hand') if it grabbed something; the camera then knows to stay
// out of the way for that drag.
// ---------------------------------------------------------------------------

export function initInput(state, domElement) {
  const input = {
    /** Normalised device coords, -1..1, y up. */
    ndc: { x: 0, y: 0 },
    /** Pixel coords within the canvas. */
    screen: { x: 0, y: 0 },
    /** Pixel movement since last frame. */
    delta: { x: 0, y: 0 },
    /** Held state per button: 0 left, 1 middle, 2 right. */
    buttons: [false, false, false],
    /** Pressed-this-frame / released-this-frame edges. */
    pressed: [false, false, false],
    released: [false, false, false],
    wheel: 0,
    keys: new Set(),
    keysPressed: new Set(),
    /** Which system owns the current drag, or null. */
    capturedBy: null,
    pointerInside: false,

    capture(who) { input.capturedBy = who; },
    isCaptured(who) { return input.capturedBy !== null && input.capturedBy !== who; },
    keyDown(code) { return input.keys.has(code); },
    keyPressed(code) { return input.keysPressed.has(code); }
  };

  let accumDx = 0;
  let accumDy = 0;
  let accumWheel = 0;

  function updatePointer(e) {
    const rect = domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    accumDx += x - input.screen.x;
    accumDy += y - input.screen.y;
    input.screen.x = x;
    input.screen.y = y;
    input.ndc.x = (x / rect.width) * 2 - 1;
    input.ndc.y = -(y / rect.height) * 2 + 1;
  }

  domElement.addEventListener('pointermove', updatePointer);

  domElement.addEventListener('pointerenter', (e) => {
    // Seed the position without generating a giant delta on the first move.
    const rect = domElement.getBoundingClientRect();
    input.screen.x = e.clientX - rect.left;
    input.screen.y = e.clientY - rect.top;
    input.pointerInside = true;
  });
  domElement.addEventListener('pointerleave', () => { input.pointerInside = false; });

  domElement.addEventListener('pointerdown', (e) => {
    updatePointer(e);
    if (e.button < 3) {
      input.buttons[e.button] = true;
      input.pressed[e.button] = true;
    }
    // Capture keeps a drag alive when the cursor leaves the canvas. Synthetic
    // events (and some pen/touch cases) have no live pointer to capture and
    // throw InvalidPointerId, which would abort the rest of this handler.
    try { domElement.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    e.preventDefault();
  });

  const endButton = (e) => {
    updatePointer(e);
    if (e.button < 3 && input.buttons[e.button]) {
      input.buttons[e.button] = false;
      input.released[e.button] = true;
    }
    if (!input.buttons[0] && !input.buttons[1] && !input.buttons[2]) input.capturedBy = null;
  };
  domElement.addEventListener('pointerup', endButton);
  domElement.addEventListener('pointercancel', endButton);

  // Losing focus mid-drag would otherwise leave a button stuck down.
  window.addEventListener('blur', () => {
    for (let i = 0; i < 3; i++) {
      if (input.buttons[i]) input.released[i] = true;
      input.buttons[i] = false;
    }
    input.keys.clear();
    input.capturedBy = null;
  });

  domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  domElement.addEventListener('wheel', (e) => {
    accumWheel += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    // Tab is a game key now (the scoreboard), and the browser's default is to
    // walk focus out of the canvas - after which no further key reaches us.
    if (e.code === 'Tab') e.preventDefault();
    if (!input.keys.has(e.code)) input.keysPressed.add(e.code);
    input.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));

  /** Call at the very start of a frame: publish accumulated deltas. */
  input.beginFrame = function beginFrame() {
    input.delta.x = accumDx;
    input.delta.y = accumDy;
    input.wheel = accumWheel;
    accumDx = 0;
    accumDy = 0;
    accumWheel = 0;
  };

  /** Call at the very end of a frame: clear one-shot edges. */
  input.endFrame = function endFrame() {
    input.pressed[0] = input.pressed[1] = input.pressed[2] = false;
    input.released[0] = input.released[1] = input.released[2] = false;
    input.keysPressed.clear();
  };

  state.input = input;
  return input;
}
