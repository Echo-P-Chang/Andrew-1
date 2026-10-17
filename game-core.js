/* 純遊戲規則：可以先改 ROOKIE 的練習符號，再看看遊戲會發生什麼變化。 */
(function (root) {
  'use strict';
  const QUESTION_BATCH_SIZE = 10;
  const MAX_STRIKES = 3;
  const MAX_OUTS = 3;
  const ANSWER_TIME_MS = 5000;
  const HOME_RUN_TIME_MS = 1000;
  const SPEED_FULL_POINTS_MS = 500;
  const ROWS = [
    [['1','ㄅ'],['2','ㄉ'],['3','ˇ'],['4','ˋ'],['5','ㄓ'],['6','ˊ'],['7','˙'],['8','ㄚ'],['9','ㄞ'],['0','ㄢ'],['-','ㄦ']],
    [['q','ㄆ'],['w','ㄊ'],['e','ㄍ'],['r','ㄐ'],['t','ㄔ'],['y','ㄗ'],['u','ㄧ'],['i','ㄛ'],['o','ㄟ'],['p','ㄣ']],
    [['a','ㄇ'],['s','ㄋ'],['d','ㄎ'],['f','ㄑ'],['g','ㄕ'],['h','ㄘ'],['j','ㄨ'],['k','ㄜ'],['l','ㄠ'],[';','ㄤ']],
    [['z','ㄈ'],['x','ㄌ'],['c','ㄏ'],['v','ㄒ'],['b','ㄖ'],['n','ㄙ'],['m','ㄩ'],[',','ㄝ'],['.','ㄡ'],['/','ㄥ']]
  ];
  const KEYS = ROWS.flat().map(([key, symbol]) => ({ key, symbol }));
  const TONES = ['ˇ', 'ˋ', 'ˊ', '˙'];
  const ROOKIE = ['ㄅ','ㄆ','ㄇ','ㄈ','ㄉ','ㄊ','ㄋ','ㄌ'];
  function getPool(level) {
    return KEYS.filter(item => level === 'rookie' ? ROOKIE.includes(item.symbol) : level === 'tones' || !TONES.includes(item.symbol));
  }
  // 洗牌袋讓每個符號都有機會練到，也避免連續出現同一題。
  function createQuestions(level, random = Math.random, previousKey = null) {
    const pool = getPool(level);
    const result = [];
    while (result.length < QUESTION_BATCH_SIZE) {
      const bag = [...pool];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      const lastKey = result.length ? result[result.length - 1].key : previousKey;
      if (bag[0].key === lastKey) [bag[0], bag[1]] = [bag[1], bag[0]];
      result.push(...bag.slice(0, QUESTION_BATCH_SIZE - result.length));
    }
    return result;
  }
  function createGame(level = 'rookie', random = Math.random) {
    return { level, random, questions: createQuestions(level, random), atBat: 0, completed: 0, attempts: 0, strikes: 0, outs: 0, history: [], mistakes: [], streak: 0, bestStreak: 0, runs: 0, homeRuns: 0, timeouts: 0, skillPoints: 0, responseTimes: [], batterElapsedMs: 0, windowElapsedMs: 0, bases: [false, false, false] };
  }
  function nextBatter(game) {
    game.atBat++;
    game.strikes = 0;
    game.batterElapsedMs = 0;
    game.windowElapsedMs = 0;
    if (game.outs < MAX_OUTS && game.atBat >= game.questions.length) {
      game.questions.push(...createQuestions(game.level, game.random, game.questions.at(-1).key));
    }
  }
  function answer(game, key, { elapsedMs = 1500, timedOut = false } = {}) {
    if (game.outs >= MAX_OUTS) return { ignored: true };
    const target = game.questions[game.atBat];
    const responseMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : ANSWER_TIME_MS;
    timedOut = timedOut || responseMs >= ANSWER_TIME_MS;
    // elapsedMs 是目前這一輪五秒內的時間；連續按錯不能重複加總前一段。
    const windowTime = timedOut ? ANSWER_TIME_MS : responseMs;
    game.batterElapsedMs += Math.max(0, windowTime - game.windowElapsedMs);
    game.windowElapsedMs = timedOut ? 0 : windowTime;
    game.attempts++;
    if (timedOut || typeof key !== 'string' || key.toLowerCase() !== target.key) {
      if (timedOut) game.timeouts++;
      game.mistakes.push(target.symbol);
      game.streak = 0;
      game.strikes++;
      if (game.strikes === MAX_STRIKES) {
        game.outs++;
        game.history.push({ type: 'out', symbol: target.symbol });
        nextBatter(game);
        return { correct: false, target, timedOut, strikeout: true, strikes: MAX_STRIKES, done: game.outs === MAX_OUTS };
      }
      return { correct: false, target, timedOut, strikeout: false, strikes: game.strikes, done: false };
    }
    const homeRun = game.strikes === 0 && game.batterElapsedMs <= HOME_RUN_TIME_MS;
    const run = homeRun ? 1 + game.bases.filter(Boolean).length : game.bases[2] ? 1 : 0;
    game.bases = homeRun ? [false, false, false] : [true, game.bases[0], game.bases[1]];
    game.runs += run;
    if (homeRun) game.homeRuns++;
    const points = speedPoints(game.batterElapsedMs);
    game.skillPoints += points;
    game.responseTimes.push(game.batterElapsedMs);
    game.completed++;
    game.streak++;
    game.bestStreak = Math.max(game.bestStreak, game.streak);
    game.history.push({ type: homeRun ? 'homeRun' : 'hit', symbol: target.symbol, responseMs: game.batterElapsedMs, points });
    nextBatter(game);
    return { correct: true, run, homeRun, points, responseMs: game.responseTimes.at(-1), done: false };
  }
  function speedPoints(elapsedMs) {
    const time = Math.min(ANSWER_TIME_MS, Math.max(SPEED_FULL_POINTS_MS, elapsedMs));
    return Math.round(100 - 80 * (time - SPEED_FULL_POINTS_MS) / (ANSWER_TIME_MS - SPEED_FULL_POINTS_MS));
  }
  function accuracy(game) { return game.attempts ? Math.round(game.completed / game.attempts * 100) : 0; }
  function mastery(game) {
    const score = game.attempts ? Math.round(game.skillPoints / game.attempts) : 0;
    const averageMs = game.responseTimes.length ? Math.round(game.responseTimes.reduce((sum, time) => sum + time, 0) / game.responseTimes.length) : null;
    const fastestMs = game.responseTimes.length ? Math.min(...game.responseTimes) : null;
    const rank = score >= 90 ? '注音打擊王' : score >= 70 ? '快手強打' : score >= 40 ? '穩定打者' : '新秀打者';
    return { score, rank, averageMs, fastestMs };
  }
  const api = { QUESTION_BATCH_SIZE, MAX_STRIKES, MAX_OUTS, ANSWER_TIME_MS, HOME_RUN_TIME_MS, ROWS, KEYS, getPool, createQuestions, createGame, answer, accuracy, speedPoints, mastery };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BaseballGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
