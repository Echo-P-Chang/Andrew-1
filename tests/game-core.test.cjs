const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../game-core.js');

test('標準配置包含 37 個注音及 4 個聲調，按鍵互不重複', () => {
  assert.equal(core.KEYS.length, 41);
  assert.equal(new Set(core.KEYS.map(item => item.key)).size, 41);
  assert.equal(core.getPool('rookie').length, 8);
  assert.equal(core.getPool('all').length, 37);
  assert.equal(core.getPool('tones').length, 41);
  for (const [key, symbol] of [['1','ㄅ'],['q','ㄆ'],['u','ㄧ'],[';','ㄤ'],['/','ㄥ'],['-','ㄦ'],['6','ˊ']]) {
    assert.equal(core.KEYS.find(item => item.key === key).symbol, symbol);
  }
});
test('每批十題，新秀模式先練完八個，不出連續相同題', () => {
  for (const level of ['rookie', 'all', 'tones']) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const questions = core.createQuestions(level);
      const valid = new Set(core.getPool(level).map(item => item.key));
      assert.equal(questions.length, 10);
      assert.ok(questions.every(item => valid.has(item.key)));
      assert.ok(questions.every((item, i) => !i || item.key !== questions[i - 1].key));
      if (level === 'rookie') assert.equal(new Set(questions.slice(0, 8).map(item => item.key)).size, 8);
    }
  }
});
test('十支一壘安打得七分，比賽仍繼續，三出局後才停止計分', () => {
  const game = core.createGame();
  for (let i = 0; i < 10; i++) {
    const result = core.answer(game, game.questions[i].key.toUpperCase(), { elapsedMs: 1500 });
    assert.equal(result.correct, true);
    assert.equal(result.done, false);
    assert.equal(game.runs, Math.max(0, i - 2));
  }
  assert.deepEqual(game.bases, [true, true, true]);
  assert.equal(core.accuracy(game), 100);
  assert.equal(game.bestStreak, 10);
  assert.equal(game.outs, 0);
  for (let i = 0; i < 9; i++) core.answer(game, '?');
  assert.equal(game.outs, 3);
  assert.deepEqual(core.answer(game, game.questions[game.atBat]?.key ?? '1'), { ignored: true });
  assert.equal(game.attempts, 19);
  assert.equal(game.runs, 7);
});
test('答錯不換題、不前進壘包；修正後繼續，正確率包含錯誤', () => {
  const game = core.createGame();
  const first = game.questions[0];
  core.answer(game, first.key);
  const second = game.questions[1];
  assert.equal(core.answer(game, '?').correct, false);
  assert.equal(game.completed, 1);
  assert.deepEqual(game.bases, [true, false, false]);
  assert.equal(game.questions[game.atBat], second);
  assert.equal(game.streak, 0);
  assert.deepEqual(game.mistakes, [second.symbol]);
  core.answer(game, second.key);
  assert.equal(game.streak, 1);
  assert.equal(core.accuracy(game), 67);
});
test('重新開始不保留前一輪分數、壘包或錯誤', () => {
  const before = core.createGame();
  before.questions.forEach(item => core.answer(before, item.key));
  const after = core.createGame();
  assert.equal(after.runs, 0);
  assert.equal(after.completed, 0);
  assert.equal(after.attempts, 0);
  assert.equal(after.strikes, 0);
  assert.equal(after.outs, 0);
  assert.equal(after.atBat, 0);
  assert.deepEqual(after.history, []);
  assert.deepEqual(after.mistakes, []);
  assert.deepEqual(after.bases, [false, false, false]);
});
test('前兩次答錯保留題目，第三次三振換打者，好球數歸零且壘包不動', () => {
  const game = core.createGame();
  core.answer(game, game.questions[0].key);
  const target = game.questions[1];
  for (let strike = 1; strike <= 2; strike++) {
    const result = core.answer(game, '?');
    assert.equal(result.strikes, strike);
    assert.equal(result.strikeout, false);
    assert.equal(game.strikes, strike);
    assert.equal(game.outs, 0);
    assert.equal(game.atBat, 1);
  }
  const result = core.answer(game, '?');
  assert.equal(result.strikeout, true);
  assert.equal(result.target, target);
  assert.equal(result.done, false);
  assert.equal(game.outs, 1);
  assert.equal(game.strikes, 0);
  assert.equal(game.atBat, 2);
  assert.equal(game.completed, 1);
  assert.deepEqual(game.bases, [true, false, false]);
  assert.deepEqual(game.history.map(item => item.type), ['hit', 'out']);
});
test('兩好球後安打清空好球數，下一位打者從零好球開始', () => {
  const game = core.createGame();
  core.answer(game, '?'); core.answer(game, '?');
  core.answer(game, game.questions[game.atBat].key);
  assert.equal(game.strikes, 0);
  assert.equal(game.outs, 0);
  assert.equal(game.completed, 1);
  core.answer(game, '?');
  assert.equal(game.strikes, 1);
  assert.equal(game.outs, 0);
});
test('九次錯誤造成三出局並結束，結束後作答不更動任何成績', () => {
  const game = core.createGame();
  for (let i = 0; i < 9; i++) {
    const result = core.answer(game, '?');
    assert.equal(result.done, i === 8);
  }
  assert.equal(game.outs, 3);
  assert.equal(game.completed, 0);
  assert.equal(core.accuracy(game), 0);
  const snapshot = JSON.stringify(game);
  assert.deepEqual(core.answer(game, '1'), { ignored: true });
  assert.equal(JSON.stringify(game), snapshot);
});
test('超過十位打者自動補題，仍可繼續安打且跨批次不重複相鄰題目', () => {
  for (const level of ['rookie', 'all', 'tones']) {
    const game = core.createGame(level);
    for (let i = 0; i < 45; i++) {
      const target = game.questions[game.atBat];
      assert.ok(target);
      assert.equal(core.answer(game, target.key).done, false);
    }
    assert.equal(game.completed, 45);
    assert.equal(game.runs, 42);
    assert.equal(game.outs, 0);
    assert.ok(game.questions.every((item, i) => !i || item.key !== game.questions[i - 1].key));
  }
});
