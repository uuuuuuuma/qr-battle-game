// アプリ全体の状態管理・画面遷移・カメラ制御

const state = {
  screen: 'home',
  qrText: null,
  photoDataUrl: null,
  photoFacingMode: 'user',
  playerCharacter: null,
  cpuCharacter: null,
  battlePlayer: null,
  battleCpu: null,
  battle: null,
  battleResult: null,
};

let currentStream = null;
let qrAnimationId = null;

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
  if (qrAnimationId) {
    cancelAnimationFrame(qrAnimationId);
    qrAnimationId = null;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showCameraError(elId, err) {
  const el = document.getElementById(elId);
  if (!el) return;
  const detail = err && err.message ? err.message : String(err);
  el.innerHTML = `<div class="error-box">カメラを起動できませんでした。Safariの「設定」→「Safari」→「カメラ」でこのサイトへのアクセスを許可してください。<br>(${escapeHtml(detail)})</div>`;
}

function mediaDevicesAvailable() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// ---------- render dispatcher ----------

function render() {
  stopCamera();
  const app = document.getElementById('app');
  switch (state.screen) {
    case 'home':
      app.innerHTML = renderHome();
      bindHome();
      break;
    case 'scanQr':
      app.innerHTML = renderScanQr();
      initQrScanner();
      break;
    case 'capturePhoto':
      app.innerHTML = renderCapturePhoto();
      initPhotoCapture();
      break;
    case 'preview':
      app.innerHTML = renderPreview();
      bindPreview();
      break;
    case 'battle':
      app.innerHTML = renderBattle();
      initBattle();
      break;
    case 'result':
      app.innerHTML = renderResult();
      bindResult();
      break;
  }
}

// ---------- ホーム画面 ----------

function renderHome() {
  return `
    <div class="screen">
      <div class="spacer"></div>
      <div class="title">QRバトル</div>
      <div class="subtitle">QRコードを読み取って自分だけのキャラクターを作り、CPUと対戦しよう。</div>
      <div class="spacer"></div>
      <button class="btn block" id="startBtn">QRコードでキャラをつくる</button>
      <div class="spacer"></div>
    </div>
  `;
}

function bindHome() {
  document.getElementById('startBtn').onclick = () => {
    state.screen = 'scanQr';
    render();
  };
}

// ---------- QRスキャン画面 ----------

function renderScanQr() {
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← もどる</button>
        <div></div>
      </div>
      <div class="title" style="font-size:20px;">QRコードを読み取る</div>
      <div class="camera-wrap">
        <video id="qrVideo" playsinline autoplay muted></video>
        <div class="scan-frame" id="scanFrame"></div>
        <div class="camera-hint">QRコードを枠内に収めてください</div>
      </div>
      <canvas class="hidden-canvas" id="qrCanvas"></canvas>
      <div id="qrError"></div>
      <div class="spacer"></div>
      <button class="link-btn" id="manualToggle">カメラが使えない場合はテキストで入力</button>
      <div id="manualArea" style="display:none;" class="manual-input">
        <input type="text" id="manualText" placeholder="QRの内容の代わりに文字を入力" />
        <button class="btn" id="manualSubmit">決定</button>
      </div>
    </div>
  `;
}

function initQrScanner() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'home';
    render();
  };
  document.getElementById('manualToggle').onclick = () => {
    document.getElementById('manualArea').style.display = 'flex';
  };
  document.getElementById('manualSubmit').onclick = () => {
    const val = document.getElementById('manualText').value.trim();
    if (val) onQrDetected(val);
  };

  if (!mediaDevicesAvailable()) {
    showCameraError('qrError', 'このブラウザ/接続ではカメラを利用できません(HTTPS接続が必要です)');
    return;
  }

  const video = document.getElementById('qrVideo');
  const canvas = document.getElementById('qrCanvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    .then((stream) => {
      currentStream = stream;
      video.srcObject = stream;
      video.play();
      qrAnimationId = requestAnimationFrame(tick);
    })
    .catch((err) => showCameraError('qrError', err));

  function tick() {
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert',
      });
      if (code && code.data) {
        const frame = document.getElementById('scanFrame');
        if (frame) frame.classList.add('found');
        onQrDetected(code.data);
        return;
      }
    }
    qrAnimationId = requestAnimationFrame(tick);
  }
}

function onQrDetected(text) {
  stopCamera();
  state.qrText = text;
  state.screen = 'capturePhoto';
  render();
}

// ---------- 撮影画面 ----------

function renderCapturePhoto() {
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← もどる</button>
        <div></div>
      </div>
      <div class="title" style="font-size:20px;">キャラの見た目を撮影</div>
      <div class="subtitle">キャラクターとして使う写真をその場で撮影してください</div>
      <div class="camera-wrap">
        <video id="photoVideo" playsinline autoplay muted></video>
      </div>
      <canvas class="hidden-canvas" id="photoCanvas"></canvas>
      <div id="photoError"></div>
      <div class="capture-btn-row">
        <button class="flip-btn" id="flipBtn">🔄</button>
        <button class="shutter-btn" id="shutterBtn"></button>
        <div style="width:48px;"></div>
      </div>
      <button class="link-btn" id="skipPhoto">写真なしで進める</button>
    </div>
  `;
}

function initPhotoCapture() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'scanQr';
    render();
  };
  document.getElementById('skipPhoto').onclick = () => finalizePlayerCharacter(null);
  document.getElementById('flipBtn').onclick = () => {
    state.photoFacingMode = state.photoFacingMode === 'user' ? 'environment' : 'user';
    startPhotoStream();
  };
  document.getElementById('shutterBtn').onclick = capturePhoto;

  if (!mediaDevicesAvailable()) {
    showCameraError('photoError', 'このブラウザ/接続ではカメラを利用できません(HTTPS接続が必要です)');
    return;
  }
  startPhotoStream();
}

function startPhotoStream() {
  stopCamera();
  const video = document.getElementById('photoVideo');
  if (!video) return;
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: state.photoFacingMode }, audio: false })
    .then((stream) => {
      currentStream = stream;
      video.srcObject = stream;
      video.play();
    })
    .catch((err) => showCameraError('photoError', err));
}

function capturePhoto() {
  const video = document.getElementById('photoVideo');
  const canvas = document.getElementById('photoCanvas');
  if (!video || !video.videoWidth) return;
  const size = Math.min(video.videoWidth, video.videoHeight);
  const targetSize = 480;
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  const sx = (video.videoWidth - size) / 2;
  const sy = (video.videoHeight - size) / 2;
  ctx.drawImage(video, sx, sy, size, size, 0, 0, targetSize, targetSize);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  finalizePlayerCharacter(dataUrl);
}

function finalizePlayerCharacter(dataUrl) {
  stopCamera();
  state.photoDataUrl = dataUrl;
  state.playerCharacter = generateCharacterFromText(state.qrText, 'あなた', dataUrl);
  state.screen = 'preview';
  render();
}

// ---------- キャラクターカード共通表示 ----------

function renderCharacterCard(char, compact) {
  const avatar = char.image
    ? `<img class="char-avatar" src="${char.image}" alt="${escapeHtml(char.name)}" />`
    : `<div class="char-avatar">${char.name === 'CPU' ? '🤖' : '🧑'}</div>`;
  const hpPct = Math.max(0, Math.round((char.hp / char.maxHp) * 100));
  return `
    <div class="char-card ${compact ? 'compact' : ''}">
      ${avatar}
      <div class="char-info">
        <div class="char-name">${escapeHtml(char.name)}</div>
        <div class="stat-row"><span>HP ${char.hp}/${char.maxHp}</span><span>攻撃力 ${char.atk}</span></div>
        <div class="hp-bar-track"><div class="hp-bar-fill ${hpPct <= 30 ? 'low' : ''}" style="width:${hpPct}%"></div></div>
      </div>
    </div>
  `;
}

function renderCommandTable(table) {
  const cells = table
    .map((cmd, i) => {
      let cls = 'miss';
      if (cmd === COMMAND_TYPES.ATTACK) cls = 'attack';
      else if (cmd === COMMAND_TYPES.CRITICAL) cls = 'critical';
      else if (cmd === COMMAND_TYPES.GUARD_STRIKE) cls = 'guard';
      return `<div class="command-cell ${cls}"><div class="face">出目 ${i + 1}</div><div class="cmd">${cmd}</div></div>`;
    })
    .join('');
  return `<div class="command-table">${cells}</div>`;
}

// ---------- キャラ確認画面 ----------

function renderPreview() {
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← やり直す</button>
        <div></div>
      </div>
      <div class="title" style="font-size:20px;">キャラクター確認</div>
      ${renderCharacterCard(state.playerCharacter, false)}
      <div class="section-label">コマンド表(サイコロの目 → 行動)</div>
      ${renderCommandTable(state.playerCharacter.commandTable)}
      <div class="spacer"></div>
      <button class="btn block" id="battleStartBtn">バトル開始</button>
    </div>
  `;
}

function bindPreview() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'home';
    state.qrText = null;
    state.photoDataUrl = null;
    state.playerCharacter = null;
    render();
  };
  document.getElementById('battleStartBtn').onclick = () => {
    state.cpuCharacter = generateCpuCharacter();
    state.battlePlayer = { ...state.playerCharacter };
    state.battleCpu = { ...state.cpuCharacter };
    state.battle = {
      log: [`バトル開始！ ${state.battlePlayer.name} VS ${state.battleCpu.name}`],
      playerHand: null,
      cpuHand: null,
      diceValue: null,
      message: '',
      round: 1,
      busy: false,
    };
    state.screen = 'battle';
    render();
  };
}

// ---------- バトル画面 ----------

function renderBattle() {
  const b = state.battle;
  return `
    <div class="screen">
      <div class="battle-top">
        ${renderCharacterCard(state.battlePlayer, true)}
        <div class="vs-label">VS</div>
        ${renderCharacterCard(state.battleCpu, true)}
      </div>
      <div class="round-label">ラウンド ${b.round}</div>
      <div class="battle-arena">
        ${renderArenaContent(b)}
      </div>
      ${!b.busy ? renderHandChoices() : '<div class="subtitle">勝負中<span class="loading-dot">…</span></div>'}
      <div class="battle-log">${renderLog(b.log)}</div>
    </div>
  `;
}

function renderArenaContent(b) {
  let html = '';
  if (!b.busy && !b.playerHand) {
    html += `<div>じゃんけんの手を選んでください</div>`;
  }
  if (b.playerHand && b.cpuHand) {
    html += `
      <div class="hands-row">
        <div><div class="hand-display">${HAND_EMOJI[b.playerHand]}</div><div class="hand-label">あなた</div></div>
        <div><div class="hand-display">${HAND_EMOJI[b.cpuHand]}</div><div class="hand-label">CPU</div></div>
      </div>
    `;
  } else if (b.playerHand) {
    html += `
      <div class="hands-row">
        <div><div class="hand-display">${HAND_EMOJI[b.playerHand]}</div><div class="hand-label">あなた</div></div>
        <div><div class="hand-display">❓</div><div class="hand-label">CPU</div></div>
      </div>
    `;
  }
  if (b.diceValue) {
    html += `<div class="dice-display">🎲 ${b.diceValue}</div>`;
  }
  if (b.message) {
    html += `<div class="result-message">${escapeHtml(b.message)}</div>`;
  }
  return html;
}

function renderHandChoices() {
  return `
    <div class="hand-choice-row">
      <button class="hand-btn" data-hand="グー">✊</button>
      <button class="hand-btn" data-hand="チョキ">✌️</button>
      <button class="hand-btn" data-hand="パー">✋</button>
    </div>
  `;
}

function renderLog(log) {
  return log.map((msg) => `<div>${escapeHtml(msg)}</div>`).join('');
}

function initBattle() {
  document.querySelectorAll('.hand-btn').forEach((btn) => {
    btn.onclick = () => {
      if (state.battle.busy) return;
      onPlayerChooseHand(btn.dataset.hand);
    };
  });
}

function addLog(msg) {
  state.battle.log.unshift(msg);
}

async function onPlayerChooseHand(hand) {
  const b = state.battle;
  b.busy = true;
  b.playerHand = hand;
  b.cpuHand = null;
  b.diceValue = null;
  b.message = '';
  render();

  await wait(400);
  const cpuHand = randomHand();
  b.cpuHand = cpuHand;
  render();

  await wait(500);
  const result = judgeJanken(hand, cpuHand);

  if (result === 'draw') {
    addLog(`あいこ！ (${hand} vs ${cpuHand})`);
    b.message = 'あいこ！もう一度';
    render();
    await wait(800);
    b.playerHand = null;
    b.cpuHand = null;
    b.message = '';
    b.busy = false;
    render();
    return;
  }

  const winnerIsPlayer = result === 'player';
  addLog(`じゃんけん: ${winnerIsPlayer ? 'あなた' : 'CPU'}の勝ち！ (${hand} vs ${cpuHand})`);
  b.message = winnerIsPlayer ? 'じゃんけんに勝った！ あなたの攻撃！' : 'じゃんけんに負けた… CPUの攻撃！';
  render();
  await wait(700);

  const attacker = winnerIsPlayer ? state.battlePlayer : state.battleCpu;
  const defender = winnerIsPlayer ? state.battleCpu : state.battlePlayer;

  const dice = rollDice();
  b.diceValue = dice;
  b.message = `${attacker.name}がサイコロを振った…`;
  render();
  await wait(600);

  const command = attacker.commandTable[dice - 1];
  const { damage, message } = resolveCommand(command, attacker.atk);
  defender.hp = Math.max(0, defender.hp - damage);
  addLog(`${attacker.name}: 出目${dice} → ${message}`);
  b.message = message;
  render();
  await wait(900);

  if (defender.hp <= 0) {
    state.battleResult = winnerIsPlayer ? 'win' : 'lose';
    state.screen = 'result';
    render();
    return;
  }

  b.round += 1;
  b.playerHand = null;
  b.cpuHand = null;
  b.diceValue = null;
  b.message = '';
  b.busy = false;
  render();
}

// ---------- 結果画面 ----------

function renderResult() {
  const win = state.battleResult === 'win';
  return `
    <div class="screen result-screen">
      <div class="result-emoji">${win ? '🏆' : '💀'}</div>
      <div class="result-title ${win ? 'win' : 'lose'}">${win ? 'しょうり！' : 'はいぼく…'}</div>
      <div class="subtitle">${win ? `${escapeHtml(state.battleCpu.name)}を倒した！` : `${escapeHtml(state.battlePlayer.name)}はたおれてしまった…`}</div>
      <button class="btn block" id="restartBtn">もう一度あそぶ</button>
    </div>
  `;
}

function bindResult() {
  document.getElementById('restartBtn').onclick = () => {
    state.screen = 'home';
    state.qrText = null;
    state.photoDataUrl = null;
    state.playerCharacter = null;
    state.cpuCharacter = null;
    state.battlePlayer = null;
    state.battleCpu = null;
    state.battle = null;
    state.battleResult = null;
    render();
  };
}

// ---------- 起動 ----------

render();
