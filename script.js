/* ===== Acchiappa Marmellino — logica di gioco ===== */
(function () {
  "use strict";

  // --- Costanti di gioco (regole fisse) ---
  var MAX_ATTEMPTS = 7;      // tentativi (tap) totali per partita: si gioca sempre fino al 7° colpo
  var WIN_TARGET = 3;        // talpe da prendere per vincere: ne bastano ALMENO 3
  var NUM_HOLES = 9;         // griglia 3x3
  var HIT_FX_MS = 750;       // durata stelline: lunga apposta per farla vedere bene
  var MISS_FX_MS = 400;      // durata puff di fumo
  var END_DELAY_MS = 350;    // pausa prima di mostrare la schermata finale
  var PC_REWARD = 3;         // Punti Cattura in palio

  // --- Livelli di difficoltà (estratti a caso a ogni partita) ---
  // moleMin/Max = quanto resta fuori la talpa; gapMin/Max = pausa tra una e l'altra.
  // Più il livello è alto, meno tempo hai per colpire e più veloce è il ritmo.
  var LEVELS = {
    1: { name: "FACILE",    color: "#37b24d", moleMin: 1000, moleMax: 1300, gapMin: 550, gapMax: 950, desc: "Le talpe restano fuori a lungo" },
    2: { name: "MEDIO",     color: "#f59f00", moleMin: 700,  moleMax: 900,  gapMin: 380, gapMax: 700, desc: "Talpe con ritmo sostenuto" },
    3: { name: "DIFFICILE", color: "#e03131", moleMin: 480,  moleMax: 640,  gapMin: 260, gapMax: 500, desc: "Talpe velocissime, riflessi al massimo!" }
  };
  var currentLevel = 2;                 // livello estratto per la partita in corso
  var curMoleMin, curMoleMax, curGapMin, curGapMax; // impostati in startGame dal livello

  // --- Elementi DOM ---
  var screenStart = document.getElementById("screen-start");
  var screenLevel = document.getElementById("screen-level");
  var screenGame = document.getElementById("screen-game");
  var screenEnd = document.getElementById("screen-end");
  var grid = document.getElementById("grid");
  var playfield = document.getElementById("playfield");
  var dotsContainer = document.getElementById("dots");
  var hudHits = document.getElementById("hud-hits");
  var endTitle = document.getElementById("end-title");
  var endPc = document.getElementById("end-pc");
  var levelBadge = document.getElementById("level-badge");
  var levelNum = document.getElementById("level-num");
  var levelName = document.getElementById("level-name");
  var levelDesc = document.getElementById("level-desc");
  var levelPips = document.querySelectorAll("#level-pips .pip");
  var btnGo = document.getElementById("btn-go");

  // --- Stato di partita ---
  var attempts, hits, gameActive, attemptIndex;
  var currentMole = null;   // elemento .mole attualmente fuori
  var hideTimer = null, spawnTimer = null, endTimer = null, hitRetractTimer = null, spinTimer = null;
  var lastHoleIndex = -1;
  var dotEls = [];

  // ============ COSTRUZIONE PALLINI TENTATIVI ============
  function buildDots() {
    dotsContainer.innerHTML = "";
    dotEls = [];
    for (var d = 0; d < MAX_ATTEMPTS; d++) {
      var dot = document.createElement("div");
      dot.className = "dot";
      dotsContainer.appendChild(dot);
      dotEls.push(dot);
    }
  }
  buildDots();

  function markDot(hit) {
    var dot = dotEls[attemptIndex];
    if (dot) dot.classList.add(hit ? "hit" : "miss");
    attemptIndex++;
  }

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
    [screenStart, screenLevel, screenGame, screenEnd].forEach(function (s) {
      s.classList.toggle("active", s === screen);
    });
  }

  function updateHud() {
    // mostra i progressi verso l'obiettivo (max 3): i pallini verdi in alto
    // registrano comunque ogni presa reale, anche oltre le 3.
    hudHits.textContent = Math.min(hits, WIN_TARGET) + "/" + WIN_TARGET;
  }

  function clearTimers() {
    clearTimeout(hideTimer);
    clearTimeout(spawnTimer);
    clearTimeout(endTimer);
    clearTimeout(hitRetractTimer);
    clearTimeout(spinTimer);
    hideTimer = spawnTimer = endTimer = hitRetractTimer = spinTimer = null;
  }

  // Overlay effetto (stelline o puff) alle coordinate del playfield
  function showFx(src, x, y, duration) {
    var fx = document.createElement("img");
    fx.className = "fx";
    fx.src = src;
    fx.alt = "";
    fx.style.left = x + "px";
    fx.style.top = y + "px";
    fx.style.animationDuration = duration + "ms";
    playfield.appendChild(fx);
    setTimeout(function () { fx.remove(); }, duration);
  }

  // ============ CICLO DELLE TALPE ============
  function scheduleNextMole(delay) {
    spawnTimer = setTimeout(spawnMole, delay);
  }

  function spawnMole() {
    if (!gameActive) return;

    // buca casuale, mai la stessa due volte di fila
    var idx;
    do {
      idx = Math.floor(Math.random() * NUM_HOLES);
    } while (idx === lastHoleIndex && NUM_HOLES > 1);
    lastHoleIndex = idx;

    var mole = holes[idx].querySelector(".mole");
    var win = holes[idx].querySelector(".mole-window");
    currentMole = mole;
    win.classList.add("hittable");
    mole.classList.add("up");

    hideTimer = setTimeout(function () {
      retractMole(mole, win);
    }, rand(curMoleMin, curMoleMax));
  }

  // Fa rientrare la talpa e, se la partita è ancora attiva, ne programma un'altra:
  // le talpe continuano a uscire finché non si esauriscono i 7 tentativi.
  function retractMole(mole, win) {
    clearTimeout(hideTimer);
    hideTimer = null;
    mole.classList.remove("up");
    win.classList.remove("hittable");
    if (currentMole === mole) currentMole = null;
    if (gameActive) scheduleNextMole(rand(curGapMin, curGapMax));
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

    markDot(isHit);
    var lastTap = attempts <= 0; // era l'ultimo dei 7 colpi

    if (isHit) {
      hits++;
      soundHit();
      // blocca nuovi colpi su questa talpa e ferma il rientro automatico,
      // ma la lascio visibile insieme alle stelline così l'animazione si vede bene
      hitWindow.classList.remove("hittable");
      clearTimeout(hideTimer);
      hideTimer = null;

      var wr = hitWindow.getBoundingClientRect();
      showFx("assets/Asset-4.png",
        wr.left - rect.left + wr.width / 2,
        wr.top - rect.top + wr.height / 2,
        HIT_FX_MS);

      var moleHit = currentMole;
      updateHud();

      hitRetractTimer = setTimeout(function () {
        if (!gameActive) return;
        moleHit.classList.remove("up");
        if (currentMole === moleHit) currentMole = null;
        // La partita finisce SOLO al 7° colpo, mai prima: dopo un colpo non
        // finale esce un'altra talpa; al 7° si tirano le somme (vince con >= 3).
        if (lastTap) {
          endGame(hits >= WIN_TARGET);
        } else {
          scheduleNextMole(rand(curGapMin, curGapMax));
        }
      }, HIT_FX_MS);
    } else {
      soundMiss();
      showFx("assets/Asset-5.png", x, y, MISS_FX_MS);
      updateHud();
      // colpo a vuoto: il ciclo delle talpe prosegue da solo (se una era su,
      // rientrerà da sé). Se era l'ultimo tentativo, si chiude la partita.
      if (lastTap) endGame(hits >= WIN_TARGET);
    }
  });

  // ============ ESTRAZIONE LIVELLO ============
  // Mostra sulla schermata il livello passato (aggiorna numero, nome, colore, pip).
  function renderLevel(lv) {
    var cfg = LEVELS[lv];
    screenLevel.style.setProperty("--lv", cfg.color);
    levelNum.textContent = lv;
    levelName.textContent = cfg.name;
    levelDesc.textContent = cfg.desc;
    for (var p = 0; p < levelPips.length; p++) {
      levelPips[p].classList.toggle("on", p < lv);
    }
  }

  // Estrae a caso il livello (1-3) e lo rivela con una breve animazione a "roulette".
  function revealLevel() {
    clearTimers();
    currentLevel = 1 + Math.floor(Math.random() * 3);
    btnGo.classList.add("hidden");
    showScreen(screenLevel);

    var flips = 11;           // quante volte "gira" prima di fermarsi
    var count = 0;
    var delay = 80;
    function flip() {
      count++;
      var last = count >= flips;
      // durante la giostra mostra livelli a caso, all'ultimo blocca su quello estratto
      renderLevel(last ? currentLevel : (1 + Math.floor(Math.random() * 3)));
      levelBadge.classList.remove("spin", "settle");
      void levelBadge.offsetWidth; // forza il restart dell'animazione
      levelBadge.classList.add(last ? "settle" : "spin");
      if (last) {
        btnGo.classList.remove("hidden");
        soundHit(); // piccolo squillo quando si ferma
      } else {
        delay += 22;           // rallenta progressivamente
        spinTimer = setTimeout(flip, delay);
      }
    }
    flip();
  }

  // ============ FLUSSO DI GIOCO ============
  function startGame() {
    clearTimers();
    // applica le tempistiche del livello estratto
    var cfg = LEVELS[currentLevel];
    curMoleMin = cfg.moleMin;
    curMoleMax = cfg.moleMax;
    curGapMin = cfg.gapMin;
    curGapMax = cfg.gapMax;

    attempts = MAX_ATTEMPTS;
    hits = 0;
    attemptIndex = 0;
    lastHoleIndex = -1;
    currentMole = null;
    gameActive = true;
    buildDots();
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
    }, END_DELAY_MS);
  }

  document.getElementById("btn-play").addEventListener("click", function () {
    getAudio(); // sblocca l'audio con il gesto dell'utente
    revealLevel(); // prima si estrae e si rivela la difficoltà
  });

  btnGo.addEventListener("click", function () {
    startGame(); // parte la partita con il livello estratto
  });

  document.getElementById("btn-replay").addEventListener("click", function () {
    clearTimers();
    gameActive = false;
    showScreen(screenStart); // reset completo: si riparte dal Giostraio
  });
})();
