const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../game-core.js');
const { runnerMoves, runnerPosition, ballPosition, BASES } = require('../effects.js');
const correct = (game, ms) => Core.answer(game, game.questions[game.atBat].key, { elapsedMs: ms });

test('1 秒含邊界擊出全壘打，超過邊界是一般安打', () => {
  for (const ms of [0, 100, 800, 999, 1000]) {
    const game = Core.createGame();
    assert.equal(correct(game, ms).homeRun, true);
    assert.equal(game.homeRuns, 1);
    assert.equal(game.runs, 1);
    assert.deepEqual(game.bases, [false, false, false]);
    assert.equal(Core.mastery(game).score, Core.speedPoints(ms));
  }
  const game = Core.createGame();
  assert.equal(correct(game, 1001).homeRun, false);
  assert.equal(game.homeRuns, 0);
  assert.equal(game.runs, 0);
  assert.deepEqual(game.bases, [true, false, false]);
});
test('全壘打帶回打者及每位壘上跑者，包含滿貫四分，壘包全部清空', () => {
  for (let mask = 0; mask < 8; mask++) {
    const game = Core.createGame();
    game.bases = [0, 1, 2].map(bit => Boolean(mask & (1 << bit)));
    const expected = 1 + game.bases.filter(Boolean).length;
    const result = correct(game, 350);
    assert.equal(result.run, expected);
    assert.equal(game.runs, expected);
    assert.deepEqual(game.bases, [false, false, false]);
    assert.equal(game.history[0].type, 'homeRun');
  }
});
test('五秒含邊界未答題記錯；即使按對也不能在截止後取得安打', () => {
  for (const ms of [5000, 5001, 10000, Infinity, NaN]) {
    const game = Core.createGame();
    const result = correct(game, ms);
    assert.equal(result.timedOut, true);
    assert.equal(result.correct, false);
    assert.equal(game.timeouts, 1);
    assert.equal(game.strikes, 1);
    assert.equal(game.completed, 0);
    assert.equal(Core.mastery(game).score, 0);
  }
  assert.equal(correct(Core.createGame(), 4999).correct, true);
});
test('超時沿用三振與三出局規則，沒有安打、跑壘或重複計分', () => {
  const game = Core.createGame();
  for (let i = 0; i < 9; i++) {
    const result = Core.answer(game, null, { elapsedMs: 5000 });
    assert.equal(result.done, i === 8);
  }
  assert.equal(game.outs, 3);
  assert.equal(game.timeouts, 9);
  assert.equal(game.attempts, 9);
  assert.deepEqual(Core.answer(game, null, { elapsedMs: 5000 }), { ignored: true });
  assert.equal(game.timeouts, 9);
  assert.deepEqual(game.bases, [false, false, false]);
});
test('答錯後快速重試不會變成全壘打，保留同一個倒數且不重複加總時間', () => {
  const game = Core.createGame();
  Core.answer(game, '?', { elapsedMs: 100 });
  const result = correct(game, 150);
  assert.equal(result.homeRun, false);
  assert.equal(result.responseMs, 150);
  assert.equal(Core.mastery(game).score, 50);
  assert.equal(Core.accuracy(game), 50);
  assert.equal(game.batterElapsedMs, 0);
  assert.equal(correct(game, 150).homeRun, true);
});
test('同一題連續答錯後答對，以原本倒數的時間計算熟練度', () => {
  const game = Core.createGame();
  Core.answer(game, '?', { elapsedMs: 1200 });
  Core.answer(game, '?', { elapsedMs: 2400 });
  const result = correct(game, 3500);
  assert.equal(result.responseMs, 3500);
  assert.equal(result.points, Core.speedPoints(3500));
  assert.equal(result.homeRun, false);
  assert.equal(game.strikes, 0);
});
test('答錯後倒數到五秒，只累積一輪五秒；超時後的新倒數才重新開始', () => {
  const game = Core.createGame();
  Core.answer(game, '?', { elapsedMs: 3000 });
  const result = Core.answer(game, null, { elapsedMs: 5000 });
  assert.equal(result.timedOut, true);
  assert.equal(game.batterElapsedMs, 5000);
  assert.equal(game.windowElapsedMs, 0);
  const corrected = correct(game, 800);
  assert.equal(corrected.responseMs, 5800);
  assert.equal(corrected.homeRun, false);
});
test('熟練度隨答對速度提升，錯誤與超時降低平均分數', () => {
  const times = [500, 1000, 2000, 3000, 4999];
  const scores = times.map(ms => { const game = Core.createGame(); correct(game, ms); return Core.mastery(game).score; });
  assert.ok(scores.every((score, i) => !i || score < scores[i - 1]));
  const game = Core.createGame();
  correct(game, 500); correct(game, 1000);
  Core.answer(game, null, { elapsedMs: 5000 });
  const result = Core.mastery(game);
  assert.equal(result.score, Math.round((100 + Core.speedPoints(1000)) / 3));
  assert.equal(result.averageMs, 750);
  assert.equal(result.fastestMs, 500);
  assert.equal(Core.mastery(Core.createGame()).averageMs, null);
});
test('重新開局清除熟練度、時間和全壘打紀錄', () => {
  const before = Core.createGame();
  correct(before, 200); Core.answer(before, null, { elapsedMs: 5000 });
  const game = Core.createGame();
  assert.equal(game.homeRuns, 0);
  assert.equal(game.timeouts, 0);
  assert.equal(Core.mastery(game).score, 0);
  assert.equal(Core.mastery(game).fastestMs, null);
});
test('全壘打跑者沿四個壘包回本壘，球越過外野牆', () => {
  const moves = runnerMoves([true, true, true], true);
  assert.equal(moves.length, 4);
  assert.ok(moves.every(move => move.to === 4 && move.scores));
  for (const move of moves) {
    const end = runnerPosition(move.from, move.to, 1, true);
    assert.deepEqual([end.x, end.y], BASES[0]);
    assert.equal(end.arrived, true);
  }
  for (let base = 0; base <= 4; base++) {
    const position = runnerPosition(0, 4, base / 4, true);
    assert.deepEqual([position.x, position.y], BASES[base]);
  }
  assert.ok(ballPosition(1, 'homeRun', 1).x > 1000);
  assert.ok(ballPosition(1, 'homeRun', -1).x < 0);
});
