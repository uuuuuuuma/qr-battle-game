// アプリ全体の状態管理・画面遷移・カメラ制御

const state = {
  screen: 'home',
  playerName: '',
  qrText: null,
  photoDataUrl: null,
  photoFacingMode: 'user',
  playerCharacter: null,
  cpuCharacter: null,
  speedCardSelection: null,
  skillCardSelection: null,
  battlePlayer: null,
  battleCpu: null,
  playerSpeedDeck: null,
  playerSkillDeck: null,
  cpuSpeedDeck: null,
  cpuSkillDeck: null,
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
    case 'enterName':
      app.innerHTML = renderEnterName();
      bindEnterName();
      break;
    case 'selectCommandTable':
      app.innerHTML = renderSelectCommandTable();
      bindSelectCommandTable();
      break;
    case 'selectSpeedCards':
      app.innerHTML = renderSelectSpeedCards();
      bindSelectSpeedCards();
      break;
    case 'selectSkillCards':
      app.innerHTML = renderSelectSkillCards();
      bindSelectSkillCards();
      break;
    case 'preview':
      app.innerHTML = renderPreview();
      bindPreview();
      break;
    case 'ready':
      app.innerHTML = renderReady();
      bindReady();
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
  document.getElementById('skipPhoto').onclick = () => goToNameEntry(null);
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
  goToNameEntry(dataUrl);
}

function goToNameEntry(dataUrl) {
  stopCamera();
  state.photoDataUrl = dataUrl;
  state.screen = 'enterName';
  render();
}

// ---------- 名前入力画面 ----------

function renderEnterName() {
  const avatar = state.photoDataUrl
    ? `<img class="char-avatar" src="${state.photoDataUrl}" alt="撮影した写真" />`
    : `<div class="char-avatar">🧑</div>`;
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← もどる</button>
        <div></div>
      </div>
      <div class="title" style="font-size:20px;">名前を決める</div>
      <div style="display:flex; justify-content:center;">${avatar}</div>
      <div class="name-input-row">
        <label class="section-label" for="playerNameInput">キャラクターの名前(省略可)</label>
        <input type="text" id="playerNameInput" placeholder="あなた" maxlength="10" value="${escapeHtml(state.playerName || '')}" />
      </div>
      <div class="spacer"></div>
      <button class="btn block" id="nameConfirmBtn">つぎへ</button>
    </div>
  `;
}

function bindEnterName() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'capturePhoto';
    render();
  };
  document.getElementById('playerNameInput').oninput = (e) => {
    state.playerName = e.target.value;
  };
  document.getElementById('nameConfirmBtn').onclick = () => {
    finalizePlayerCharacter(state.photoDataUrl);
  };
}

function finalizePlayerCharacter(dataUrl) {
  const name = (state.playerName && state.playerName.trim()) || 'あなた';
  state.playerCharacter = generateCharacterFromText(state.qrText, name, dataUrl);
  state.playerCharacter.speedCardPool = generateSpeedCardPool(state.qrText, name);
  state.playerCharacter.skillCardPool = generateSkillCardPool(state.qrText, name);
  state.screen = 'selectCommandTable';
  render();
}

// ---------- コマンド表選択画面 ----------

function renderSelectCommandTable() {
  const options = state.playerCharacter.commandTableOptions;
  const optionsHtml = options
    .map((table, i) => `
      <div class="table-option">
        <div class="section-label">候補 ${i + 1}</div>
        ${renderCommandTable(table)}
        <button class="btn secondary block" data-option-index="${i}">これに決める</button>
      </div>
    `)
    .join('');
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← もどる</button>
        <div></div>
      </div>
      <div class="title" style="font-size:20px;">コマンド表を選ぶ</div>
      <div class="subtitle">3つの候補から、バトルで使うコマンド表を1つ選んでください</div>
      ${optionsHtml}
    </div>
  `;
}

function bindSelectCommandTable() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'enterName';
    render();
  };
  document.querySelectorAll('[data-option-index]').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.optionIndex);
      state.playerCharacter.commandTable = state.playerCharacter.commandTableOptions[idx];
      // デフォルトでは完全ランダムのワイルドカードを除いたカード(QR由来)を選択済みにしておく
      state.speedCardSelection = new Set(
        state.playerCharacter.speedCardPool.filter((c) => !c.isWild).map((c) => c.id)
      );
      state.screen = 'selectSpeedCards';
      render();
    };
  });
}

// ---------- スピードカード選択画面 ----------

function renderSelectSpeedCards() {
  const pool = state.playerCharacter.speedCardPool;
  const selection = state.speedCardSelection;
  const cardsHtml = pool
    .map((card) => {
      const isSelected = selection.has(card.id);
      return `
        <button class="act-card speed-card ${isSelected ? 'selected' : ''}" data-card-id="${card.id}">
          ${card.isWild ? '<div class="wild-badge">WILD</div>' : ''}
          <div class="act-card-speed">SPD ${card.speed}</div>
        </button>
      `;
    })
    .join('');
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← もどる</button>
        <div></div>
      </div>
      <div class="title" style="font-size:20px;">スピードカードを選ぶ</div>
      <div class="subtitle">12枚(うちWILDの2枚は完全ランダム)の中から、実際に使う10枚を選んでください</div>
      <div class="selection-count">選択中: ${selection.size} / 10</div>
      <div class="act-card-grid select-grid">${cardsHtml}</div>
      <div class="spacer"></div>
      <button class="btn block" id="confirmBtn" ${selection.size === 10 ? '' : 'disabled'}>これで決定</button>
    </div>
  `;
}

function bindSelectSpeedCards() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'selectCommandTable';
    render();
  };
  document.querySelectorAll('.select-grid .act-card').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.cardId;
      const selection = state.speedCardSelection;
      if (selection.has(id)) {
        selection.delete(id);
      } else {
        if (selection.size >= 10) return;
        selection.add(id);
      }
      render();
    };
  });
  document.getElementById('confirmBtn').onclick = () => {
    if (state.speedCardSelection.size !== 10) return;
    state.playerCharacter.speedCards = state.playerCharacter.speedCardPool.filter((c) => state.speedCardSelection.has(c.id));
    state.skillCardSelection = new Set(
      state.playerCharacter.skillCardPool.filter((c) => !c.isWild).map((c) => c.id)
    );
    state.screen = 'selectSkillCards';
    render();
  };
}

// ---------- スキルカード選択画面 ----------

function renderSelectSkillCards() {
  const pool = state.playerCharacter.skillCardPool;
  const selection = state.skillCardSelection;
  const cardsHtml = pool
    .map((card) => {
      const isSelected = selection.has(card.id);
      return `
        <button class="act-card ${effectClass(card.effectType)} ${isSelected ? 'selected' : ''}" data-card-id="${card.id}">
          ${card.isWild ? '<div class="wild-badge">WILD</div>' : ''}
          <div class="act-card-label">${escapeHtml(card.label)}</div>
        </button>
      `;
    })
    .join('');
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← もどる</button>
        <div></div>
      </div>
      <div class="title" style="font-size:20px;">スキルカードを選ぶ</div>
      <div class="subtitle">9枚(うちWILDの3枚は完全ランダム)の中から、実際に使う6枚を選んでください</div>
      <div class="selection-count">選択中: ${selection.size} / 6</div>
      <div class="act-card-grid select-grid">${cardsHtml}</div>
      <div class="spacer"></div>
      <button class="btn block" id="confirmBtn" ${selection.size === 6 ? '' : 'disabled'}>これで決定</button>
    </div>
  `;
}

function bindSelectSkillCards() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'selectSpeedCards';
    render();
  };
  document.querySelectorAll('.select-grid .act-card').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.cardId;
      const selection = state.skillCardSelection;
      if (selection.has(id)) {
        selection.delete(id);
      } else {
        if (selection.size >= 6) return;
        selection.add(id);
      }
      render();
    };
  });
  document.getElementById('confirmBtn').onclick = () => {
    if (state.skillCardSelection.size !== 6) return;
    state.playerCharacter.skillCards = state.playerCharacter.skillCardPool.filter((c) => state.skillCardSelection.has(c.id));
    state.screen = 'preview';
    render();
  };
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
        <div class="char-name">${escapeHtml(char.name)}${char.poisoned ? ' <span class="status-badge poison">🧪毒</span>' : ''}</div>
        <div class="stat-row"><span>HP ${char.hp}/${char.maxHp}</span><span>攻撃力 ${char.atk}</span></div>
        <div class="hp-bar-track"><div class="hp-bar-fill ${hpPct <= 30 ? 'low' : ''}" style="width:${hpPct}%"></div></div>
      </div>
    </div>
  `;
}

// 対戦画面用: 左右に並べて表示する縦型カード(写真は大きめ)。poisonHit が true の間、紫のエフェクトを付ける
function renderVsCharacterCard(char, poisonHit) {
  const avatar = char.image
    ? `<img class="char-avatar-lg" src="${char.image}" alt="${escapeHtml(char.name)}" />`
    : `<div class="char-avatar-lg">${char.name === 'CPU' ? '🤖' : '🧑'}</div>`;
  const hpPct = Math.max(0, Math.round((char.hp / char.maxHp) * 100));
  return `
    <div class="vs-char-card ${poisonHit ? 'poison-hit' : ''}">
      ${avatar}
      <div class="char-name">${escapeHtml(char.name)}${char.poisoned ? ' <span class="status-badge poison">🧪毒</span>' : ''}</div>
      <div class="stat-row"><span>HP ${char.hp}/${char.maxHp}</span></div>
      <div class="stat-row"><span>攻撃力 ${char.atk}</span></div>
      <div class="hp-bar-track"><div class="hp-bar-fill ${hpPct <= 30 ? 'low' : ''}" style="width:${hpPct}%"></div></div>
    </div>
  `;
}

// revealed を渡すと、そのインデックス(出目-1)が含まれていない面は「？」で伏せて表示する
function renderCommandTable(table, revealed) {
  const cells = table
    .map((cmd, i) => {
      if (revealed && !revealed.has(i)) {
        return `<div class="command-cell hidden"><div class="face">出目 ${i + 1}</div><div class="cmd">？</div></div>`;
      }
      let cls = 'miss';
      if (cmd === COMMAND_TYPES.ATTACK) cls = 'attack';
      else if (cmd === COMMAND_TYPES.CRITICAL) cls = 'critical';
      else if (cmd === COMMAND_TYPES.GUARD_STRIKE) cls = 'guard';
      else if (cmd === COMMAND_TYPES.COMBO) cls = 'combo';
      else if (cmd === COMMAND_TYPES.HEAL) cls = 'heal';
      else if (cmd === COMMAND_TYPES.POISON) cls = 'poison';
      else if (cmd === COMMAND_TYPES.COLLAPSE) cls = 'collapse';
      const sCls = isSCommand(cmd) ? ' s-command' : '';
      return `<div class="command-cell ${cls}${sCls}"><div class="face">出目 ${i + 1}</div><div class="cmd">${cmd}</div></div>`;
    })
    .join('');
  return `<div class="command-table">${cells}</div>`;
}

// ---------- スピード/スキルカード共通表示 ----------

function effectClass(effectType) {
  switch (effectType) {
    case EFFECT_TYPES.CHARGE: return 'effect-charge';
    case EFFECT_TYPES.GUARD: return 'effect-guard';
    case EFFECT_TYPES.ACCEL: return 'effect-accel';
    case EFFECT_TYPES.AGILE: return 'effect-agile';
    default: return '';
  }
}

// ---------- コマンド使用時のエフェクト ----------

function effectVisualIcon(cmd) {
  switch (cmd) {
    case COMMAND_TYPES.ATTACK: return '⚔️';
    case COMMAND_TYPES.GUARD_STRIKE: return '🗡️';
    case COMMAND_TYPES.CRITICAL: return '💥';
    case COMMAND_TYPES.COMBO: return '🔗';
    case COMMAND_TYPES.HEAL: return '💚';
    case COMMAND_TYPES.POISON: return '☠️';
    case COMMAND_TYPES.COLLAPSE: return '🌀';
    case COMMAND_TYPES.MISS:
    default:
      return '💨';
  }
}

function effectVisualClass(cmd) {
  switch (cmd) {
    case COMMAND_TYPES.ATTACK: return 'fx-attack';
    case COMMAND_TYPES.GUARD_STRIKE: return 'fx-guard';
    case COMMAND_TYPES.CRITICAL: return 'fx-critical';
    case COMMAND_TYPES.COMBO: return 'fx-combo';
    case COMMAND_TYPES.HEAL: return 'fx-heal';
    case COMMAND_TYPES.POISON: return 'fx-poison';
    case COMMAND_TYPES.COLLAPSE: return 'fx-collapse';
    case COMMAND_TYPES.MISS:
    default:
      return 'fx-miss';
  }
}

function renderSpeedCardFace(card, small) {
  return `<div class="act-card speed-card ${small ? 'small' : ''}"><div class="act-card-speed">SPD ${card.speed}</div></div>`;
}

function renderSkillCardFace(card, small) {
  return `<div class="act-card ${small ? 'small' : ''} ${effectClass(card.effectType)}"><div class="act-card-label">${escapeHtml(card.label)}</div></div>`;
}

function renderCardBack(small) {
  return `<div class="act-card ${small ? 'small' : ''} card-back">？</div>`;
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
      <div class="section-label">選んだスピードカード(10枚)</div>
      <div class="act-card-grid">${state.playerCharacter.speedCards.map((c) => renderSpeedCardFace(c, true)).join('')}</div>
      <div class="section-label">選んだスキルカード(6枚)</div>
      <div class="act-card-grid">${state.playerCharacter.skillCards.map((c) => renderSkillCardFace(c, true)).join('')}</div>
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
    state.speedCardSelection = null;
    state.skillCardSelection = null;
    render();
  };
  document.getElementById('battleStartBtn').onclick = () => {
    state.cpuCharacter = generateCpuCharacter();
    state.screen = 'ready';
    render();
  };
}

// ---------- 準備(Ready?)画面 ----------

function renderReady() {
  return `
    <div class="screen result-screen">
      <div class="title">Ready?</div>
      <div class="vs-arena">
        ${renderVsCharacterCard(state.playerCharacter, false)}
        <div class="vs-label">VS</div>
        ${renderVsCharacterCard(state.cpuCharacter, false)}
      </div>
      <div class="spacer"></div>
      <button class="btn secondary block" id="editBtn">← コマンド・カードを変更する</button>
      <button class="btn block" id="fightStartBtn">たたかう！</button>
    </div>
  `;
}

function bindReady() {
  document.getElementById('editBtn').onclick = () => {
    state.screen = 'selectCommandTable';
    render();
  };
  document.getElementById('fightStartBtn').onclick = () => {
    state.battlePlayer = { ...state.playerCharacter };
    state.battleCpu = { ...state.cpuCharacter };
    state.playerSpeedDeck = createDeckState(state.playerCharacter.speedCards);
    state.playerSkillDeck = createDeckState(state.playerCharacter.skillCards);
    state.cpuSpeedDeck = createDeckState(state.battleCpu.speedCards);
    state.cpuSkillDeck = createDeckState(state.battleCpu.skillCards);
    state.battle = {
      log: [`バトル開始！ ${state.battlePlayer.name} VS ${state.battleCpu.name}`],
      playerSpeedCard: null,
      cpuSpeedCard: null,
      playerSkillCard: null,
      cpuSkillCard: null,
      selectedSpeedCardId: null,
      selectedSkillCardId: null,
      diceValue: null,
      message: '',
      round: 1,
      busy: false,
      arenaColor: null,
      awaitingContinue: false,
      awaitingDiceRoll: false,
      showPlayerTable: false,
      showCpuTable: false,
      cpuRevealed: new Set(),
      playerAtkBonus: 0,
      cpuAtkBonus: 0,
      playerGuardMult: null,
      cpuGuardMult: null,
      playerSpeedDelta: 0,
      cpuSpeedDelta: 0,
      playerAccel: false,
      cpuAccel: false,
      commandEffect: null,
      poisonMessages: [],
      poisonHitSides: [],
    };
    state.screen = 'battle';
    render();
  };
}

// ---------- バトル画面 ----------

function renderBattle() {
  const b = state.battle;
  const arenaStyle = b.arenaColor ? ` style="background:${b.arenaColor};"` : '';
  return `
    <div class="screen">
      <div class="vs-arena">
        ${renderVsCharacterCard(state.battlePlayer, b.poisonHitSides.includes('player'))}
        <div class="vs-label">VS</div>
        ${renderVsCharacterCard(state.battleCpu, b.poisonHitSides.includes('cpu'))}
      </div>
      <div class="round-label">ラウンド ${b.round}</div>
      <div class="battle-arena"${arenaStyle}>
        ${renderArenaContent(b)}
      </div>
      ${renderBattleControls(b)}
      <div class="table-toggle-row">
        <button class="btn secondary" id="togglePlayerTable">${b.showPlayerTable ? '自分のコマンドを隠す' : '自分のコマンドを見る'}</button>
        <button class="btn secondary" id="toggleCpuTable">${b.showCpuTable ? '相手のコマンドを隠す' : '相手のコマンドを見る'}</button>
      </div>
      ${b.showPlayerTable ? `<div class="section-label">あなたのコマンド表</div>${renderCommandTable(state.battlePlayer.commandTable)}` : ''}
      ${b.showCpuTable ? `<div class="section-label">CPUのコマンド表(使われた面だけ公開)</div>${renderCommandTable(state.battleCpu.commandTable, b.cpuRevealed)}` : ''}
      <div class="battle-log">${renderLog(b.log)}</div>
    </div>
  `;
}

function renderBattleControls(b) {
  if (b.awaitingDiceRoll) {
    return `<button class="btn block" id="rollDiceBtn">🎲 サイコロを振る</button>`;
  }
  if (b.awaitingContinue) {
    return `<button class="btn block" id="continueBtn">▶ タップしてつぎへ</button>`;
  }
  if (!b.busy) {
    return renderRoundCardPicker(b);
  }
  return '<div class="subtitle">勝負中<span class="loading-dot">…</span></div>';
}

function renderRoundCardStack(speedCard, skillCard) {
  return `
    <div class="round-card-stack">
      ${renderSpeedCardFace(speedCard, true)}
      ${skillCard ? renderSkillCardFace(skillCard, true) : ''}
    </div>
  `;
}

function renderArenaContent(b) {
  let html = '';
  if (!b.busy && !b.playerSpeedCard) {
    html += `<div>カードを選んでください</div>`;
  }
  if (b.playerSpeedCard && b.cpuSpeedCard) {
    html += `
      <div class="hands-row">
        <div>${renderRoundCardStack(b.playerSpeedCard, b.playerSkillCard)}<div class="hand-label">あなた</div></div>
        <div>${renderRoundCardStack(b.cpuSpeedCard, b.cpuSkillCard)}<div class="hand-label">CPU</div></div>
      </div>
    `;
  } else if (b.playerSpeedCard) {
    html += `
      <div class="hands-row">
        <div>${renderRoundCardStack(b.playerSpeedCard, b.playerSkillCard)}<div class="hand-label">あなた</div></div>
        <div>${renderCardBack(true)}<div class="hand-label">CPU</div></div>
      </div>
    `;
  }
  if (b.diceValue) {
    html += `<div class="dice-display">🎲 ${b.diceValue}</div>`;
  }
  if (b.commandEffect) {
    html += `<div class="command-effect ${effectVisualClass(b.commandEffect.type)}">${effectVisualIcon(b.commandEffect.type)} ${escapeHtml(b.commandEffect.label)}</div>`;
  }
  if (b.message) {
    html += `<div class="result-message">${escapeHtml(b.message)}</div>`;
  }
  if (b.poisonMessages && b.poisonMessages.length > 0) {
    html += b.poisonMessages.map((msg) => `<div class="poison-message">🧪 ${escapeHtml(msg)}</div>`).join('');
  }
  return html;
}

function renderRoundCardPicker(b) {
  const speedHand = state.playerSpeedDeck.hand;
  const skillHand = state.playerSkillDeck.hand;
  const speedHtml = speedHand
    .map((card) => `<button class="act-card speed-card ${b.selectedSpeedCardId === card.id ? 'selected' : ''}" data-speed-card-id="${card.id}"><div class="act-card-speed">SPD ${card.speed}</div></button>`)
    .join('');
  const skillHtml = skillHand
    .map((card) => `<button class="act-card ${effectClass(card.effectType)} ${b.selectedSkillCardId === card.id ? 'selected' : ''}" data-skill-card-id="${card.id}"><div class="act-card-label">${escapeHtml(card.label)}</div></button>`)
    .join('');
  return `
    <div class="section-label">スピードカード(1枚必須)</div>
    <div class="card-hand-row speed-pick">${speedHtml}</div>
    <div class="section-label">スキルカード(任意・タップで選択/解除)</div>
    <div class="card-hand-row skill-pick">${skillHtml}</div>
    <div class="deck-count">スピード 山札${state.playerSpeedDeck.deck.length}・捨て札${state.playerSpeedDeck.discard.length} ｜ スキル 山札${state.playerSkillDeck.deck.length}・捨て札${state.playerSkillDeck.discard.length}</div>
    <button class="btn block" id="playCardsBtn" ${b.selectedSpeedCardId ? '' : 'disabled'}>カードを出す</button>
  `;
}

function renderLog(log) {
  return log.map((msg) => `<div>${escapeHtml(msg)}</div>`).join('');
}

function initBattle() {
  document.querySelectorAll('.speed-pick .act-card').forEach((btn) => {
    btn.onclick = () => {
      if (state.battle.busy) return;
      state.battle.selectedSpeedCardId = btn.dataset.speedCardId;
      render();
    };
  });
  document.querySelectorAll('.skill-pick .act-card').forEach((btn) => {
    btn.onclick = () => {
      if (state.battle.busy) return;
      const id = btn.dataset.skillCardId;
      state.battle.selectedSkillCardId = state.battle.selectedSkillCardId === id ? null : id;
      render();
    };
  });
  const playCardsBtn = document.getElementById('playCardsBtn');
  if (playCardsBtn) {
    playCardsBtn.onclick = () => {
      if (!state.battle.selectedSpeedCardId) return;
      onPlayerPlayCards();
    };
  }
  const continueBtn = document.getElementById('continueBtn');
  if (continueBtn) continueBtn.onclick = onContinueClick;
  const rollDiceBtn = document.getElementById('rollDiceBtn');
  if (rollDiceBtn) rollDiceBtn.onclick = onContinueClick;
  const togglePlayerBtn = document.getElementById('togglePlayerTable');
  if (togglePlayerBtn) {
    togglePlayerBtn.onclick = () => {
      state.battle.showPlayerTable = !state.battle.showPlayerTable;
      render();
    };
  }
  const toggleCpuBtn = document.getElementById('toggleCpuTable');
  if (toggleCpuBtn) {
    toggleCpuBtn.onclick = () => {
      state.battle.showCpuTable = !state.battle.showCpuTable;
      render();
    };
  }
}

function addLog(msg) {
  state.battle.log.unshift(msg);
}

// 攻撃結果の表示後、ユーザーが「つぎへ」をタップするまで待つ
let continueResolver = null;
function waitForContinueClick() {
  return new Promise((resolve) => {
    continueResolver = resolve;
  });
}
function onContinueClick() {
  if (continueResolver) {
    const resolve = continueResolver;
    continueResolver = null;
    resolve();
  }
}

// スキルカードの効果を発動する(出した瞬間に発動。「受け身」は条件成立時のみ実際に効く)
function applySkillCardEffect(skillCard, side) {
  if (!skillCard) return;
  const b = state.battle;
  const character = side === 'player' ? state.battlePlayer : state.battleCpu;
  const label = side === 'player' ? 'あなた' : 'CPU';
  switch (skillCard.effectType) {
    case EFFECT_TYPES.CHARGE: {
      const speedDelta = -skillCard.n / 2;
      if (side === 'player') {
        b.playerAtkBonus = skillCard.n;
        b.playerSpeedDelta = speedDelta;
      } else {
        b.cpuAtkBonus = skillCard.n;
        b.cpuSpeedDelta = speedDelta;
      }
      addLog(`${label}: 「${skillCard.label}」発動！ 攻撃力+${skillCard.n}、スピード${speedDelta}`);
      break;
    }
    case EFFECT_TYPES.GUARD: {
      const mult = skillCard.n;
      if (side === 'player') b.playerGuardMult = mult;
      else b.cpuGuardMult = mult;
      addLog(`${label}: 「${skillCard.label}」発動！ 攻撃できなかった場合ダメージ${Math.round(mult * 100)}%に軽減`);
      break;
    }
    case EFFECT_TYPES.ACCEL: {
      character.permanentSpeedBonus = (character.permanentSpeedBonus || 0) + 1;
      if (side === 'player') b.playerAccel = true;
      else b.cpuAccel = true;
      addLog(`${label}: 「アクセル」発動！ このラウンドのスピードは0。次のラウンド以降スピード+1(永続)`);
      break;
    }
    case EFFECT_TYPES.AGILE: {
      if (side === 'player') {
        b.playerSpeedDelta = skillCard.n;
        b.playerAtkBonus = -skillCard.n * 2;
      } else {
        b.cpuSpeedDelta = skillCard.n;
        b.cpuAtkBonus = -skillCard.n * 2;
      }
      addLog(`${label}: 「${skillCard.label}」発動！ スピード+${skillCard.n}、攻撃力-${skillCard.n * 2}`);
      break;
    }
  }
}

async function onPlayerPlayCards() {
  const b = state.battle;
  b.busy = true;
  b.commandEffect = null;
  b.poisonMessages = [];
  b.poisonHitSides = [];

  const playerSpeedCard = playCard(state.playerSpeedDeck, b.selectedSpeedCardId);
  const playerSkillCard = b.selectedSkillCardId ? playCard(state.playerSkillDeck, b.selectedSkillCardId) : null;
  b.selectedSpeedCardId = null;
  b.selectedSkillCardId = null;

  b.playerSpeedCard = playerSpeedCard;
  b.playerSkillCard = playerSkillCard;
  b.cpuSpeedCard = null;
  b.cpuSkillCard = null;
  b.diceValue = null;
  b.message = '';
  b.arenaColor = null;
  render();

  await wait(400);
  const cpuSpeedHandCard = pickCpuCard(state.cpuSpeedDeck);
  const cpuSpeedCard = playCard(state.cpuSpeedDeck, cpuSpeedHandCard.id);
  let cpuSkillCard = null;
  if (state.cpuSkillDeck.hand.length > 0 && Math.random() < 0.6) {
    const cpuSkillPick = pickCpuCard(state.cpuSkillDeck);
    cpuSkillCard = playCard(state.cpuSkillDeck, cpuSkillPick.id);
  }
  b.cpuSpeedCard = cpuSpeedCard;
  b.cpuSkillCard = cpuSkillCard;
  render();

  await wait(500);

  b.playerAtkBonus = 0;
  b.cpuAtkBonus = 0;
  b.playerGuardMult = null;
  b.cpuGuardMult = null;
  b.playerSpeedDelta = 0;
  b.cpuSpeedDelta = 0;
  b.playerAccel = false;
  b.cpuAccel = false;

  applySkillCardEffect(playerSkillCard, 'player');
  applySkillCardEffect(cpuSkillCard, 'cpu');

  if (playerSkillCard || cpuSkillCard) {
    b.message = 'スキルカードの効果が発動！';
    render();
    await wait(800);
  }

  const playerEffSpeed = b.playerAccel
    ? 0
    : playerSpeedCard.speed + (state.battlePlayer.permanentSpeedBonus || 0) + b.playerSpeedDelta;
  const cpuEffSpeed = b.cpuAccel
    ? 0
    : cpuSpeedCard.speed + (state.battleCpu.permanentSpeedBonus || 0) + b.cpuSpeedDelta;

  if (playerEffSpeed === cpuEffSpeed) {
    addLog(`スピード${playerEffSpeed}で同速！ このラウンドはどちらも攻撃できない`);
    b.message = `同速(${playerEffSpeed})…このラウンドは攻撃なし`;
    await resolveRoundEnd(null);
    return;
  }

  const winnerIsPlayer = playerEffSpeed > cpuEffSpeed;
  b.arenaColor = winnerIsPlayer ? '#239dda' : '#e60012';
  addLog(`スピード勝負: ${winnerIsPlayer ? 'あなた' : 'CPU'}の勝ち！ (${playerEffSpeed} vs ${cpuEffSpeed})`);
  b.message = winnerIsPlayer ? 'スピード勝ち！ あなたの攻撃！' : 'スピード負け… CPUの攻撃！';
  render();
  await wait(700);

  const attacker = winnerIsPlayer ? state.battlePlayer : state.battleCpu;
  const defender = winnerIsPlayer ? state.battleCpu : state.battlePlayer;
  const attackerLabel = winnerIsPlayer ? 'あなた' : 'CPU';

  let dice;
  if (winnerIsPlayer) {
    b.message = 'あなたの番です';
    b.awaitingDiceRoll = true;
    render();
    await waitForContinueClick();
    b.awaitingDiceRoll = false;
  }
  dice = rollDice();
  b.diceValue = dice;
  b.message = `${attackerLabel}がサイコロを振った…`;
  render();
  await wait(600);

  if (!winnerIsPlayer) {
    b.cpuRevealed.add(dice - 1);
  }

  const command = attacker.commandTable[dice - 1];
  const atkBonus = winnerIsPlayer ? b.playerAtkBonus : b.cpuAtkBonus;
  const result = resolveCommand(command, attacker, defender, atkBonus);
  b.commandEffect = { type: command, label: result.label };

  let resultText;
  let hitDefender = false;

  if (result.targetsSelf) {
    // ヒール: 自分の体力を回復する(相手にダメージは無い)
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + result.heal);
    const healed = attacker.hp - before;
    resultText = `「${result.label}」！ HPを${healed}回復！`;
  } else if (command === COMMAND_TYPES.MISS) {
    resultText = '「ミス」…このラウンドは何も起こらなかった';
  } else {
    hitDefender = true;
    const defenderGuardMult = winnerIsPlayer ? b.cpuGuardMult : b.playerGuardMult;
    let finalDamage = result.damage;
    let guardApplied = false;
    if (defenderGuardMult !== null) {
      finalDamage = Math.round(finalDamage * defenderGuardMult);
      guardApplied = true;
    }
    defender.hp = Math.max(0, defender.hp - finalDamage);
    resultText = `「${result.label}」！ ${finalDamage} のダメージ！${guardApplied ? '(受け身で軽減)' : ''}`;

    if (command === COMMAND_TYPES.COMBO) {
      resultText += ` (コンボ倍率${result.comboMultBefore.toFixed(1)}倍→次回${attacker.comboMultiplier.toFixed(1)}倍)`;
    }

    if (command === COMMAND_TYPES.POISON && result.poison && defender.hp > 0) {
      defender.poisoned = true;
      resultText += ' 相手は毒状態になった！';
    }

    if (command === COMMAND_TYPES.COLLAPSE && defender.hp > 0 && defender.hp <= defender.maxHp * 0.2) {
      defender.hp = 0;
      resultText += ' 相手はとどめを刺された！';
    }
  }

  addLog(`${attackerLabel}: 出目${dice} → ${resultText}`);
  b.message = resultText;

  await resolveRoundEnd(hitDefender ? defender : null);
}

// 毒状態のキャラクターに、残りHPの10%のダメージを与える。与えたダメージ量を返す(0なら毒なし/対象外)
function tickPoison(character) {
  if (!character.poisoned || character.hp <= 0) return 0;
  const dmg = Math.round(character.hp * 0.1);
  if (dmg <= 0) return 0;
  character.hp = Math.max(0, character.hp - dmg);
  return dmg;
}

function endBattle(result) {
  state.battleResult = result;
  state.screen = 'result';
  render();
}

// サイコロを振った後の処理(ダメージ確定など)が完了した直後に毒を発生させ、
// コマンド結果のすぐ下に毒ダメージを表示してから「タップしてつぎへ」を待つ。
// combatDefender: 通常攻撃で倒れた場合はその対象、それ以外(ミス/ヒール/同速など)は null
async function resolveRoundEnd(combatDefender) {
  const b = state.battle;

  if (combatDefender && combatDefender.hp <= 0) {
    // 通常攻撃で決着した場合は毒処理を行わずそのまま結果へ
    b.awaitingContinue = true;
    render();
    await waitForContinueClick();
    b.awaitingContinue = false;
    endBattle(combatDefender === state.battleCpu ? 'win' : 'lose');
    return;
  }

  const playerPoisonDmg = tickPoison(state.battlePlayer);
  if (playerPoisonDmg > 0) {
    b.poisonMessages.push(`あなたは毒で${playerPoisonDmg}のダメージ！`);
    b.poisonHitSides.push('player');
    addLog(`あなたは毒で${playerPoisonDmg}のダメージ`);
  }
  const cpuPoisonDmg = tickPoison(state.battleCpu);
  if (cpuPoisonDmg > 0) {
    b.poisonMessages.push(`CPUは毒で${cpuPoisonDmg}のダメージ！`);
    b.poisonHitSides.push('cpu');
    addLog(`CPUは毒で${cpuPoisonDmg}のダメージ`);
  }

  b.awaitingContinue = true;
  render();
  await waitForContinueClick();
  b.awaitingContinue = false;

  if (state.battlePlayer.hp <= 0) {
    endBattle('lose');
    return;
  }
  if (state.battleCpu.hp <= 0) {
    endBattle('win');
    return;
  }

  advanceToNextRound();
}

function advanceToNextRound() {
  const b = state.battle;
  refillHand(state.playerSpeedDeck);
  refillHand(state.playerSkillDeck);
  refillHand(state.cpuSpeedDeck);
  refillHand(state.cpuSkillDeck);

  b.round += 1;
  b.playerSpeedCard = null;
  b.cpuSpeedCard = null;
  b.playerSkillCard = null;
  b.cpuSkillCard = null;
  b.diceValue = null;
  b.message = '';
  b.arenaColor = null;
  b.commandEffect = null;
  b.poisonMessages = [];
  b.poisonHitSides = [];
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
    state.speedCardSelection = null;
    state.skillCardSelection = null;
    state.battlePlayer = null;
    state.battleCpu = null;
    state.playerSpeedDeck = null;
    state.playerSkillDeck = null;
    state.cpuSpeedDeck = null;
    state.cpuSkillDeck = null;
    state.battle = null;
    state.battleResult = null;
    render();
  };
}

// ---------- 起動 ----------

render();
