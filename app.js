(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const els = {
    gameLabel: $('gameLabel'), phaseKicker: $('phaseKicker'), timeDisplay: $('timeDisplay'),
    statusText: $('statusText'), progressBar: $('progressBar'),
    startPauseButton: $('startPauseButton'), startPauseLabel: $('startPauseLabel'),
    resetButton: $('resetButton'), previousButton: $('previousButton'), nextButton: $('nextButton'),
    fullscreenButton: $('fullscreenButton'), fullscreenHint: $('fullscreenHint'), soundButton: $('soundButton'),
    settingsButton: $('settingsButton'), settingsPanel: $('settingsPanel'), settingsBackdrop: $('settingsBackdrop'),
    closeSettingsButton: $('closeSettingsButton'), settingsForm: $('settingsForm'), settingsError: $('settingsError'),
    totalGamesInput: $('totalGamesInput'), gameMinutesInput: $('gameMinutesInput'), gameSecondsInput: $('gameSecondsInput'),
    breakMinutesInput: $('breakMinutesInput'), breakSecondsInput: $('breakSecondsInput'), warningInput: $('warningInput'),
    installButton: $('installButton'), installHelp: $('installHelp'), toast: $('toast')
  };

  const DEFAULTS = { totalGames: 20, gameSeconds: 210, breakSeconds: 60, warning: true, sound: true };
  const STORAGE_KEY = 'badminton-court-timer-settings-v1';
  let settings = loadSettings();
  let state = {
    currentGame: 1,
    phase: 'ready',
    running: false,
    remainingMs: settings.gameSeconds * 1000,
    phaseDurationMs: settings.gameSeconds * 1000,
    endAt: 0,
    warned: new Set()
  };
  let tickHandle = null;
  let audioContext = null;
  let wakeLock = null;
  let installPrompt = null;
  let toastHandle = null;

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        totalGames: clampInt(saved.totalGames, 1, 999, DEFAULTS.totalGames),
        gameSeconds: clampInt(saved.gameSeconds, 1, 5999, DEFAULTS.gameSeconds),
        breakSeconds: clampInt(saved.breakSeconds, 0, 5999, DEFAULTS.breakSeconds),
        warning: typeof saved.warning === 'boolean' ? saved.warning : DEFAULTS.warning,
        sound: typeof saved.sound === 'boolean' ? saved.sound : DEFAULTS.sound
      };
    } catch (_) { return { ...DEFAULTS }; }
  }

  function clampInt(value, min, max, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function saveSettings() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function soundIcon(enabled) {
    const waves = '<path d="M4 9h4l5-4v14l-5-4H4V9Z"/><path d="M16.2 8.2a5.4 5.4 0 0 1 0 7.6l-1.4-1.4a3.4 3.4 0 0 0 0-4.8l1.4-1.4Zm2.7-2.7a9.2 9.2 0 0 1 0 13l-1.4-1.4a7.2 7.2 0 0 0 0-10.2l1.4-1.4Z"/>';
    const muted = '<path d="M4 9h4l5-4v14l-5-4H4V9Z"/><path d="m16 9 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
    return `<svg aria-hidden="true" viewBox="0 0 24 24">${enabled ? waves : muted}</svg>`;
  }

  function pad(number) { return String(number).padStart(2, '0'); }
  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  function ariaTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds} second${seconds === 1 ? '' : 's'} remaining`;
  }

  function render() {
    document.body.dataset.phase = state.phase;
    document.body.classList.toggle('paused', !state.running && (state.phase === 'game' || state.phase === 'changeover'));

    const isComplete = state.phase === 'complete';
    const isReady = state.phase === 'ready';
    const isPaused = !state.running && !isReady && !isComplete;
    const phaseName = state.phase === 'changeover' ? 'CHANGEOVER' : state.phase === 'game' ? 'IN PLAY' : isComplete ? 'SESSION COMPLETE' : 'READY';

    els.phaseKicker.textContent = isPaused ? 'PAUSED' : phaseName;
    els.gameLabel.textContent = isComplete ? 'ALL DONE' : `GAME ${state.currentGame}`;
    els.timeDisplay.textContent = isComplete ? '00:00' : formatTime(state.remainingMs);
    els.timeDisplay.setAttribute('aria-label', isComplete ? 'Session complete' : ariaTime(state.remainingMs));

    if (isComplete) els.statusText.textContent = `${settings.totalGames} game${settings.totalGames === 1 ? '' : 's'} complete`;
    else if (isReady) els.statusText.textContent = 'Press start when the court is ready';
    else if (isPaused) els.statusText.textContent = 'Paused — press resume to continue';
    else if (state.phase === 'changeover') els.statusText.textContent = `Next: Game ${state.currentGame + 1}`;
    else els.statusText.textContent = 'Game in progress';

    const ratio = state.phaseDurationMs > 0 ? Math.max(0, Math.min(1, state.remainingMs / state.phaseDurationMs)) : 0;
    els.progressBar.style.transform = `scaleX(${ratio})`;

    els.startPauseLabel.textContent = isComplete ? 'FINISHED' : state.running ? 'PAUSE' : isPaused ? 'RESUME' : 'START';
    els.startPauseButton.querySelector('.control-icon').textContent = state.running ? 'Ⅱ' : '▶';
    els.startPauseButton.disabled = isComplete;
    els.previousButton.disabled = state.currentGame <= 1 || state.running;
    els.nextButton.disabled = state.currentGame >= settings.totalGames || state.running;
    els.settingsButton.disabled = state.running;
    els.soundButton.innerHTML = soundIcon(settings.sound);
    els.soundButton.setAttribute('aria-label', settings.sound ? 'Sound on' : 'Sound off');
    els.soundButton.title = settings.sound ? 'Sound on' : 'Sound off';
  }

  async function ensureAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();
  }

  function tone(frequency, startDelay, duration, volume = .25) {
    if (!settings.sound || !audioContext) return;
    const start = audioContext.currentTime + startDelay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .03);
  }

  async function warningBeep() {
    if (!settings.sound) return;
    try { await ensureAudio(); tone(920, 0, .1, .16); } catch (_) {}
  }

  async function transitionAlarm(final = false) {
    if (!settings.sound) return;
    try {
      await ensureAudio();
      const pattern = final ? [880, 1040, 1240, 1480] : [920, 920, 1220];
      pattern.forEach((frequency, index) => tone(frequency, index * .24, .17, .32));
      if ('vibrate' in navigator) navigator.vibrate(final ? [160, 80, 160, 80, 300] : [180, 90, 240]);
    } catch (_) {}
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator) || wakeLock || !state.running) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) {}
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;
    try { await wakeLock.release(); } catch (_) {}
    wakeLock = null;
  }

  function startPhase(phase, durationSeconds) {
    state.phase = phase;
    state.running = true;
    state.phaseDurationMs = durationSeconds * 1000;
    state.remainingMs = state.phaseDurationMs;
    state.endAt = Date.now() + state.remainingMs;
    state.warned.clear();
    startTicker();
    requestWakeLock();
    render();
  }

  async function startOrPause() {
    if (state.phase === 'complete') return;
    await ensureAudio().catch(() => {});
    if (state.running) pauseTimer();
    else if (state.phase === 'ready') startPhase('game', settings.gameSeconds);
    else resumeTimer();
  }

  function pauseTimer() {
    if (!state.running) return;
    state.remainingMs = Math.max(0, state.endAt - Date.now());
    state.running = false;
    stopTicker();
    releaseWakeLock();
    render();
  }

  function resumeTimer() {
    if (state.running || state.phase === 'ready' || state.phase === 'complete') return;
    state.running = true;
    state.endAt = Date.now() + state.remainingMs;
    startTicker();
    requestWakeLock();
    render();
  }

  function startTicker() {
    stopTicker();
    tickHandle = window.setInterval(tick, 100);
    tick();
  }

  function stopTicker() {
    if (tickHandle !== null) window.clearInterval(tickHandle);
    tickHandle = null;
  }

  function tick() {
    if (!state.running) return;
    state.remainingMs = Math.max(0, state.endAt - Date.now());
    const secondsLeft = Math.ceil(state.remainingMs / 1000);
    if (settings.warning && secondsLeft > 0 && secondsLeft <= 10 && !state.warned.has(secondsLeft)) {
      state.warned.add(secondsLeft);
      warningBeep();
    }
    if (state.remainingMs <= 0) {
      completePhase();
      return;
    }
    render();
  }

  function completePhase() {
    if (!state.running) return;
    state.running = false;
    stopTicker();
    state.remainingMs = 0;

    if (state.phase === 'game') {
      transitionAlarm(false);
      if (state.currentGame >= settings.totalGames) {
        state.phase = 'complete';
        releaseWakeLock();
        window.setTimeout(() => transitionAlarm(true), 850);
        render();
      } else {
        startPhase('changeover', settings.breakSeconds);
      }
    } else if (state.phase === 'changeover') {
      transitionAlarm(false);
      state.currentGame += 1;
      startPhase('game', settings.gameSeconds);
    }
  }

  function resetSession(showMessage = false) {
    stopTicker();
    releaseWakeLock();
    state = {
      currentGame: 1, phase: 'ready', running: false,
      remainingMs: settings.gameSeconds * 1000,
      phaseDurationMs: settings.gameSeconds * 1000,
      endAt: 0, warned: new Set()
    };
    render();
    if (showMessage) showToast('Session reset');
  }

  function goToGame(delta) {
    if (state.running) return;
    const target = Math.max(1, Math.min(settings.totalGames, state.currentGame + delta));
    state.currentGame = target;
    state.phase = 'ready';
    state.remainingMs = settings.gameSeconds * 1000;
    state.phaseDurationMs = settings.gameSeconds * 1000;
    state.warned.clear();
    render();
  }

  function populateSettings() {
    els.totalGamesInput.value = settings.totalGames;
    els.gameMinutesInput.value = Math.floor(settings.gameSeconds / 60);
    els.gameSecondsInput.value = settings.gameSeconds % 60;
    els.breakMinutesInput.value = Math.floor(settings.breakSeconds / 60);
    els.breakSecondsInput.value = settings.breakSeconds % 60;
    els.warningInput.checked = settings.warning;
    els.settingsError.textContent = '';
  }

  function openSettings() {
    if (state.running) return;
    populateSettings();
    els.settingsBackdrop.hidden = false;
    els.settingsPanel.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => els.settingsPanel.classList.add('open'));
    window.setTimeout(() => els.totalGamesInput.focus(), 300);
  }

  function closeSettings() {
    els.settingsPanel.classList.remove('open');
    els.settingsPanel.setAttribute('aria-hidden', 'true');
    window.setTimeout(() => { els.settingsBackdrop.hidden = true; }, 280);
    els.settingsButton.focus();
  }

  function readNumber(input) { return Number.parseInt(input.value, 10); }

  function applySettings(event) {
    event.preventDefault();
    const totalGames = readNumber(els.totalGamesInput);
    const gameMinutes = readNumber(els.gameMinutesInput);
    const gameSecondsPart = readNumber(els.gameSecondsInput);
    const breakMinutes = readNumber(els.breakMinutesInput);
    const breakSecondsPart = readNumber(els.breakSecondsInput);

    if (!Number.isInteger(totalGames) || totalGames < 1 || totalGames > 999) return formError('Total games must be between 1 and 999.');
    if (![gameMinutes, breakMinutes].every(n => Number.isInteger(n) && n >= 0 && n <= 99)) return formError('Minutes must be between 0 and 99.');
    if (![gameSecondsPart, breakSecondsPart].every(n => Number.isInteger(n) && n >= 0 && n <= 59)) return formError('Seconds must be between 0 and 59.');
    const gameSeconds = gameMinutes * 60 + gameSecondsPart;
    const breakSeconds = breakMinutes * 60 + breakSecondsPart;
    if (gameSeconds < 1) return formError('Game duration must be at least 1 second.');

    settings = { ...settings, totalGames, gameSeconds, breakSeconds, warning: els.warningInput.checked };
    saveSettings();
    resetSession(false);
    closeSettings();
    showToast('Settings applied');
  }

  function formError(message) {
    els.settingsError.textContent = message;
    els.settingsPanel.scrollTo({ top: els.settingsPanel.scrollHeight, behavior: 'smooth' });
  }

  function toggleSound() {
    settings.sound = !settings.sound;
    saveSettings();
    if (settings.sound) {
      ensureAudio().then(() => tone(880, 0, .1, .15)).catch(() => {});
      showToast('Sound on');
    } else showToast('Sound off');
    render();
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      else showToast('Use “Add to Home Screen” for an app-like full screen');
    } catch (_) { showToast('Full screen is not available in this browser'); }
  }

  function onFullscreenChange() {
    const active = Boolean(document.fullscreenElement);
    els.fullscreenButton.textContent = active ? 'EXIT FULL SCREEN' : 'FULL SCREEN';
    els.fullscreenHint.hidden = !active;
  }

  function showToast(message) {
    window.clearTimeout(toastHandle);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastHandle = window.setTimeout(() => els.toast.classList.remove('show'), 2300);
  }

  function onKeyDown(event) {
    if (els.settingsPanel.classList.contains('open')) {
      if (event.key === 'Escape') closeSettings();
      return;
    }
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); startOrPause(); }
    else if (event.key.toLowerCase() === 'r') resetSession(true);
    else if (event.key.toLowerCase() === 'f') toggleFullscreen();
    else if (event.key === 'ArrowLeft') goToGame(-1);
    else if (event.key === 'ArrowRight') goToGame(1);
  }

  els.startPauseButton.addEventListener('click', startOrPause);
  els.resetButton.addEventListener('click', () => resetSession(true));
  els.previousButton.addEventListener('click', () => goToGame(-1));
  els.nextButton.addEventListener('click', () => goToGame(1));
  els.fullscreenButton.addEventListener('click', toggleFullscreen);
  els.soundButton.addEventListener('click', toggleSound);
  els.settingsButton.addEventListener('click', openSettings);
  els.closeSettingsButton.addEventListener('click', closeSettings);
  els.settingsBackdrop.addEventListener('click', closeSettings);
  els.settingsForm.addEventListener('submit', applySettings);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (state.running) { tick(); requestWakeLock(); }
    }
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    els.installButton.hidden = false;
    els.installHelp.textContent = 'Install for quick access and offline use.';
  });

  els.installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    els.installButton.hidden = true;
  });

  window.addEventListener('appinstalled', () => showToast('Court Timer installed'));

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  // Small read-only/test surface for automated verification.
  window.__courtTimer = {
    snapshot: () => ({
      currentGame: state.currentGame, phase: state.phase, running: state.running,
      remainingMs: state.remainingMs, settings: { ...settings }
    }),
    forcePhaseEnd: () => { if (state.running) { state.endAt = Date.now(); tick(); } }
  };

  populateSettings();
  render();
})();
