/* ===== Acchiappa Marmellino — logica di gioco ===== */
(function () {
  "use strict";

  // --- Costanti di gioco (regole fisse) ---
  var MAX_ATTEMPTS = 5;      // tentativi totali per partita
  var TOTAL_MOLES = 3;       // talpe che compaiono in tutta la partita
  var NUM_HOLES = 9;         // griglia 3x3
  var MOLE_MIN_MS = 800;     // permanenza minima della talpa
  var MOLE_MAX_MS = 1000;    // permanenza massima della talpa
  var GAP_MIN_MS = 500;      // pausa minima tra una talpa e la successiva
  var GAP_MAX_MS = 1100;     // pausa massima
  var FX_MS = 350;           // durata overlay stelline / puff
  var PC_REWARD = 3;         // Punti Cattura in palio

  // --- Elementi DOM ---
  var screenStart = document.getElementById("screen-start");
  var screenGame = document.getElementById("screen-game");
  var screenEnd = document.getElementById("screen-end");
  var grid = document.getElementById("grid");
  var playfield = document.getElementById("playfield");
  var hudAttempts = document.getElementById("hud-attempts");
  var hudHits = document.getElementById("hud-hits");
  var endTitle = document.getElementById("end-title");
  var endPc = document.getElementById("end-pc");

  // --- Stato di partita ---
  var attempts, hits, molesSpawned, gameActive;
  var currentMole = null;   // elemento .mole attualmente fuori
  var hideTimer = null, spawnTimer = null, endTimer = null;
  var lastHoleIndex = -1;

  // ============ COSTRUZIONE GRIGLIA ============
  var holes = [];
  for (var i = 0; i < NUM_HOLES; i++) {
    var hole = document.createElement("div");
    hole.className = "hole";
    hole.innerHTML =
      '<img class="hole-img" src="assets/Asset-3.png" alt="">' +
      '<div class="mole-window">' +
      '  <img class="mole" src="assets/Asset-1.png" alt="Marmellino">' +
      "</div>";
    grid.appendChild(hole);
    holes.push(hole);
  }

  // ============ AUDIO (Web Audio API, nessun file) ============
  var audioCtx = null;
  function getAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  // Beep/pop allegro: due note ascendenti brillanti
  function soundHit() {
    var ctx = getAudio();
    if (!ctx) return;
    var t = ctx.currentTime;
    [[660, 0], [990, 0.09]].forEach(function (note) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(note[0], t + note[1]);
      osc.frequency.exponentialRampToValueAtTime(note[0] * 1.5, t + note[1] + 0.12);
      gain.gain.setValueAtTime(0.0001, t + note[1]);
      gain.gain.exponentialRampToValueAtTime(0.35, t + note[1] + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + note[1] + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + note[1]);
      osc.stop(t + note[1] + 0.2);
    });
  }

  // Suono basso e comico: glissando discendente tipo "wah wah"
  function soundMiss() {
    var ctx = getAudio();
    if (!ctx) return;
    var t = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.35);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.42);
  }

  // ============ UTILITÀ ============
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function showScreen(screen) {
    [screenStart, screenGame, screenEnd].forEach(function (s) {
      s.classList.toggle("active", s === screen);
    });
  }

  function updateHud() {
    hudAttempts.textContent = attempts;
    hudHits.textContent = hits + "/" + TOTAL_MOLES;
  }

  function clearTimers() {
    clearTimeout(hideTimer);
    clearTimeout(spawnTimer);
    clearTimeout(endTimer);
    hideTimer = spawnTimer = endTimer = null;
  }

  // Overlay effetto (stelline o puff) alle coordinate del playfield
  function showFx(src, x, y) {
    var fx = document.createElement("img");
    fx.className = "fx";
    fx.src = src;
    fx.alt = "";
    fx.style.left = x + "px";
    fx.style.top = y + "px";
    playfield.appendChild(fx);
    setTimeout(function () { fx.remove(); }, FX_MS);
  }

  // ============ CICLO DELLE TALPE ============
  function scheduleNextMole(delay) {
    spawnTimer = setTimeout(spawnMole, delay);
  }

  function spawnMole() {
    if (!gameActive || molesSpawned >= TOTAL_MOLES) return;

    // buca casuale, mai la stessa due volte di fila
    var idx;
    do {
      idx = Math.floor(Math.random() * NUM_HOLES);
    } while (idx === lastHoleIndex && NUM_HOLES > 1);
    lastHoleIndex = idx;

    molesSpawned++;
    var mole = holes[idx].querySelector(".mole");
    var win = holes[idx].querySelector(".mole-window");
    currentMole = mole;
    win.classList.add("hittable");
    mole.classList.add("up");

    hideTimer = setTimeout(function () {
      retractMole(mole, win, /*wasHit*/ false);
    }, rand(MOLE_MIN_MS, MOLE_MAX_MS));
  }

  function retractMole(mole, win, wasHit) {
    clearTimeout(hideTimer);
    hideTimer = null;
    mole.classList.remove("up");
    win.classList.remove("hittable");
    if (currentMole === mole) currentMole = null;
    if (!gameActive) return;

    if (wasHit) return; // dopo un colpo decide il gestore del tap

    if (molesSpawned >= TOTAL_MOLES) {
      // L'ultima talpa è rientrata senza essere colpita:
      // non può più uscirne un'altra, vittoria impossibile.
      endGame(false);
    } else {
      scheduleNextMole(rand(GAP_MIN_MS, GAP_MAX_MS));
    }
  }

  // ============ GESTIONE TAP ============
  playfield.addEventListener("pointerdown", function (e) {
    if (!gameActive || attempts <= 0) return;
    e.preventDefault();

    attempts--;

    var rect = playfield.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;

    var hitWindow = e.target.closest ? e.target.closest(".mole-window.hittable") : null;
    var isHit = hitWindow && currentMole && currentMole.classList.contains("up");

    if (isHit) {
      hits++;
      soundHit();
      var wr = hitWindow.getBoundingClientRect();
      showFx("assets/Asset-4.png",
        wr.left - rect.left + wr.width / 2,
        wr.top - rect.top + wr.height / 2);
      retractMole(currentMole, hitWindow, /*wasHit*/ true);
    } else {
      soundMiss();
      showFx("assets/Asset-5.png", x, y);
    }
    updateHud();

    // --- Verifica fine partita ---
    if (hits >= TOTAL_MOLES) {
      // Tutte e 3 le talpe colpite entro i 5 tentativi: vittoria immediata
      endGame(true);
    } else if (attempts <= 0) {
      // Tentativi finiti senza 3 talpe: sconfitta immediata
      endGame(false);
    } else if (isHit && molesSpawned >= TOTAL_MOLES) {
      // Colpita l'ultima talpa disponibile ma il conto non torna a 3
      endGame(false);
    } else if (isHit) {
      scheduleNextMole(rand(GAP_MIN_MS, GAP_MAX_MS));
    }
  });

  // ============ FLUSSO DI GIOCO ============
  function startGame() {
    clearTimers();
    attempts = MAX_ATTEMPTS;
    hits = 0;
    molesSpawned = 0;
    lastHoleIndex = -1;
    currentMole = null;
    gameActive = true;
    holes.forEach(function (h) {
      h.querySelector(".mole").classList.remove("up");
      h.querySelector(".mole-window").classList.remove("hittable");
    });
    updateHud();
    showScreen(screenGame);
    scheduleNextMole(900); // piccolo respiro prima della prima talpa
  }

  function endGame(won) {
    if (!gameActive) return;
    gameActive = false;
    clearTimers();
    if (currentMole) {
      currentMole.classList.remove("up");
      currentMole = null;
    }
    holes.forEach(function (h) {
      h.querySelector(".mole-window").classList.remove("hittable");
    });

    // Breve pausa per lasciar vedere l'effetto dell'ultimo colpo
    endTimer = setTimeout(function () {
      screenEnd.classList.toggle("win", won);
      screenEnd.classList.toggle("lose", !won);
      endTitle.textContent = won ? "HAI VINTO!" : "HAI PERSO!";
      endPc.textContent = (won ? "+" : "-") + PC_REWARD;
      showScreen(screenEnd);
    }, FX_MS + 150);
  }

  document.getElementById("btn-play").addEventListener("click", function () {
    getAudio(); // sblocca l'audio con il gesto dell'utente
    startGame();
  });

  document.getElementById("btn-replay").addEventListener("click", function () {
    clearTimers();
    gameActive = false;
    showScreen(screenStart); // reset completo: si riparte dal Giostraio
  });
})();
