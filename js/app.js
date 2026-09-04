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
  playerDeck: null,
  cpuDeck: null,
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
    case 'selectCommandTable':
      app.innerHTML = renderSelectCommandTable();
      bindSelectCommandTable();
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
  state.playerCharacter.actCards = generateActCards(state.qrText, 'あなた');
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
    state.screen = 'scanQr';
    state.qrText = null;
    state.photoDataUrl = null;
    state.playerCharacter = null;
    render();
  };
  document.querySelectorAll('[data-option-index]').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.optionIndex);
      state.playerCharacter.commandTable = state.playerCharacter.commandTableOptions[idx];
      state.screen = 'preview';
      render();
    };
  });
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

// ---------- アクトカード共通表示 ----------

function effectClass(effectType) {
  switch (effectType) {
    case EFFECT_TYPES.BUFF: return 'effect-buff';
    case EFFECT_TYPES.GUARD: return 'effect-guard';
    case EFFECT_TYPES.FOCUS: return 'effect-focus';
    case EFFECT_TYPES.CHOICE: return 'effect-choice';
    default: return '';
  }
}

function renderCardFace(card, small) {
  return `
    <div class="act-card ${small ? 'small' : ''} ${effectClass(card.effectType)}">
      <div class="act-card-speed">SPD ${card.speed}</div>
      <div class="act-card-label">${escapeHtml(card.label)}</div>
    </div>
  `;
}

function renderCardBack() {
  return `<div class="act-card small card-back">？</div>`;
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
      <div class="section-label">アクトカード(全10枚・バトル開始時に3枚配られます)</div>
      <div class="act-card-grid">${state.playerCharacter.actCards.map((c) => renderCardFace(c, true)).join('')}</div>
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
    state.battlePlayer = { ...state.playerCharacter, focusOverrides: {} };
    state.battleCpu = { ...state.cpuCharacter, focusOverrides: {} };
    state.playerDeck = createDeckState(state.playerCharacter.actCards);
    state.cpuDeck = createDeckState(state.battleCpu.actCards);
    state.battle = {
      log: [`バトル開始！ ${state.battlePlayer.name} VS ${state.battleCpu.name}`],
      playerCard: null,
      cpuCard: null,
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
      playerChoiceFace: null,
      cpuChoiceFace: null,
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
      <div class="battle-top">
        ${renderCharacterCard(state.battlePlayer, true)}
        <div class="vs-label">VS</div>
        ${renderCharacterCard(state.battleCpu, true)}
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
    return renderCardHandChoices();
  }
  return '<div class="subtitle">勝負中<span class="loading-dot">…</span></div>';
}

function renderArenaContent(b) {
  let html = '';
  if (!b.busy && !b.playerCard) {
    html += `<div>アクトカードを選んでください</div>`;
  }
  if (b.playerCard && b.cpuCard) {
    html += `
      <div class="hands-row">
        <div>${renderCardFace(b.playerCard, true)}<div class="hand-label">あなた</div></div>
        <div>${renderCardFace(b.cpuCard, true)}<div class="hand-label">CPU</div></div>
      </div>
    `;
  } else if (b.playerCard) {
    html += `
      <div class="hands-row">
        <div>${renderCardFace(b.playerCard, true)}<div class="hand-label">あなた</div></div>
        <div>${renderCardBack()}<div class="hand-label">CPU</div></div>
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

function renderCardHandChoices() {
  const hand = state.playerDeck.hand;
  const cards = hand
    .map((card) => `<button class="act-card ${effectClass(card.effectType)}" data-card-id="${card.id}"><div class="act-card-speed">SPD ${card.speed}</div><div class="act-card-label">${escapeHtml(card.label)}</div></button>`)
    .join('');
  return `
    <div class="card-hand-row">${cards}</div>
    <div class="deck-count">山札 ${state.playerDeck.deck.length} ・ 捨て札 ${state.playerDeck.discard.length}</div>
  `;
}

function renderLog(log) {
  return log.map((msg) => `<div>${escapeHtml(msg)}</div>`).join('');
}

function initBattle() {
  document.querySelectorAll('.card-hand-row .act-card').forEach((btn) => {
    btn.onclick = () => {
      if (state.battle.busy) return;
      onPlayerPlayCard(btn.dataset.cardId);
    };
  });
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

// カードの追加効果を発動する(出した瞬間に発動。「受け身」は条件成立時のみ実際に効く)
function applyCardEffect(card, side) {
  const b = state.battle;
  const character = side === 'player' ? state.battlePlayer : state.battleCpu;
  const label = side === 'player' ? 'あなた' : 'CPU';
  switch (card.effectType) {
    case EFFECT_TYPES.BUFF: {
      if (side === 'player') b.playerAtkBonus = card.n;
      else b.cpuAtkBonus = card.n;
      addLog(`${label}: 「${card.label}」発動！ このラウンドの攻撃力+${card.n}`);
      break;
    }
    case EFFECT_TYPES.GUARD: {
      const mult = card.n;
      if (side === 'player') b.playerGuardMult = mult;
      else b.cpuGuardMult = mult;
      addLog(`${label}: 「${card.label}」発動！ 攻撃できなかった場合ダメージ${Math.round(mult * 100)}%に軽減`);
      break;
    }
    case EFFECT_TYPES.FOCUS: {
      character.focusOverrides[card.n - 1] = b.round + 1;
      addLog(`${label}: 「${card.label}」発動！ 出目${card.n}が次のラウンド終了時までクリティカルに変化`);
      break;
    }
    case EFFECT_TYPES.CHOICE: {
      if (side === 'player') b.playerChoiceFace = card.n;
      else b.cpuChoiceFace = card.n;
      addLog(`${label}: 「${card.label}」発動！ 攻撃時はサイコロを振らず出目${card.n}を使用`);
      break;
    }
  }
}

// 「集中」で書き換えられた面をクリティカル扱いにしたコマンド表を返す
function getEffectiveCommandTable(character) {
  return character.commandTable.map((cmd, i) => (
    character.focusOverrides[i] !== undefined ? COMMAND_TYPES.CRITICAL : cmd
  ));
}

// 期限切れの「集中」効果を取り除く(upcomingRound はこれから始まるラウンド番号)
function pruneFocusOverrides(character, upcomingRound) {
  Object.keys(character.focusOverrides).forEach((faceIndex) => {
    if (upcomingRound > character.focusOverrides[faceIndex]) {
      delete character.focusOverrides[faceIndex];
    }
  });
}

async function onPlayerPlayCard(cardId) {
  const b = state.battle;
  b.busy = true;

  const playerCard = playCard(state.playerDeck, cardId);
  b.playerCard = playerCard;
  b.cpuCard = null;
  b.diceValue = null;
  b.message = '';
  b.arenaColor = null;
  render();

  await wait(400);
  const cpuHandCard = pickCpuCard(state.cpuDeck);
  const cpuCard = playCard(state.cpuDeck, cpuHandCard.id);
  b.cpuCard = cpuCard;
  render();

  await wait(500);

  b.playerAtkBonus = 0;
  b.cpuAtkBonus = 0;
  b.playerGuardMult = null;
  b.cpuGuardMult = null;
  b.playerChoiceFace = null;
  b.cpuChoiceFace = null;
  applyCardEffect(playerCard, 'player');
  applyCardEffect(cpuCard, 'cpu');
  b.message = 'アクトカードの効果が発動！';
  render();
  await wait(800);

  if (playerCard.speed === cpuCard.speed) {
    addLog(`スピード${playerCard.speed}で同速！ このラウンドはどちらも攻撃できない`);
    b.message = `同速(${playerCard.speed})…このラウンドは攻撃なし`;
    b.awaitingContinue = true;
    render();
    await waitForContinueClick();
    b.awaitingContinue = false;
    finishRound(null);
    return;
  }

  const winnerIsPlayer = playerCard.speed > cpuCard.speed;
  b.arenaColor = winnerIsPlayer ? '#239dda' : '#e60012';
  addLog(`スピード勝負: ${winnerIsPlayer ? 'あなた' : 'CPU'}の勝ち！ (${playerCard.speed} vs ${cpuCard.speed})`);
  b.message = winnerIsPlayer ? 'スピード勝ち！ あなたの攻撃！' : 'スピード負け… CPUの攻撃！';
  render();
  await wait(700);

  const attacker = winnerIsPlayer ? state.battlePlayer : state.battleCpu;
  const defender = winnerIsPlayer ? state.battleCpu : state.battlePlayer;
  const attackerLabel = winnerIsPlayer ? 'あなた' : 'CPU';
  const choiceFace = winnerIsPlayer ? b.playerChoiceFace : b.cpuChoiceFace;
  const effectiveTable = getEffectiveCommandTable(attacker);

  let dice;
  if (choiceFace) {
    dice = choiceFace;
    b.diceValue = dice;
    b.message = `${attackerLabel}は「チョイス${choiceFace}」で出目${choiceFace}を使用！`;
    render();
    await wait(600);
  } else if (winnerIsPlayer) {
    b.message = 'あなたの番です';
    b.awaitingDiceRoll = true;
    render();
    await waitForContinueClick();
    b.awaitingDiceRoll = false;

    dice = rollDice();
    b.diceValue = dice;
    b.message = `${attackerLabel}がサイコロを振った…`;
    render();
    await wait(600);
  } else {
    dice = rollDice();
    b.diceValue = dice;
    b.message = `${attackerLabel}がサイコロを振った…`;
    render();
    await wait(600);
  }

  if (!winnerIsPlayer) {
    b.cpuRevealed.add(dice - 1);
  }

  const command = effectiveTable[dice - 1];
  const atkBonus = winnerIsPlayer ? b.playerAtkBonus : b.cpuAtkBonus;
  const result = resolveCommand(command, attacker, defender, atkBonus);

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
  b.awaitingContinue = true;
  render();

  await waitForContinueClick();
  b.awaitingContinue = false;

  finishRound(hitDefender ? defender : null);
}

// 毒状態のキャラクターに、残りHPの10%のダメージを与える(ラウンド終了時)
function applyPoisonTick(character, label) {
  if (!character.poisoned || character.hp <= 0) return;
  const dmg = Math.round(character.hp * 0.1);
  if (dmg <= 0) return;
  character.hp = Math.max(0, character.hp - dmg);
  addLog(`${label}は毒のダメージ！ ${dmg}のダメージ`);
}

function endBattle(result) {
  state.battleResult = result;
  state.screen = 'result';
  render();
}

function finishRound(defender) {
  const b = state.battle;
  if (defender && defender.hp <= 0) {
    endBattle(defender === state.battleCpu ? 'win' : 'lose');
    return;
  }

  applyPoisonTick(state.battlePlayer, 'あなた');
  if (state.battlePlayer.hp <= 0) {
    endBattle('lose');
    return;
  }
  applyPoisonTick(state.battleCpu, 'CPU');
  if (state.battleCpu.hp <= 0) {
    endBattle('win');
    return;
  }

  pruneFocusOverrides(state.battlePlayer, b.round + 1);
  pruneFocusOverrides(state.battleCpu, b.round + 1);
  refillHand(state.playerDeck);
  refillHand(state.cpuDeck);

  b.round += 1;
  b.playerCard = null;
  b.cpuCard = null;
  b.diceValue = null;
  b.message = '';
  b.arenaColor = null;
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
    state.playerDeck = null;
    state.cpuDeck = null;
    state.battle = null;
    state.battleResult = null;
    render();
  };
}

// ---------- 起動 ----------

render();
