const test = require('node:test');
const assert = require('node:assert/strict');
const { BASES, runnerMoves, ballPosition } = require('../effects.js');

test('空壘只有打者跑向一壘，滿壘時四位跑者各前進一壘', () => {
  assert.deepEqual(runnerMoves([false, false, false]), [{ from: 0, to: 1, scores: false }]);
  assert.deepEqual(runnerMoves([true, true, true]), [
    { from: 0, to: 1, scores: false }, { from: 1, to: 2, scores: false },
    { from: 2, to: 3, scores: false }, { from: 3, to: 4, scores: true }
  ]);
  assert.deepEqual(BASES[0], BASES[4]);
});
test('一、三壘有人時保留正確出發壘包，只有三壘跑者得分', () => {
  assert.deepEqual(runnerMoves([true, false, true]), [
    { from: 0, to: 1, scores: false }, { from: 1, to: 2, scores: false },
    { from: 3, to: 4, scores: true }
  ]);
});
test('兩種球都從擊球點出發並落在場內，高飛球有明顯高度', () => {
  for (const side of [-1, 1]) {
    for (const type of ['ground', 'fly']) {
      const start = ballPosition(0, type, side);
      const end = ballPosition(1, type, side);
      assert.equal(start.x, 430);
      assert.equal(start.y, 478);
      assert.ok(Math.abs(end.y - end.groundY) < .001);
      assert.ok(end.x > 0 && end.x < 1000);
      for (let step = 0; step <= 100; step++) {
        const position = ballPosition(step / 100, type, side);
        assert.ok(position.y > 0 && position.y < 620);
      }
    }
    const ground = ballPosition(.5, 'ground', side);
    const fly = ballPosition(.5, 'fly', side);
    assert.ok(ground.y - fly.y > 240);
  }
});
