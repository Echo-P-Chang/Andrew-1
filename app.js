'use strict';
const $ = id => document.getElementById(id);
const Core = window.BaseballGame;
let game = null;
let phase = 'ready';
let forceHint = false;
let wrongTimer;
let outTimer;
let clockFrame;
let clockTimeout;
let questionStartedAt = 0;
let deadline = 0;
let pausedAt = null;
let clockVersion = 0;
const stadiumAudio = new window.BaseballEffects.StadiumAudio();
const ballpark = new window.BaseballEffects.BallparkEffects($('field'));
const keyButtons = new Map();
const keyCodes = { Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Minus: '-' };

// 建立和家裡電腦位置相同的注音鍵盤。
Core.ROWS.forEach((row, index) => {
  const rowElement = document.createElement('div');
  rowElement.className = `keyboard-row row-${index}`;
  row.forEach(([key, symbol]) => {
    const button = document.createElement('button');
    button.className = 'key';
    button.type = 'button';
    button.setAttribute('aria-label', `${symbol}，按鍵 ${key.toUpperCase()}`);
    const latin = document.createElement('span');
    latin.className = 'latin-key';
    latin.textContent = key.toUpperCase();
    const zhuyin = document.createElement('span');
    zhuyin.className = 'zhuyin-key';
    zhuyin.textContent = symbol;
    button.append(latin, zhuyin);
    button.addEventListener('click', () => submit(key));
    rowElement.append(button);
    keyButtons.set(key, button);
  });
  $('keyboard').append(rowElement);
});

function target() { return game?.questions[game.atBat]; }
function updateKeyboard() {
  const pool = new Set(Core.getPool($('level').value).map(item => item.key));
  const clue = phase === 'playing' && ($('auto-hint').checked || forceHint);
  keyButtons.forEach((button, key) => {
    button.classList.toggle('outside-pool', !pool.has(key));
    button.classList.toggle('answer-key', !!clue && key === target()?.key);
    button.disabled = phase !== 'playing';
  });
}
function updateScore(visual = {}) {
  $('score').textContent = visual.runs ?? game?.runs ?? 0;
  $('hits').textContent = game?.completed ?? 0;
  $('streak').textContent = game?.streak ?? 0;
  $('mastery-live').textContent = game ? Core.mastery(game).score : 0;
  $('home-runs-live').textContent = `${game?.homeRuns ?? 0} 支全壘打`;
  const strikes = visual.strikes ?? game?.strikes ?? 0;
  const outs = game?.outs ?? 0;
  $('strikes').textContent = strikes;
  $('outs').textContent = outs;
  $('strike-lights').setAttribute('aria-label', `${strikes} 好球`);
  $('out-lights').setAttribute('aria-label', `${outs} 人出局`);
  [...$('strike-lights').children].forEach((light, i) => light.classList.toggle('lit', i < strikes));
  [...$('out-lights').children].forEach((light, i) => light.classList.toggle('lit', i < outs));
  $('pitch-track').replaceChildren();
  const history = game?.history ?? [];
  const recent = history.slice(phase === 'done' ? -10 : -9);
  recent.forEach((record, i) => {
    const item = document.createElement('li');
    item.textContent = record.type === 'homeRun' ? 'HR' : record.type === 'hit' ? 'H' : 'K';
    item.className = record.type === 'homeRun' ? 'home-run-record' : record.type === 'hit' ? 'completed' : 'strikeout-record';
    item.setAttribute('aria-label', `第 ${history.length - recent.length + i + 1} 位打者：${record.symbol}，${record.type === 'homeRun' ? '全壘打' : record.type === 'hit' ? '安打' : '三振'}`);
    $('pitch-track').append(item);
  });
  if (phase === 'playing' || phase === 'ready') {
    const current = document.createElement('li');
    current.className = 'current';
    current.textContent = '●';
    current.setAttribute('aria-label', '目前打者');
    $('pitch-track').append(current);
  }
  const occupied = [];
  for (let i = 0; i < 3; i++) {
    const hasRunner = (visual.bases ?? game?.bases)?.[i] ?? false;
    $(`base-${i + 1}`).classList.toggle('occupied', hasRunner);
    if (hasRunner) occupied.push(`${['一','二','三'][i]}壘`);
  }
  $('bases-svg').setAttribute('aria-label', occupied.length ? `${occupied.join('、')}有人` : '目前壘包無人');
  $('base-label').textContent = occupied.length ? `${occupied.join('、')}有人` : '等待第一支安打';
  $('progress-fill').style.width = `${outs / Core.MAX_OUTS * 100}%`;
}
function renderQuestion() {
  forceHint = false;
  $('target').textContent = target().symbol;
  $('ball-counter').textContent = `第 ${game.atBat + 1} 位打者`;
  $('prompt-label').textContent = '找到這個注音的按鍵';
  $('feedback').textContent = '5 秒內答對；1 秒內直接答對，全壘打！';
  $('feedback').className = 'feedback';
  updateClue();
  updateKeyboard();
  updateScore();
  startQuestionClock();
}
function stopQuestionClock() {
  clearTimeout(clockTimeout);
  cancelAnimationFrame(clockFrame);
  clockVersion++;
}
function scheduleClock() {
  stopQuestionClock();
  if (document.hidden) { pausedAt = performance.now(); $('clock-label').textContent = '暫停計時，回來繼續'; return; }
  const version = clockVersion;
  $('clock-label').textContent = '投手準備中，趕快揮棒！';
  const tick = () => {
    if (phase !== 'playing' || version !== clockVersion) return;
    const remaining = Math.max(0, deadline - performance.now());
    $('clock-seconds').textContent = (remaining / 1000).toFixed(1);
    $('clock-fill').style.width = `${remaining / Core.ANSWER_TIME_MS * 100}%`;
    $('answer-clock').classList.toggle('urgent', remaining <= 1500);
    if (remaining === 0) handleTimeout();
    else clockFrame = requestAnimationFrame(tick);
  };
  clockTimeout = setTimeout(() => { if (version === clockVersion && phase === 'playing') handleTimeout(); }, Math.max(0, deadline - performance.now()));
  clockFrame = requestAnimationFrame(tick);
}
function startQuestionClock() {
  questionStartedAt = performance.now();
  deadline = questionStartedAt + Core.ANSWER_TIME_MS;
  pausedAt = null;
  $('clock-seconds').textContent = '5.0';
  $('clock-fill').style.width = '100%';
  $('answer-clock').classList.remove('urgent');
  scheduleClock();
}
function handleTimeout() {
  if (phase !== 'playing' || document.hidden) return;
  stopQuestionClock();
  phase = 'animating';
  const result = Core.answer(game, null, { elapsedMs: Core.ANSWER_TIME_MS, timedOut: true });
  $('clock-seconds').textContent = '0.0';
  $('clock-fill').style.width = '0%';
  $('clock-label').textContent = '時間到！';
  $('feedback').textContent = '五秒到了！投手投球，打者沒有揮棒，記一個好球。';
  $('feedback').className = 'feedback try-again';
  $('field-comment').textContent = '投手出手！打者未揮棒，主審判好球！';
  updateScore({ strikes: result.strikes });
  updateKeyboard();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  stadiumAudio.play('miss', { reduced });
  ballpark.playMiss({ reduced }).then(finished => {
    if (!finished) return;
    if (result.strikeout) showStrikeout(result);
    else { phase = 'playing'; showWrongAnswer(result); }
  });
}
function showWrongAnswer(result, key) {
  forceHint = true;
  $('feedback').textContent = `${result.timedOut ? '超時未揮棒！' : ''}第 ${result.strikes} 個好球！${target().symbol} 在 ${target().key.toUpperCase()} 鍵，還有 ${Core.MAX_STRIKES - result.strikes} 次機會。`;
  $('feedback').className = 'feedback try-again';
  $('field-comment').textContent = result.strikes === 2 ? '兩好球！看準亮起的按鍵，再揮棒！' : '一好球！調整一下，下一次一定可以！';
  updateClue();
  updateKeyboard();
  updateScore();
  keyButtons.forEach(button => button.classList.remove('wrong-key'));
  keyButtons.get(key)?.classList.add('wrong-key');
  clearTimeout(wrongTimer);
  wrongTimer = setTimeout(() => keyButtons.forEach(button => button.classList.remove('wrong-key')), 550);
  if (result.timedOut) startQuestionClock();
  else scheduleClock();
}
function updateClue() {
  const show = $('auto-hint').checked || forceHint;
  $('key-clue').replaceChildren();
  if (show && target()) {
    $('key-clue').append('找到鍵盤上的 ');
    const kbd = document.createElement('kbd');
    kbd.textContent = target().key.toUpperCase();
    $('key-clue').append(kbd);
  } else $('key-clue').textContent = '看一看，它在鍵盤的哪裡？';
}
function startGame() {
  stopQuestionClock();
  ballpark.cancel();
  stadiumAudio.stop();
  stadiumAudio.startSession();
  stadiumAudio.play('start');
  clearTimeout(wrongTimer);
  clearTimeout(outTimer);
  $('out-flash').hidden = true;
  $('field').classList.remove('strikeout-play');
  game = Core.createGame($('level').value);
  phase = 'playing';
  ballpark.renderRunners(game.bases);
  $('play-panel').hidden = false;
  $('result-panel').hidden = true;
  $('start').hidden = true;
  $('hint').hidden = false;
  $('level').disabled = true;
  $('field-comment').textContent = '打者就位，找準按鍵，準備揮棒！';
  $('coach-copy').innerHTML = '教練提醒：先切換到<strong>英文輸入法</strong>，就能用鍵盤打擊囉！';
  renderQuestion();
  document.activeElement?.blur();
}
function submit(key) {
  if (phase !== 'playing' || pausedAt !== null) return;
  const elapsedMs = performance.now() - questionStartedAt;
  if (elapsedMs >= Core.ANSWER_TIME_MS) { handleTimeout(); return; }
  stopQuestionClock();
  const before = { bases: [...game.bases], runs: game.runs };
  const result = Core.answer(game, key, { elapsedMs });
  if (!result.correct) {
    if (result.strikeout) { showStrikeout(result); return; }
    stadiumAudio.play('wrong');
    showWrongAnswer(result, key);
    return;
  }
  phase = 'animating';
  const type = result.homeRun ? 'homeRun' : Math.random() < .5 ? 'ground' : 'fly';
  $('clock-label').textContent = result.homeRun ? '全壘打！跑者繞壘中' : '擊球成功，跑者推進中';
  const side = Math.random() < .5 ? -1 : 1;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('feedback').textContent = result.homeRun ? `${(result.responseMs / 1000).toFixed(2)} 秒！全壘打，帶回 ${result.run} 分！` : `${result.responseMs > elapsedMs + 1 ? '累計 ' : ''}${(result.responseMs / 1000).toFixed(2)} 秒答對！安打，跑者前進！`;
  $('feedback').className = 'feedback success';
  $('field-comment').textContent = result.homeRun ? '這球飛越外野全壘打牆！所有跑者繞壘回家！' : type === 'ground' ? '強勁滾地球穿越內野！跑者全力衝刺！' : '球飛向外野！落地形成安打，跑者趕快推進！';
  $('hit-flash').querySelector('small').textContent = result.homeRun ? '1 秒內答對，超快反應！' : type === 'ground' ? '穿越內野，漂亮！' : '飛越內野，落地安打！';
  $('hit-flash').querySelector('strong').textContent = result.homeRun ? '全壘打！' : type === 'ground' ? '滾地安打！' : '高飛安打！';
  $('hit-flash').querySelector('span').textContent = result.homeRun ? 'HOME RUN!' : type === 'ground' ? 'GROUND BALL' : 'FLY BALL';
  $('running-call').textContent = result.homeRun ? `全體跑者回家！${result.run} 分全壘打！` : result.run ? '三壘跑者衝本壘！' : '快跑！往下一個壘包！';
  stadiumAudio.play('hit', { type, run: result.run, reduced });
  updateScore(before);
  updateKeyboard();
  ballpark.playHit({ bases: before.bases, type, side, run: result.run, reduced }).then(finished => {
    if (!finished) return;
    ballpark.renderRunners(game.bases);
    if (result.run || game.completed % 3 === 0) stadiumAudio.cheer();
    $('field-comment').textContent = result.homeRun ? `全壘打帶回 ${result.run} 分！目前 ${game.runs} 分！` : result.run ? `跑者安全回到本壘！拿下 1 分，目前 ${game.runs} 分！` : '安全上壘！小小強打隊再添一支安打！';
    if (result.done) showResults();
    else { phase = 'playing'; renderQuestion(); }
  });
}
function showStrikeout(result) {
  stopQuestionClock();
  $('clock-label').textContent = result.done ? '三人出局，本關結束' : '三振出局，換下一位打者';
  phase = 'animating';
  ballpark.cancel();
  $('field').classList.add('strikeout-play');
  $('out-flash').hidden = false;
  $('out-call').textContent = result.done ? '三人出局！這一關結束了。' : `第 ${game.outs} 人出局，換下一位打者！`;
  $('feedback').textContent = `三振！${result.target.symbol} 的按鍵是 ${result.target.key.toUpperCase()}。`;
  $('feedback').className = 'feedback try-again';
  $('field-comment').textContent = result.done ? '三人出局，本關結束！一起看看這次的成績。' : `三振出局！目前 ${game.outs} 人出局，下一位打者加油！`;
  stadiumAudio.play('strikeout');
  updateScore({ strikes: Core.MAX_STRIKES });
  updateKeyboard();
  outTimer = setTimeout(() => {
    $('out-flash').hidden = true;
    $('field').classList.remove('strikeout-play');
    if (result.done) showResults();
    else { phase = 'playing'; renderQuestion(); stadiumAudio.cheer(); }
  }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 550 : 1500);
}
function showResults() {
  stopQuestionClock();
  phase = 'done';
  stadiumAudio.endSession();
  stadiumAudio.play('finish');
  $('level').disabled = false;
  $('play-panel').hidden = true;
  $('result-panel').hidden = false;
  $('ball-counter').textContent = '3 人出局 · 本關結束';
  $('result-runs').textContent = game.runs;
  $('result-hits').textContent = game.completed;
  $('result-accuracy').textContent = `${Core.accuracy(game)}%`;
  const skill = Core.mastery(game);
  const seconds = ms => ms === null ? '—' : `${(ms / 1000).toFixed(2)} 秒`;
  $('result-mastery').textContent = skill.score;
  $('result-rank').textContent = skill.rank;
  $('mastery-fill').style.width = `${skill.score}%`;
  $('result-average').textContent = seconds(skill.averageMs);
  $('result-fastest').textContent = seconds(skill.fastestMs);
  $('result-home-runs').textContent = `${game.homeRuns} 支`;
  $('result-timeouts').textContent = `${game.timeouts} 次`;
  $('result-message').textContent = `三人出局！你擊出了 ${game.completed} 支安打，最多連續答對 ${game.bestStreak} 次。再挑戰一次，把分數打得更高！`;
  const review = [...new Set(game.mistakes.length ? game.mistakes : game.history.map(item => item.symbol))];
  $('review-title').textContent = game.mistakes.length ? '下一輪再練練這幾個' : '今天練過的注音，全都掌握了！';
  $('review-symbols').replaceChildren(...review.map(symbol => {
    const chip = document.createElement('span');
    const item = Core.KEYS.find(item => item.symbol === symbol);
    chip.textContent = `${symbol} · ${item.key.toUpperCase()}`;
    return chip;
  }));
  $('field-comment').textContent = '練習賽結束！給努力練習的自己一個掌聲。';
  updateKeyboard();
  updateScore();
}
$('start').addEventListener('click', startGame);
$('again').addEventListener('click', startGame);
$('hint').addEventListener('click', () => { if (phase !== 'playing') return; forceHint = true; updateClue(); updateKeyboard(); });
$('auto-hint').addEventListener('change', () => { forceHint = false; if (phase === 'playing') updateClue(); updateKeyboard(); });
$('level').addEventListener('change', updateKeyboard);
$('sound-toggle').addEventListener('click', () => {
  stadiumAudio.setEnabled(!stadiumAudio.enabled);
  $('sound-toggle').textContent = `聲音：${stadiumAudio.enabled ? '開' : '關'}`;
  $('sound-toggle').setAttribute('aria-pressed', String(stadiumAudio.enabled));
  $('sound-toggle').title = stadiumAudio.enabled ? '關閉所有聲音' : '開啟所有聲音';
  if (stadiumAudio.enabled) stadiumAudio.play('toggle');
});
$('music-toggle').addEventListener('click', () => {
  stadiumAudio.setMusicEnabled(!stadiumAudio.musicEnabled);
  $('music-toggle').textContent = `配樂：${stadiumAudio.musicEnabled ? '開' : '關'}`;
  $('music-toggle').setAttribute('aria-pressed', String(stadiumAudio.musicEnabled));
});
$('cheer-toggle').addEventListener('click', () => {
  stadiumAudio.setCheersEnabled(!stadiumAudio.cheersEnabled);
  $('cheer-toggle').textContent = `加油：${stadiumAudio.cheersEnabled ? '開' : '關'}`;
  $('cheer-toggle').setAttribute('aria-pressed', String(stadiumAudio.cheersEnabled));
  if (stadiumAudio.cheersEnabled && stadiumAudio.sessionActive) stadiumAudio.cheer(true);
});
['music', 'effect'].forEach(channel => {
  $(`${channel}-volume`).addEventListener('input', event => {
    const value = Number(event.target.value);
    $(`${channel}-volume-label`).textContent = `${value}%`;
    stadiumAudio.setVolume(channel, value / 100);
  });
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stadiumAudio.stop();
    if (phase === 'playing' && pausedAt === null) { pausedAt = performance.now(); stopQuestionClock(); $('clock-label').textContent = '暫停計時，回來繼續'; }
  } else {
    if (stadiumAudio.sessionActive) stadiumAudio.startMusic();
    if (phase === 'playing' && pausedAt !== null) {
      const pausedFor = performance.now() - pausedAt;
      questionStartedAt += pausedFor;
      deadline += pausedFor;
      pausedAt = null;
      scheduleClock();
    }
  }
});
document.addEventListener('keydown', event => {
  if (phase !== 'playing' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.matches('select, textarea, input:not([type="checkbox"]), [contenteditable="true"]')) return;
  if (event.isComposing || event.keyCode === 229) {
    $('coach-copy').textContent = '目前似乎開著中文輸入法。請先切換到英文輸入法，再繼續打擊。';
    return;
  }
  let key = event.key.toLowerCase();
  // 使用實體位置處理標點按鍵，避免不同鍵盤語系的符號差異。
  if (keyCodes[event.code]) key = keyCodes[event.code];
  if (key.length !== 1 || !/^[a-z0-9,.;/\-]$/.test(key)) return;
  event.preventDefault();
  submit(key);
});
updateScore();
updateKeyboard();
