/* 球場的動畫與音效。所有素材都在本機，離線也能打球。 */
(function (root) {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';
  const BASES = [[500, 530], [707, 401], [500, 306], [293, 401], [500, 530]];
  const clamp = value => Math.max(0, Math.min(1, value));
  const lerp = (a, b, t) => a + (b - a) * t;

  function runnerMoves(bases, homeRun = false) {
    return [0, ...bases.flatMap((occupied, index) => occupied ? [index + 1] : [])]
      .map(from => ({ from, to: homeRun ? 4 : from + 1, scores: homeRun || from === 3 }));
  }
  function runnerPosition(from, to, progress, homeRun = false) {
    const distance = homeRun ? clamp(progress) * 4 : clamp(progress);
    const base = Math.min(to, from + distance);
    const segment = Math.min(3, Math.floor(base));
    const t = base - segment;
    return { x: lerp(BASES[segment][0], BASES[segment + 1][0], t), y: lerp(BASES[segment][1], BASES[segment + 1][1], t), arrived: base === to };
  }
  function ballPosition(progress, type, side = 1) {
    const t = clamp(progress);
    const homeRun = type === 'homeRun';
    const x = lerp(430, homeRun ? (side > 0 ? 1080 : -80) : side > 0 ? 790 : 225, t);
    const groundY = lerp(478, homeRun ? 190 : 302, t);
    const height = type === 'fly' || homeRun ? 258 * Math.sin(Math.PI * t) : 16 * Math.abs(Math.sin(4 * Math.PI * t)) * (1 - t);
    return { x, y: groundY - height, groundY, scale: lerp(1.25, .65, t) };
  }
  function svgElement(name, attributes = {}) {
    const node = document.createElementNS(SVG, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  class StadiumAudio {
    constructor() {
      this.enabled = true;
      this.musicEnabled = true;
      this.cheersEnabled = true;
      this.sessionActive = false;
      this.context = null;
      this.sources = new Set();
      this.musicSources = new Set();
      this.cheerSources = new Set();
      this.musicTimer = null;
      this.lastCheer = -Infinity;
      this.musicVolume = .75;
      this.effectVolume = .75;
      this.cheerAudio = typeof root.Audio === 'function' ? new root.Audio('assets/cheer.wav') : null;
      if (this.cheerAudio) { this.cheerAudio.volume = .5 * this.effectVolume; this.cheerAudio.preload = 'auto'; }
    }
    unlock() {
      if (!this.enabled) return;
      try {
        this.context ??= new (root.AudioContext || root.webkitAudioContext)();
        if (!this.master) {
          this.master = this.context.createGain();
          this.master.gain.value = .75;
          this.master.connect(this.context.destination);
          this.buses = {};
          for (const group of ['music', 'effect', 'cheer']) {
            const bus = this.context.createGain();
            bus.gain.value = group === 'music' ? this.musicVolume * 1.4 : this.effectVolume * .8;
            bus.connect(this.master);
            this.buses[group] = bus;
          }
          this.noise = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
          const data = this.noise.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        this.context.resume().catch(() => {});
      } catch { this.context = null; }
    }
    setEnabled(enabled) {
      this.enabled = enabled;
      if (!enabled) this.stop();
      else { this.unlock(); this.startMusic(); }
    }
    setVolume(channel, volume) {
      const value = clamp(volume);
      if (channel === 'music') this.musicVolume = value;
      else this.effectVolume = value;
      if (this.buses) {
        for (const group of ['music', 'effect', 'cheer']) {
          const gain = this.buses[group].gain;
          gain.cancelScheduledValues(this.context.currentTime);
          gain.setTargetAtTime(group === 'music' ? this.musicVolume * 1.4 : this.effectVolume * .8, this.context.currentTime, .03);
        }
      }
      if (this.cheerAudio) this.cheerAudio.volume = this.effectVolume * .5;
    }
    setMusicEnabled(enabled) {
      this.musicEnabled = enabled;
      if (enabled) this.startMusic();
      else this.stopMusic();
    }
    setCheersEnabled(enabled) {
      this.cheersEnabled = enabled;
      if (!enabled) this.stopCheer();
    }
    startSession() {
      this.sessionActive = true;
      this.lastCheer = -Infinity;
      this.unlock();
      this.startMusic();
      this.cheer(true);
    }
    endSession() { this.sessionActive = false; this.stop(); }
    stopCheer() {
      if (this.cheerAudio) { this.cheerAudio.pause(); this.cheerAudio.currentTime = 0; }
      this.cheerSources.forEach(source => { try { source.stop(); } catch {} this.sources.delete(source); });
      this.cheerSources.clear();
    }
    cheer(force = false) {
      if (!this.enabled || !this.cheersEnabled || !this.sessionActive || !this.cheerAudio) return;
      const now = performance.now();
      if (!force && now - this.lastCheer < 6500) return;
      this.lastCheer = now;
      this.cheerAudio.currentTime = 0;
      this.cheerAudio.play().catch(() => {});
      if (this.context && this.master) {
        const time = this.context.currentTime;
        [0, .22, .65, .87].forEach(delay => this.hiss(time + delay, .1, .1, 1800, 'bandpass', .01, 'cheer'));
      }
    }
    startMusic() {
      if (!this.enabled || !this.musicEnabled || !this.sessionActive || this.musicTimer !== null) return;
      this.unlock();
      if (!this.context || !this.master) return;
      // 原創的循環球場旋律；短音符排程，避免每一輪疊出多條配樂。
      const melody = [523, 659, 784, 659, 587, 698, 880, 698, 659, 784, 1047, 784, 587, 698, 784, 0];
      const bass = [131, 147, 165, 147];
      this.musicStep = 0;
      this.nextNoteTime = this.context.currentTime + .04;
      const schedule = () => {
        while (this.nextNoteTime < this.context.currentTime + .2) {
          const step = this.musicStep % melody.length;
          const note = melody[step];
          if (note) this.tone(note, this.nextNoteTime, .26, .14, 'triangle', note, 'music');
          if (step % 4 === 0) {
            const low = bass[Math.floor(step / 4)];
            this.tone(low, this.nextNoteTime, .45, .12, 'sine', low, 'music');
            this.tone(low * 3, this.nextNoteTime, .2, .045, 'triangle', low * 3, 'music');
          }
          if (step % 2 === 1) this.hiss(this.nextNoteTime, .06, .055, 2200, 'highpass', .008, 'music');
          this.nextNoteTime += .3;
          this.musicStep++;
        }
      };
      schedule();
      this.musicTimer = setInterval(schedule, 100);
    }
    stopMusic() {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
      this.musicSources.forEach(source => { try { source.stop(); } catch {} this.sources.delete(source); });
      this.musicSources.clear();
    }
    stop() {
      this.stopMusic();
      this.stopCheer();
      this.sources.forEach(source => { try { source.stop(); } catch {} });
      this.sources.clear();
    }
    track(source, group) {
      this.sources.add(source);
      if (group === 'music') this.musicSources.add(source);
      if (group === 'cheer') this.cheerSources.add(source);
      source.onended = () => { this.sources.delete(source); this.musicSources.delete(source); this.cheerSources.delete(source); };
    }
    tone(frequency, at, duration, volume = .08, type = 'sine', endFrequency = frequency, group = 'effect') {
      const oscillator = this.context.createOscillator();
      const envelope = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, at);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(volume, at + .008);
      envelope.gain.exponentialRampToValueAtTime(.001, at + duration);
      oscillator.connect(envelope).connect(this.buses[group] ?? this.master);
      this.track(oscillator, group);
      oscillator.start(at);
      oscillator.stop(at + duration + .01);
    }
    hiss(at, duration, volume, frequency, filterType = 'bandpass', fade = .01, group = 'effect') {
      const source = this.context.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const filter = this.context.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = frequency;
      filter.Q.value = .7;
      const envelope = this.context.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(volume, at + fade);
      envelope.gain.exponentialRampToValueAtTime(.001, at + duration);
      source.connect(filter).connect(envelope).connect(this.buses[group] ?? this.master);
      this.track(source, group);
      source.start(at);
      source.stop(at + duration + .01);
    }
    play(kind, { type = 'ground', run = false, reduced = false } = {}) {
      this.unlock();
      if (!this.enabled || !this.context || !this.master) return;
      const now = this.context.currentTime + .015;
      if (kind === 'wrong') { this.tone(330, now, .18, .06, 'sine', 260); return; }
      if (kind === 'miss') {
        this.hiss(now, reduced ? .12 : .55, .2, 1200, 'bandpass', .04);
        this.hiss(now + (reduced ? .12 : .58), .12, .27, 550, 'lowpass');
        this.tone(110, now + (reduced ? .12 : .58), .12, .16, 'triangle', 65);
        return;
      }
      if (kind === 'strikeout') {
        this.hiss(now, .12, .16, 700, 'lowpass');
        [392, 330, 262].forEach((note, i) => this.tone(note, now + i * .13, .25, .1, 'triangle'));
        return;
      }
      if (kind === 'start' || kind === 'finish' || kind === 'toggle') {
        const notes = kind === 'finish' ? [523, 659, 784, 1047] : [392, 523, 659];
        notes.forEach((note, i) => this.tone(note, now + i * .12, .25, .07, 'triangle'));
        return;
      }
      if (kind !== 'hit') return;
      const speed = reduced ? .2 : 1;
      const contact = now + .33 * speed;
      // 投球風聲 → 木棒擊球 → 球場歡呼，與畫面同時發生。
      this.hiss(now, .28 * speed, .12, 1100, 'bandpass', .04 * speed);
      this.hiss(contact, .13, .48, 2300, 'highpass');
      this.tone(190, contact, .15, .32, 'triangle', 65);
      this.tone(920, contact, .07, .12, 'triangle', 350);
      if (this.cheersEnabled) {
        this.hiss(contact + .12, 1.7 * speed, .19, 1050, 'bandpass', .18 * speed, 'cheer');
        [420, 560, 700].forEach((frequency, i) => this.tone(frequency, contact + (.18 + i * .08) * speed, .6 * speed, .025, 'triangle', frequency * 1.15, 'cheer'));
      }
      if (type === 'homeRun') {
        this.tone(500, contact + .07, .8 * speed, .08, 'sine', 1400);
        [523, 659, 784, 1047, 784, 1047, 1319].forEach((note, i) => this.tone(note, now + (1.7 + i * .17) * speed, .4, .14, 'triangle'));
        if (this.cheersEnabled) this.hiss(contact + .2, 3 * speed, .32, 1200, 'bandpass', .15 * speed, 'cheer');
      } else if (type === 'fly') this.tone(550, contact + .07, .6 * speed, .055, 'sine', 1100);
      else [ .62, .9, 1.15 ].forEach(at => {
        this.hiss(now + at * speed, .06, .09, 450, 'lowpass');
        this.tone(95, now + at * speed, .05, .05, 'sine', 50);
      });
      for (let i = 0; i < (type === 'homeRun' ? 18 : 10); i++) this.hiss(now + (.8 + i * .15) * speed, .055, i % 2 ? .08 : .12, 650, 'lowpass');
      if (run) {
        const scoringTime = type === 'homeRun' ? 3.6 : 2.3;
        [523, 659, 784, 1047].forEach((note, i) => this.tone(note, now + (scoringTime + i * .1) * speed, .3, .09, 'triangle'));
        if (this.cheersEnabled) this.hiss(now + (scoringTime - .05) * speed, .7, .22, 1400, 'bandpass', .08, 'cheer');
      }
    }
  }

  class BallparkEffects {
    constructor(field) {
      this.field = field;
      this.layer = field.querySelector('#runner-layer');
      this.frame = 0;
      this.resolve = null;
    }
    makeRunner() {
      const group = svgElement('g', { class: 'field-runner' });
      const sprite = document.querySelector('#runner-sprite').cloneNode(true);
      sprite.removeAttribute('id');
      group.append(sprite);
      this.layer.append(group);
      return { group, sprite, body: sprite.querySelector('.runner-body'), limbs: [...sprite.querySelectorAll('.runner-leg, .runner-arm')] };
    }
    placeRunner(runner, x, y, stride = 0) {
      runner.group.setAttribute('transform', `translate(${x} ${y})`);
      runner.sprite.setAttribute('transform', `scale(${lerp(.72, 1.3, clamp((y - 300) / 230))})`);
      runner.body.setAttribute('transform', `translate(0 ${-Math.abs(stride) * 2})`);
      runner.limbs.forEach((limb, index) => {
        const angle = stride * (index % 2 ? 32 : -32);
        limb.setAttribute('transform', `rotate(${angle} 0 ${index < 2 ? -15 : -31})`);
      });
    }
    renderRunners(bases) {
      this.layer.replaceChildren();
      bases.forEach((occupied, index) => {
        if (!occupied) return;
        this.placeRunner(this.makeRunner(), ...BASES[index + 1]);
      });
    }
    cancel() {
      cancelAnimationFrame(this.frame);
      this.field.classList.remove('live-play', 'scoring-play', 'home-run-play', 'called-strike-play');
      ['ball-effects', 'contact-burst', 'run-celebration'].forEach(id => this.field.querySelector(`#${id}`).setAttribute('opacity', '0'));
      this.field.querySelector('#batter').style.opacity = '';
      if (this.resolve) { this.resolve(false); this.resolve = null; }
    }
    playMiss({ reduced = false } = {}) {
      this.cancel();
      this.field.classList.add('called-strike-play');
      const effects = this.field.querySelector('#ball-effects');
      const ball = this.field.querySelector('#play-ball');
      const shadow = this.field.querySelector('#ball-shadow');
      this.field.querySelector('#ball-trail').setAttribute('d', '');
      const duration = reduced ? 400 : 1000;
      const started = performance.now();
      return new Promise(resolve => {
        this.resolve = resolve;
        const tick = now => {
          const progress = clamp((now - started) / duration / .65);
          const y = reduced ? 530 : lerp(360, 530, progress);
          ball.setAttribute('transform', `translate(500 ${y}) scale(${lerp(.6, 1.25, progress)})`);
          shadow.setAttribute('transform', `translate(500 ${y + 22})`);
          effects.setAttribute('opacity', progress < 1 ? '1' : '0');
          if (now - started < duration) this.frame = requestAnimationFrame(tick);
          else { this.resolve = null; this.cancel(); resolve(true); }
        };
        this.frame = requestAnimationFrame(tick);
      });
    }
    playHit({ bases, type, side, run, reduced = false }) {
      this.cancel();
      this.layer.replaceChildren();
      const homeRun = type === 'homeRun';
      const runners = runnerMoves(bases, homeRun).map(move => ({ ...move, runner: this.makeRunner() }));
      runners.forEach(({ from, runner }) => this.placeRunner(runner, ...BASES[from]));
      const ball = this.field.querySelector('#play-ball');
      const ballEffects = this.field.querySelector('#ball-effects');
      const shadow = this.field.querySelector('#ball-shadow');
      const trail = this.field.querySelector('#ball-trail');
      const burst = this.field.querySelector('#contact-burst');
      const celebration = this.field.querySelector('#run-celebration');
      const batter = this.field.querySelector('#batter');
      const duration = reduced ? (homeRun ? 800 : 600) : homeRun ? 4300 : 2900;
      const started = performance.now();
      this.field.dataset.hitType = type;
      this.field.classList.add('live-play');
      if (homeRun) this.field.classList.add('home-run-play');
      if (run) this.field.classList.add('scoring-play');
      celebration.querySelector('text').textContent = `+${run} 分！`;
      return new Promise(resolve => {
        this.resolve = resolve;
        const tick = now => {
          const elapsed = reduced ? (now - started) / duration * (homeRun ? 4300 : 2900) : now - started;
          const pitch = clamp(elapsed / 330);
          const flight = clamp((elapsed - 330) / 1500);
          const position = reduced ? ballPosition(1, type, side) : elapsed < 330 ? { x: lerp(500, 430, pitch), y: lerp(360, 478, pitch), groundY: lerp(386, 530, pitch), scale: lerp(.5, 1.25, pitch) } : ballPosition(flight, type, side);
          ballEffects.setAttribute('opacity', elapsed < 1900 ? '1' : String(1 - clamp((elapsed - 1900) / 250)));
          ball.setAttribute('transform', `translate(${position.x} ${position.y}) scale(${position.scale}) rotate(${elapsed * .8})`);
          shadow.setAttribute('transform', `translate(${position.x} ${position.groundY + 12}) scale(${position.scale})`);
          const points = reduced || elapsed < 330 ? [] : Array.from({ length: 8 }, (_, i) => ballPosition(clamp(flight - (7 - i) * .018), type, side));
          trail.setAttribute('d', points.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join(' '));
          const impact = clamp((elapsed - 330) / 220);
          burst.setAttribute('opacity', !reduced && elapsed >= 330 && elapsed < 550 ? String(1 - impact) : '0');
          burst.setAttribute('transform', `translate(430 478) scale(${.5 + impact * 1.3})`);
          const running = reduced ? 1 : clamp((elapsed - 750) / (homeRun ? 2900 : 1650));
          batter.style.opacity = elapsed > 750 ? '0' : '1';
          runners.forEach(({ from, to, scores, runner }) => {
            const position = runnerPosition(from, to, running, homeRun);
            this.placeRunner(runner, position.x, position.y, !reduced && running > 0 && !position.arrived ? Math.sin(elapsed / 52 + from) : 0);
            runner.group.setAttribute('opacity', from === 0 && elapsed < 750 || scores && position.arrived ? '0' : '1');
          });
          const celebrationTime = homeRun ? 3650 : 2350;
          celebration.setAttribute('opacity', run && elapsed > celebrationTime ? String(Math.min(1, (elapsed - celebrationTime) / 150)) : '0');
          if (now - started < duration) this.frame = requestAnimationFrame(tick);
          else {
            this.resolve = null;
            this.cancel();
            resolve(true);
          }
        };
        this.frame = requestAnimationFrame(tick);
      });
    }
  }
  const api = { BASES, runnerMoves, runnerPosition, ballPosition, StadiumAudio, BallparkEffects };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BaseballEffects = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
