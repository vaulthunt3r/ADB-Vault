import test from 'node:test'
import assert from 'node:assert/strict'
import { TouchEngine, analog } from '../dist-electron/touch-engine.js'
import { touchTemplate, validateProfile, validatePoints } from '../dist-electron/touch-protocol.js'
import { defaultTouchHotkeys, touchHotkeys, validTouchHotkey, keyboardHotkey } from '../dist-electron/touch-hotkeys.js'

test('templates are valid, independent editable profiles; duplicate/reserved assignments are rejected', () => {
  for (const type of ['empty', 'shooter', 'racing', 'platformer']) validateProfile(touchTemplate(type))
  const p = touchTemplate('shooter'); p.marks[0].x = .25; assert.equal(touchTemplate('shooter').marks[0].x, .18)
  p.marks[2].bindings[0] = 'KeyW'; assert.throws(() => validateProfile(p), /already assigned/)
  p.marks[2].bindings[0] = 'AltLeft'; assert.throws(() => validateProfile(p), /conflicts with a game control/)
  assert.throws(() => validatePoints([{ id: 0, x: .2, y: .2 }, { id: 0, x: .3, y: .4 }]))
  assert.throws(() => validatePoints([{ id: 0, x: Infinity, y: .5 }]))
})

test('hotkeys validate combinations, conflicts and per-profile persistence without breaking legacy assignments', () => {
  for (const key of ['KeyQ', 'F12', 'AltRight', 'Control+Shift+KeyH', 'Control+AltLeft', 'NumpadEnter', 'BracketLeft', '']) assert.ok(validTouchHotkey(key), key)
  for (const key of ['Escape', 'KeyQ+Control', 'Shift+Control+KeyH', 'Alt+AltLeft', 'Control+Control+KeyH', '--shell', null]) assert.equal(validTouchHotkey(key), false)
  assert.equal(keyboardHotkey({ code: 'KeyH', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }), 'Control+Shift+KeyH')
  const legacy = touchTemplate('racing'); legacy.marks[0].bindings[0] = 'F10'
  validateProfile(legacy); assert.equal(touchHotkeys(legacy).panel, '')
  const p = touchTemplate('racing'); p.hotkeys = { ...defaultTouchHotkeys, release: 'KeyQ', panel: 'Control+KeyH' }
  p.marks[0].bindings[0] = 'AltLeft'; validateProfile(p)
  const saved = JSON.parse(JSON.stringify(p)); validateProfile(saved); assert.deepEqual(touchHotkeys(saved), p.hotkeys)
  saved.hotkeys.panel = 'KeyQ'; assert.throws(() => validateProfile(saved), /already assigned/)
  saved.hotkeys.panel = 'Control+KeyD'; assert.throws(() => validateProfile(saved), /conflicts/)
  saved.hotkeys = null; assert.throws(() => validateProfile(saved), /Invalid hotkey/)
})
test('WASD starts at the stick center, normalizes diagonals and holds fire independently', () => {
  const e = new TouchEngine(), p = touchTemplate('shooter')
  e.held.add('KeyW'); e.held.add('KeyD'); e.held.add('Mouse0')
  const first = e.frame(p, 1600, 900, null, true, 0, 16)
  assert.deepEqual(first.find(v => v.id === 0), { id: 0, x: .18, y: .76 })
  const moved = e.frame(p, 1600, 900, null, true, 16, 16), stick = moved.find(v => v.id === 0)
  assert.ok(Math.abs(Math.hypot((stick.x - .18) * 1600, (stick.y - .76) * 900) - .08 * 900) < 1e-9)
  assert.ok(moved.find(v => v.id === 2)); e.held.delete('Mouse0')
  assert.deepEqual(e.frame(p, 1600, 900, null, true, 32, 16).map(v => v.id), [0])
  e.reset(); assert.deepEqual(e.frame(p, 1600, 900, null, true, 48, 16), [])
})
test('look swipes recenter with a lifted frame while movement and fire remain held', () => {
  const e = new TouchEngine(), p = touchTemplate('shooter')
  e.held.add('KeyW'); e.held.add('Mouse0'); e.move(20, 0)
  assert.deepEqual(e.frame(p, 1000, 600, null, true, 0, 16).map(v => v.id), [0, 1, 2])
  e.move(30, 0); assert.ok(e.frame(p, 1000, 600, null, true, 16, 16).find(v => v.id === 1).x > .68)
  e.move(500, 0); assert.deepEqual(e.frame(p, 1000, 600, null, true, 32, 16).map(v => v.id), [0, 2])
  e.move(10, 0); assert.equal(e.frame(p, 1000, 600, null, true, 48, 16).find(v => v.id === 1).x, .68)
  assert.deepEqual(e.frame(p, 1000, 600, null, true, 200, 16).map(v => v.id), [0, 2])
})
test('gamepad deadzone, analog movement, triggers and right-stick look combine without native forwarding', () => {
  assert.deepEqual(analog(.1, -.1), [0, 0]); assert.ok(Math.hypot(...analog(1, 1)) <= 1)
  const e = new TouchEngine(), p = touchTemplate('shooter'), pad = { axes: [.7, -.5, .4, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 7, value: i === 7 ? .8 : 0 })) }
  e.frame(p, 1600, 900, pad, false, 0, 16)
  const points = e.frame(p, 1600, 900, pad, false, 16, 16)
  assert.deepEqual(points.map(p => p.id), [0, 1, 2]); assert.ok(points[0].x > .18 && points[0].y < .76); assert.ok(points[1].x > .68)
  e.reset(); assert.deepEqual(e.frame(p, 1600, 900, null, false, 1000, 16), [])
})
