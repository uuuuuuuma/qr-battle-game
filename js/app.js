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
  editingFromReady: false, // Ready画面から個別の選択画面に入った場合、確定後にReadyへ戻る
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

// ---------- 長押し検出・詳細ポップアップ ----------

// onTap: 通常タップ時、onHold: 長押し(holdMs経過)時に呼ばれる。
// クリックイベントには頼らず pointerdown/up 自体でタップと長押しを判定する。
//
// 注意: onTap は通常 render() を同期的に呼び出し、innerHTML を丸ごと再構築するため、
// タップした要素自体がDOMから消えて新しい要素に差し替わる。iOS Safari 等がpointerup後に
// 送ってくる合成 click イベントは、その新しい要素(同じ位置の別インスタンス)に届くことがあり、
// 要素ローカルな状態で「直前に処理済みか」を判定すると新要素では判定できず、onTap が
// 二重発火して選択状態が元に戻ってしまう(たまに反転しない不具合の原因)。
// そのため、直近のタップ処理時刻はモジュール共有の変数で管理する。
let lastPointerTapAt = 0;
function bindTapHold(el, { onTap, onHold, holdMs = 500 } = {}) {
  if (!el) return;
  let timer = null;
  let held = false;
  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
  el.addEventListener('pointerdown', () => {
    held = false;
    clearTimer();
    if (onHold) {
      timer = setTimeout(() => {
        held = true;
        timer = null;
        onHold();
      }, holdMs);
    }
  });
  el.addEventListener('pointerup', () => {
    clearTimer();
    if (!held && onTap) onTap();
    lastPointerTapAt = Date.now();
    held = false;
  });
  el.addEventListener('pointerleave', clearTimer);
  el.addEventListener('pointercancel', clearTimer);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // キーボード操作(Enter/Space)や pointer イベント非対応環境向けのフォールバック。
  // 直前の pointerup で既に処理済みの場合は click の二重発火を無視する。
  el.addEventListener('click', () => {
    if (Date.now() - lastPointerTapAt < 500) return;
    if (onTap) onTap();
  });
}

function showPopup(title, bodyHtml) {
  document.getElementById('popupTitle').textContent = title;
  document.getElementById('popupBody').innerHTML = bodyHtml;
  document.getElementById('popupOverlay').hidden = false;
}

function hidePopup() {
  document.getElementById('popupOverlay').hidden = true;
}

function setupPopup() {
  document.getElementById('popupCloseBtn').onclick = hidePopup;
  document.getElementById('popupOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'popupOverlay') hidePopup();
  });
}

// スキルカードの効果説明(実際の数値を反映)
function skillEffectDescription(card) {
  const n = card.n;
  switch (card.effectType) {
    case EFFECT_TYPES.CHARGE:
      return `このラウンド中、攻撃力が+${n}上昇します。`;
    case EFFECT_TYPES.GUARD:
      return `このラウンドで攻撃できなかった場合、受けるダメージが${n}倍(${Math.round(n * 100)}%)に軽減されます。`;
    case EFFECT_TYPES.ACCEL:
      return 'このラウンドのスピードが0になる代わりに、次のラウンド以降ずっとスピードが+1されます(このバトル中永続・重ねがけ可能)。';
    case EFFECT_TYPES.AGILE:
      return `このラウンド中、スピードが+${n}上昇します。`;
    case EFFECT_TYPES.REVERSE:
      return 'このラウンドのスピード勝負は、スピードが低い方が勝ちになります(お互いが使った場合は元に戻ります)。';
    case EFFECT_TYPES.CHOICE:
      return `スピード勝負に勝った場合、このラウンドはサイコロを振らずに出目${n}のコマンドを実行します。`;
    default:
      return '';
  }
}

function showSkillCardPopup(card) {
  showPopup(card.label, skillEffectDescription(card));
}

// コマンドの効果説明
function commandDescription(cmd) {
  switch (cmd) {
    case COMMAND_TYPES.ATTACK:
      return '攻撃力と同じ量のダメージを相手に与えます。';
    case COMMAND_TYPES.GUARD_STRIKE:
      return '攻撃力の0.5倍のダメージを相手に与えます。';
    case COMMAND_TYPES.CRITICAL:
      return '攻撃力の2倍のダメージを相手に与えます。(Sコマンド)';
    case COMMAND_TYPES.MISS:
      return 'このラウンドは何も起こりません。';
    case COMMAND_TYPES.COMBO:
      return '攻撃力×コンボ倍率のダメージを与えます。使うたびに倍率が+0.3されます(このバトル中永続・重ねがけ可能)。(Sコマンド)';
    case COMMAND_TYPES.HEAL:
      return '攻撃力の0.5倍分、自分のHPを回復します。毒などの状態異常も同時に治します。';
    case COMMAND_TYPES.POISON:
      return '攻撃力の0.5倍のダメージを与え、50%の確率で相手を毒状態にします。毒状態は毎ラウンド終了時、残りHPの10%(端数切り上げ)のダメージを受けます。2回毒を受けると「猛毒」になり、ダメージ率が20%に上がります。(Sコマンド)';
    case COMMAND_TYPES.COLLAPSE:
      return '相手の最大HPの10%のダメージを与えます。直後にHPが最大の20%以下なら、即座に0になります。';
    case COMMAND_TYPES.LEG_SWEEP:
      return '攻撃力の0.5倍のダメージを与え、相手のスピードを永続で-0.5します(このバトル中永続・重ねがけ可能)。';
    case COMMAND_TYPES.SWORD_HUNT:
      return '攻撃力の0.5倍のダメージを与え、相手の攻撃力を永続で-2します(このバトル中永続・重ねがけ可能)。';
    default:
      return '';
  }
}

function showCommandPopup(cmd) {
  showPopup(cmd, commandDescription(cmd));
}

// キャラクターの永続効果一覧をポップアップで表示
function showCharacterEffectsPopup(character) {
  const lines = [];
  const speedBonus = character.permanentSpeedBonus || 0;
  if (speedBonus > 0) {
    lines.push(`⚡ アクセル効果: スピードが永続で+${speedBonus}されています`);
  } else if (speedBonus < 0) {
    lines.push(`🦵 足払いを受けた影響: スピードが永続で${speedBonus}されています`);
  }
  if ((character.comboMultiplier || 1) > 1) {
    lines.push(`🔗 コンボ倍率: 次に「コンボ」を使うと攻撃力×${character.comboMultiplier.toFixed(1)}`);
  }
  if (character.atk < character.baseAtk) {
    lines.push(`🗡️ 刀狩りを受けた影響: 攻撃力が永続で${character.baseAtk}→${character.atk}に低下しています`);
  }
  if ((character.voltageBonus || 0) > 0) {
    lines.push(`🔋 ボルテージ: 攻撃力(とヒール量)が+${character.voltageBonus}されています(状態異常ではないためヒールでは解除されません)`);
  }
  if (character.poisoned) {
    const severe = (character.poisonStacks || 0) >= 2;
    lines.push(severe
      ? '☠️ 猛毒状態: ラウンド終了時に残りHPの20%(端数切り上げ)のダメージを受けます'
      : '🧪 毒状態: ラウンド終了時に残りHPの10%(端数切り上げ)のダメージを受けます');
  }
  const body = lines.length > 0
    ? lines.map((l) => `<div>${escapeHtml(l)}</div>`).join('')
    : '<div>現在、永続効果はありません。</div>';
  showPopup(`${character.name}の状態`, body);
}

// コマンド表内のセルに長押しポップアップを仕込む(data-command が無いセル=伏せられた面は対象外)
function bindCommandTablePopups(root) {
  (root || document).querySelectorAll('.command-cell[data-command]').forEach((cell) => {
    bindTapHold(cell, { onHold: () => showCommandPopup(cell.dataset.command) });
  });
}

// キャラクターカード(vs-char-card)に長押しポップアップを仕込む
function bindCharacterEffectsPopup(el, character) {
  bindTapHold(el, { onHold: () => showCharacterEffectsPopup(character) });
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
    case 'characterInfo':
      app.innerHTML = renderCharacterInfo();
      bindCharacterInfo();
      break;
    case 'selectCommandTable':
      app.innerHTML = renderSelectCommandTable();
      bindSelectCommandTable();
      break;
    case 'selectWildcardSet':
      app.innerHTML = renderSelectWildcardSet();
      bindSelectWildcardSet();
      break;
    case 'selectSpeedCards':
      app.innerHTML = renderSelectSpeedCards();
      bindSelectSpeedCards();
      break;
    case 'selectSkillCards':
      app.innerHTML = renderSelectSkillCards();
      bindSelectSkillCards();
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
  state.playerCharacter.speedCardBase = generateSpeedCardBase(state.qrText, name);
  state.playerCharacter.skillCardBase = generateSkillCardBase(state.qrText, name);
  state.playerCharacter.wildcardSetOptions = generateWildcardSetOptions(name);
  state.screen = 'characterInfo';
  render();
}

// ---------- キャラクター情報(QR由来)画面・ポップアップ共通 ----------

// キャラクターの基本情報(写真・名前・ステータス・QR由来のスピード/スキルカード)を表示する中身のHTML。
// フル画面表示(renderCharacterInfo)とポップアップ(showCharacterInfoPopup)の両方で使い回す。
function buildCharacterInfoBody(char) {
  const avatar = char.image
    ? `<img class="char-avatar" src="${char.image}" alt="${escapeHtml(char.name)}" />`
    : `<div class="char-avatar">🧑</div>`;
  return `
    <div style="display:flex; justify-content:center;">${avatar}</div>
    <div class="char-name" style="text-align:center; margin-top:8px; font-size:18px;">${escapeHtml(char.name)}</div>
    <div class="stat-row" style="justify-content:center; gap:16px; margin-top:4px;"><span>HP ${char.maxHp}</span><span>攻撃力 ${char.baseAtk}</span></div>
    ${char.commandTable ? `
      <div class="section-label">コマンド表(長押しで説明)</div>
      ${renderCommandTable(char.commandTable)}
    ` : ''}
    <div class="section-label">スピードカード(10枚)</div>
    <div class="act-card-grid">${char.speedCardBase.map((c) => renderSpeedCardFace(c, true)).join('')}</div>
    <div class="section-label">スキルカード(6枚・長押しで説明)</div>
    <div class="act-card-grid">${char.skillCardBase.map((c) => renderSkillCardFace(c, true)).join('')}</div>
  `;
}

function showCharacterInfoPopup(char) {
  showPopup(`${char.name}の情報`, buildCharacterInfoBody(char));
  const popupBody = document.getElementById('popupBody');
  bindSkillCardPopupsIn(popupBody, char.skillCardBase);
  if (char.commandTable) bindCommandTablePopups(popupBody);
}

// 選択画面の上部に「今のキャラ情報」ボタンを設置し、ポップアップで確認できるようにする
function bindCharacterInfoButton() {
  const btn = document.getElementById('charInfoBtn');
  if (btn) btn.onclick = () => showCharacterInfoPopup(state.playerCharacter);
}

function renderCharacterInfo() {
  const char = state.playerCharacter;
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← もどる</button>
        <div></div>
      </div>
      <div class="title" style="font-size:20px;">キャラクター情報</div>
      <div class="subtitle">QRコードから生成された、あなたのキャラクターの基本情報です</div>
      ${buildCharacterInfoBody(char)}
      <div class="spacer"></div>
      <button class="btn block" id="nextBtn">つぎへ</button>
    </div>
  `;
}

function bindCharacterInfo() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'enterName';
    render();
  };
  document.getElementById('nextBtn').onclick = () => {
    state.screen = 'selectCommandTable';
    render();
  };
  bindSkillCardPopupsIn(document, state.playerCharacter.skillCardBase);
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
        <button class="icon-btn" id="charInfoBtn">🪪 キャラ情報</button>
      </div>
      <div class="title" style="font-size:20px;">コマンド表を選ぶ</div>
      <div class="subtitle">3つの候補から、バトルで使うコマンド表を1つ選んでください(コマンドを長押しすると説明が見られます)</div>
      ${optionsHtml}
    </div>
  `;
}

function bindSelectCommandTable() {
  document.getElementById('backBtn').onclick = () => {
    if (state.editingFromReady) {
      state.editingFromReady = false;
      state.screen = 'ready';
    } else {
      state.screen = 'characterInfo';
    }
    render();
  };
  document.querySelectorAll('[data-option-index]').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.optionIndex);
      state.playerCharacter.commandTable = state.playerCharacter.commandTableOptions[idx];
      if (state.editingFromReady) {
        // Readyからの変更はコマンド表だけ差し替えて戻る(カードの選び直しは不要)
        state.editingFromReady = false;
        state.screen = 'ready';
      } else {
        state.screen = 'selectWildcardSet';
      }
      render();
    };
  });
  bindCommandTablePopups();
  bindCharacterInfoButton();
}

// ---------- ワイルドカードセット選択画面 ----------

function renderSelectWildcardSet() {
  const options = state.playerCharacter.wildcardSetOptions;
  const optionsHtml = options
    .map((set, i) => `
      <div class="table-option">
        <div class="section-label">セット ${i + 1}</div>
        <div class="act-card-grid">
          ${set.speedWilds.map((c) => renderSpeedCardFace(c, true)).join('')}
          ${set.skillWilds.map((c) => renderSkillCardFace(c, true)).join('')}
        </div>
        <button class="btn secondary block" data-set-index="${i}">これに決める</button>
      </div>
    `)
    .join('');
  return `
    <div class="screen">
      <div class="top-bar">
        <button class="icon-btn" id="backBtn">← もどる</button>
        <button class="icon-btn" id="charInfoBtn">🪪 キャラ情報</button>
      </div>
      <div class="title" style="font-size:20px;">ワイルドカードセットを選ぶ</div>
      <div class="subtitle">完全ランダムな「スピード2枚+スキル3枚」のセットが3つ。1つ選ぶとカード候補に追加されます</div>
      ${optionsHtml}
    </div>
  `;
}

function bindSelectWildcardSet() {
  document.getElementById('backBtn').onclick = () => {
    state.screen = 'selectCommandTable';
    render();
  };
  bindCharacterInfoButton();
  document.querySelectorAll('[data-set-index]').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.setIndex);
      const chosen = state.playerCharacter.wildcardSetOptions[idx];
      state.playerCharacter.speedCardPool = state.playerCharacter.speedCardBase.concat(chosen.speedWilds);
      state.playerCharacter.skillCardPool = state.playerCharacter.skillCardBase.concat(chosen.skillWilds);
      state.speedCardSelection = new Set(state.playerCharacter.speedCardBase.map((c) => c.id));
      state.screen = 'selectSpeedCards';
      render();
    };
  });
  document.querySelectorAll('.act-card').forEach((el) => {
    // このカードグリッドは表示専用(選択操作は無い)なのでスキルカードの長押しのみ有効にする
  });
  bindSkillCardPopupsIn(document, state.playerCharacter.wildcardSetOptions.flatMap((s) => s.skillWilds));
}

// カード配列を渡し、それぞれの id に対応する .act-card 要素へ長押しポップアップを仕込む
function bindSkillCardPopupsIn(root, cards) {
  cards.forEach((card) => {
    const el = root.querySelector(`[data-card-id="${card.id}"]`);
    if (el) bindTapHold(el, { onHold: () => showSkillCardPopup(card) });
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
        <button class="icon-btn" id="charInfoBtn">🪪 キャラ情報</button>
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
    if (state.editingFromReady) {
      state.editingFromReady = false;
      state.screen = 'ready';
    } else {
      state.screen = 'selectWildcardSet';
    }
    render();
  };
  bindCharacterInfoButton();
  document.querySelectorAll('.select-grid .act-card').forEach((btn) => {
    bindTapHold(btn, {
      onTap: () => {
        const id = btn.dataset.cardId;
        const selection = state.speedCardSelection;
        if (selection.has(id)) {
          selection.delete(id);
        } else {
          if (selection.size >= 10) return;
          selection.add(id);
        }
        render();
      },
    });
  });
  document.getElementById('confirmBtn').onclick = () => {
    if (state.speedCardSelection.size !== 10) return;
    state.playerCharacter.speedCards = state.playerCharacter.speedCardPool.filter((c) => state.speedCardSelection.has(c.id));
    if (state.editingFromReady) {
      // Readyからの変更はスピードカードだけ差し替えて戻る(スキルの選び直しは不要)
      state.editingFromReady = false;
      state.screen = 'ready';
    } else {
      state.skillCardSelection = new Set(
        state.playerCharacter.skillCardPool.filter((c) => !c.isWild).map((c) => c.id)
      );
      state.screen = 'selectSkillCards';
    }
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
        <button class="icon-btn" id="charInfoBtn">🪪 キャラ情報</button>
      </div>
      <div class="title" style="font-size:20px;">スキルカードを選ぶ</div>
      <div class="subtitle">9枚(うちWILDの3枚は完全ランダム)の中から、実際に使う6枚を選んでください(長押しで効果説明)</div>
      <div class="selection-count">選択中: ${selection.size} / 6</div>
      <div class="act-card-grid select-grid">${cardsHtml}</div>
      <div class="spacer"></div>
      <button class="btn block" id="confirmBtn" ${selection.size === 6 ? '' : 'disabled'}>これで決定</button>
    </div>
  `;
}

function bindSelectSkillCards() {
  document.getElementById('backBtn').onclick = () => {
    if (state.editingFromReady) {
      state.editingFromReady = false;
      state.screen = 'ready';
    } else {
      state.screen = 'selectSpeedCards';
    }
    render();
  };
  bindCharacterInfoButton();
  const pool = state.playerCharacter.skillCardPool;
  document.querySelectorAll('.select-grid .act-card').forEach((btn) => {
    const card = pool.find((c) => c.id === btn.dataset.cardId);
    bindTapHold(btn, {
      onTap: () => {
        const id = btn.dataset.cardId;
        const selection = state.skillCardSelection;
        if (selection.has(id)) {
          selection.delete(id);
        } else {
          if (selection.size >= 6) return;
          selection.add(id);
        }
        render();
      },
      onHold: card ? () => showSkillCardPopup(card) : undefined,
    });
  });
  document.getElementById('confirmBtn').onclick = () => {
    if (state.skillCardSelection.size !== 6) return;
    state.playerCharacter.skillCards = state.playerCharacter.skillCardPool.filter((c) => state.skillCardSelection.has(c.id));
    if (state.editingFromReady) {
      state.editingFromReady = false;
      state.screen = 'ready';
    } else {
      state.cpuCharacter = generateCpuCharacter();
      state.screen = 'ready';
    }
    render();
  };
}

// ---------- キャラクターカード共通表示 ----------

function renderStatusBadges(char) {
  const badges = [];
  if (char.poisoned) {
    const severe = (char.poisonStacks || 0) >= 2;
    badges.push(severe
      ? '<span class="status-badge poison severe">☠️猛毒</span>'
      : '<span class="status-badge poison">🧪毒</span>');
  }
  const speedBonus = char.permanentSpeedBonus || 0;
  if (speedBonus > 0) badges.push(`<span class="status-badge accel">⚡+${speedBonus}</span>`);
  else if (speedBonus < 0) badges.push(`<span class="status-badge slow">🦵${speedBonus}</span>`);
  if ((char.comboMultiplier || 1) > 1) badges.push(`<span class="status-badge combo">🔗×${char.comboMultiplier.toFixed(1)}</span>`);
  if (char.atk < char.baseAtk) badges.push(`<span class="status-badge weak">🗡️${char.atk - char.baseAtk}</span>`);
  if ((char.voltageBonus || 0) > 0) badges.push(`<span class="status-badge voltage">🔋ボルテージ+${char.voltageBonus}</span>`);
  return badges.join(' ');
}

function renderCharacterCard(char, compact) {
  const avatar = char.image
    ? `<img class="char-avatar" src="${char.image}" alt="${escapeHtml(char.name)}" />`
    : `<div class="char-avatar">${char.name === 'CPU' ? '🤖' : '🧑'}</div>`;
  const hpPct = Math.max(0, Math.round((char.hp / char.maxHp) * 100));
  return `
    <div class="char-card ${compact ? 'compact' : ''}">
      ${avatar}
      <div class="char-info">
        <div class="char-name">${escapeHtml(char.name)} ${renderStatusBadges(char)}</div>
        <div class="stat-row"><span>HP ${char.hp}/${char.maxHp}</span><span>攻撃力 ${char.atk}</span></div>
        <div class="hp-bar-track"><div class="hp-bar-fill ${hpPct <= 30 ? 'low' : ''}" style="width:${hpPct}%"></div></div>
      </div>
    </div>
  `;
}

// 対戦画面用: 左右に並べて表示する縦型カード(写真は大きめ)。poisonHit が true の間、紫のエフェクトを付ける。
// chargeBonus はそのラウンド中だけ「チャージ」で乗っている一時的な攻撃力ボーナス(ラウンド終了で自然に消える)
function renderVsCharacterCard(char, poisonHit, side, chargeBonus) {
  const avatar = char.image
    ? `<img class="char-avatar-lg" src="${char.image}" alt="${escapeHtml(char.name)}" />`
    : `<div class="char-avatar-lg">${char.name === 'CPU' ? '🤖' : '🧑'}</div>`;
  const hpPct = Math.max(0, Math.round((char.hp / char.maxHp) * 100));
  const chargeBadge = chargeBonus > 0 ? `<span class="status-badge charge">🔥チャージ+${chargeBonus}</span>` : '';
  return `
    <div class="vs-char-card ${poisonHit ? 'poison-hit' : ''}" data-char-side="${side}">
      ${avatar}
      <div class="char-name">${escapeHtml(char.name)}</div>
      <div class="badge-row">${renderStatusBadges(char)} ${chargeBadge}</div>
      <div class="stat-row"><span>HP ${char.hp}/${char.maxHp}</span></div>
      <div class="stat-row"><span>攻撃力 ${char.atk}</span></div>
      <div class="hp-bar-track"><div class="hp-bar-fill ${hpPct <= 30 ? 'low' : ''}" style="width:${hpPct}%"></div></div>
    </div>
  `;
}

// vs-char-card に長押しポップアップを仕込む(player/cpu のキャラクターオブジェクトを渡す)
function bindVsCharacterPopups(root, playerChar, cpuChar) {
  const playerEl = root.querySelector('.vs-char-card[data-char-side="player"]');
  const cpuEl = root.querySelector('.vs-char-card[data-char-side="cpu"]');
  if (playerEl) bindCharacterEffectsPopup(playerEl, playerChar);
  if (cpuEl) bindCharacterEffectsPopup(cpuEl, cpuChar);
}

// revealed を渡すと、そのインデックス(出目-1)が含まれていない面は「？」で伏せて表示する。
// activeIndex を渡すと、そのインデックスの面を「発動した」として色反転表示する(ラウンド終了時にクリアされる)
function renderCommandTable(table, revealed, activeIndex) {
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
      const activeCls = activeIndex === i ? ' active' : '';
      return `<div class="command-cell ${cls}${sCls}${activeCls}" data-command="${escapeHtml(cmd)}"><div class="face">出目 ${i + 1}</div><div class="cmd">${cmd}</div></div>`;
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
  return `<div class="act-card speed-card ${small ? 'small' : ''}" data-card-id="${card.id}"><div class="act-card-speed">SPD ${card.speed}</div></div>`;
}

function renderSkillCardFace(card, small) {
  return `<div class="act-card ${small ? 'small' : ''} ${effectClass(card.effectType)}" data-card-id="${card.id}"><div class="act-card-label">${escapeHtml(card.label)}</div></div>`;
}

function renderCardBack(small) {
  return `<div class="act-card ${small ? 'small' : ''} card-back">？</div>`;
}

// ---------- 準備(Ready?)画面 ----------

function renderReady() {
  return `
    <div class="screen">
      <div class="title" style="text-align:center;">Ready?</div>
      <div class="vs-arena">
        ${renderVsCharacterCard(state.playerCharacter, false, 'player')}
        <div class="vs-label">VS</div>
        ${renderVsCharacterCard(state.cpuCharacter, false, 'cpu')}
      </div>
      <div class="ready-section">
        <div class="ready-section-header">
          <div class="section-label">コマンド表(長押しで説明)</div>
          <button class="link-btn" data-edit-target="selectCommandTable">変更する</button>
        </div>
        ${renderCommandTable(state.playerCharacter.commandTable)}
      </div>
      <div class="ready-section">
        <div class="ready-section-header">
          <div class="section-label">スピードカード(10枚)</div>
          <button class="link-btn" data-edit-target="selectSpeedCards">変更する</button>
        </div>
        <div class="act-card-grid">${state.playerCharacter.speedCards.map((c) => renderSpeedCardFace(c, true)).join('')}</div>
      </div>
      <div class="ready-section">
        <div class="ready-section-header">
          <div class="section-label">スキルカード(6枚・長押しで説明)</div>
          <button class="link-btn" data-edit-target="selectSkillCards">変更する</button>
        </div>
        <div class="act-card-grid">${state.playerCharacter.skillCards.map((c) => renderSkillCardFace(c, true)).join('')}</div>
      </div>
      <div class="spacer"></div>
      <button class="btn block" id="fightStartBtn">たたかう！</button>
    </div>
  `;
}

function bindReady() {
  document.querySelectorAll('[data-edit-target]').forEach((btn) => {
    btn.onclick = () => {
      state.editingFromReady = true;
      state.screen = btn.dataset.editTarget;
      render();
    };
  });
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
      playerEffSpeed: null,
      cpuEffSpeed: null,
      diceValue: null,
      message: '',
      round: 1,
      busy: false,
      arenaColor: null,
      awaitingContinue: false,
      awaitingDiceRoll: false,
      cpuRevealed: new Set(), // コマンド表(出目)の公開状況
      cpuSkillRevealed: new Set(), // 相手のスキルカードの公開状況(使ったら公開)
      playerActiveFace: null, // このラウンドで発動したコマンドの面(ラウンド終了時にクリア)
      cpuActiveFace: null,
      attackerSide: null, // このラウンドでサイコロを振る側('player'|'cpu')。そちらのコマンド表を上に表示する
      playerAtkBonus: 0,
      cpuAtkBonus: 0,
      playerGuardMult: null,
      cpuGuardMult: null,
      playerSpeedDelta: 0,
      cpuSpeedDelta: 0,
      playerAccel: false,
      cpuAccel: false,
      playerReverse: false,
      cpuReverse: false,
      playerChoiceFace: null,
      cpuChoiceFace: null,
      commandEffect: null,
      poisonMessages: [],
      poisonHitSides: [],
    };
    state.screen = 'battle';
    render();
  };
  bindCommandTablePopups();
  bindSkillCardPopupsIn(document, state.playerCharacter.skillCards);
  bindVsCharacterPopups(document, state.playerCharacter, state.cpuCharacter);
}

// ---------- バトル画面 ----------

function renderBattle() {
  const b = state.battle;
  const arenaStyle = b.arenaColor ? ` style="background:${b.arenaColor};"` : '';
  return `
    <div class="screen">
      <div class="vs-arena">
        ${renderVsCharacterCard(state.battlePlayer, b.poisonHitSides.includes('player'), 'player', b.playerAtkBonus)}
        <div class="vs-label">VS</div>
        ${renderVsCharacterCard(state.battleCpu, b.poisonHitSides.includes('cpu'), 'cpu', b.cpuAtkBonus)}
      </div>
      <div class="round-label">ラウンド ${b.round}</div>
      <div class="battle-arena"${arenaStyle}>
        ${renderArenaContent(b)}
      </div>
      ${renderBattleControls(b)}
      <button class="btn secondary block" id="peekCpuCardsBtn">相手のカード一覧を見る</button>
      ${renderBattleCommandTables(b)}
      <div class="battle-log">${renderLog(b.log)}</div>
    </div>
  `;
}

// サイコロを振る側(攻撃側)のコマンド表が上に来るように並べる
function renderBattleCommandTables(b) {
  const playerBlock = `
    <div class="section-label">あなたのコマンド表(長押しで説明)</div>
    ${renderCommandTable(state.battlePlayer.commandTable, null, b.playerActiveFace)}
  `;
  const cpuBlock = `
    <div class="section-label">CPUのコマンド表(長押しで説明)</div>
    ${renderCommandTable(state.battleCpu.commandTable, b.cpuRevealed, b.cpuActiveFace)}
  `;
  return b.attackerSide === 'cpu' ? cpuBlock + playerBlock : playerBlock + cpuBlock;
}

// CPUのスピードカード一覧(常に見られる)。捨て札にあるカードは使用済みとしてチェックする
function buildOpponentSpeedCardsPopupBody() {
  const cards = state.battleCpu.speedCards;
  const discardIds = new Set(state.cpuSpeedDeck.discard.map((c) => c.id));
  const cellsHtml = cards
    .map((card) => {
      const used = discardIds.has(card.id);
      return `
        <div class="peek-cell speed-card ${used ? 'discarded' : ''}">
          <div class="act-card-speed">SPD ${card.speed}</div>
          ${used ? '<div class="peek-check">✔ 使用済み</div>' : ''}
        </div>
      `;
    })
    .join('');
  return `<div class="peek-grid">${cellsHtml}</div>`;
}

// CPUのスキルカード一覧。使ったことがあるものだけ公開され、捨て札にあれば使用済みとしてチェックする
function buildOpponentSkillCardsPopupBody() {
  const cards = state.battleCpu.skillCards;
  const discardIds = new Set(state.cpuSkillDeck.discard.map((c) => c.id));
  const revealed = state.battle.cpuSkillRevealed;
  const cellsHtml = cards
    .map((card) => {
      if (!revealed.has(card.id)) {
        return `<div class="peek-cell hidden"><div class="act-card-label">？</div></div>`;
      }
      const used = discardIds.has(card.id);
      return `
        <div class="peek-cell ${effectClass(card.effectType)} ${used ? 'discarded' : ''}">
          <div class="act-card-label">${escapeHtml(card.label)}</div>
          ${used ? '<div class="peek-check">✔ 使用済み</div>' : ''}
        </div>
      `;
    })
    .join('');
  return `<div class="peek-grid">${cellsHtml}</div>`;
}

// スピード・スキル両方のCPUカード一覧をまとめて1つのポップアップで表示する
function buildOpponentCardsPopupBody() {
  return `
    <div class="section-label">スピードカード(常に公開・✔は使用済み)</div>
    ${buildOpponentSpeedCardsPopupBody()}
    <div class="section-label" style="margin-top:12px;">スキルカード(使ったものだけ公開・✔は使用済み)</div>
    ${buildOpponentSkillCardsPopupBody()}
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

// effSpeed が分かっていて元のスピードと違う場合、実効スピードを併記する
function renderRoundCardStack(speedCard, skillCard, effSpeed) {
  const showEff = effSpeed !== null && effSpeed !== undefined && effSpeed !== speedCard.speed;
  return `
    <div class="round-card-stack">
      ${renderSpeedCardFace(speedCard, true)}
      ${showEff ? `<div class="eff-speed-badge">→ 実効SPD ${effSpeed}</div>` : ''}
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
        <div>${renderRoundCardStack(b.playerSpeedCard, b.playerSkillCard, b.playerEffSpeed)}<div class="hand-label">あなた</div></div>
        <div>${renderRoundCardStack(b.cpuSpeedCard, b.cpuSkillCard, b.cpuEffSpeed)}<div class="hand-label">CPU</div></div>
      </div>
    `;
  } else if (b.playerSpeedCard) {
    html += `
      <div class="hands-row">
        <div>${renderRoundCardStack(b.playerSpeedCard, b.playerSkillCard, b.playerEffSpeed)}<div class="hand-label">あなた</div></div>
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
    <div class="section-label">スキルカード(任意・タップで選択/解除・長押しで説明)</div>
    <div class="card-hand-row skill-pick">${skillHtml}</div>
    <div class="deck-count">スピード 山札${state.playerSpeedDeck.deck.length}・捨て札${state.playerSpeedDeck.discard.length} ｜ スキル 山札${state.playerSkillDeck.deck.length}・捨て札${state.playerSkillDeck.discard.length}</div>
    <button class="btn block" id="playCardsBtn" ${b.selectedSpeedCardId ? '' : 'disabled'}>カードを出す</button>
  `;
}

function renderLog(log) {
  return log.map((msg) => `<div>${escapeHtml(msg)}</div>`).join('');
}

function initBattle() {
  const speedHand = state.playerSpeedDeck.hand;
  document.querySelectorAll('.speed-pick .act-card').forEach((btn) => {
    bindTapHold(btn, {
      onTap: () => {
        if (state.battle.busy) return;
        state.battle.selectedSpeedCardId = btn.dataset.speedCardId;
        render();
      },
    });
  });
  const skillHand = state.playerSkillDeck.hand;
  document.querySelectorAll('.skill-pick .act-card').forEach((btn) => {
    const card = skillHand.find((c) => c.id === btn.dataset.skillCardId);
    bindTapHold(btn, {
      onTap: () => {
        if (state.battle.busy) return;
        const id = btn.dataset.skillCardId;
        state.battle.selectedSkillCardId = state.battle.selectedSkillCardId === id ? null : id;
        render();
      },
      onHold: card ? () => showSkillCardPopup(card) : undefined,
    });
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
  const peekCpuCardsBtn = document.getElementById('peekCpuCardsBtn');
  if (peekCpuCardsBtn) {
    peekCpuCardsBtn.onclick = () => showPopup('CPUのカード一覧', buildOpponentCardsPopupBody());
  }
  bindCommandTablePopups();
  bindVsCharacterPopups(document, state.battlePlayer, state.battleCpu);
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
      if (side === 'player') b.playerAtkBonus = skillCard.n;
      else b.cpuAtkBonus = skillCard.n;
      addLog(`${label}: 「${skillCard.label}」発動！ 攻撃力+${skillCard.n}`);
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
      if (side === 'player') b.playerSpeedDelta = skillCard.n;
      else b.cpuSpeedDelta = skillCard.n;
      addLog(`${label}: 「${skillCard.label}」発動！ スピード+${skillCard.n}`);
      break;
    }
    case EFFECT_TYPES.REVERSE: {
      if (side === 'player') b.playerReverse = true;
      else b.cpuReverse = true;
      addLog(`${label}: 「騙し討ち」発動！ このラウンドはスピードが低い方の勝ち`);
      break;
    }
    case EFFECT_TYPES.CHOICE: {
      if (side === 'player') b.playerChoiceFace = skillCard.n;
      else b.cpuChoiceFace = skillCard.n;
      addLog(`${label}: 「${skillCard.label}」発動！ スピード勝負に勝てばサイコロを振らず出目${skillCard.n}を使用`);
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
  b.playerEffSpeed = null;
  b.cpuEffSpeed = null;

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
    b.cpuSkillRevealed.add(cpuSkillCard.id);
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
  b.playerReverse = false;
  b.cpuReverse = false;
  b.playerChoiceFace = null;
  b.cpuChoiceFace = null;

  applySkillCardEffect(playerSkillCard, 'player');
  applySkillCardEffect(cpuSkillCard, 'cpu');

  const playerEffSpeed = b.playerAccel
    ? 0
    : playerSpeedCard.speed + (state.battlePlayer.permanentSpeedBonus || 0) + b.playerSpeedDelta;
  const cpuEffSpeed = b.cpuAccel
    ? 0
    : cpuSpeedCard.speed + (state.battleCpu.permanentSpeedBonus || 0) + b.cpuSpeedDelta;
  b.playerEffSpeed = playerEffSpeed;
  b.cpuEffSpeed = cpuEffSpeed;

  if (playerSkillCard || cpuSkillCard) {
    // スキルの効果を加味した実効スピードをカード表示に反映してから見せる
    b.message = 'スキルカードの効果が発動！';
    render();
    await wait(900);
  }

  if (playerEffSpeed === cpuEffSpeed) {
    addLog(`スピード${playerEffSpeed}で同速！ このラウンドはどちらも攻撃できない`);
    b.message = `同速(${playerEffSpeed})…このラウンドは攻撃なし`;
    b.attackerSide = null;
    await resolveRoundEnd(null);
    return;
  }

  // 「騙し討ち」は片方だけが使った場合にスピードの勝敗を逆転させる(両者が使うと相殺され元通り)
  const reversed = !!b.playerReverse !== !!b.cpuReverse;
  const winnerIsPlayer = reversed ? playerEffSpeed < cpuEffSpeed : playerEffSpeed > cpuEffSpeed;
  b.attackerSide = winnerIsPlayer ? 'player' : 'cpu';
  b.arenaColor = winnerIsPlayer ? '#239dda' : '#e60012';
  addLog(`スピード勝負: ${winnerIsPlayer ? 'あなた' : 'CPU'}の勝ち！ (${playerEffSpeed} vs ${cpuEffSpeed})${reversed ? '(騙し討ちで逆転)' : ''}`);
  b.message = winnerIsPlayer ? `スピード勝ち！(${playerEffSpeed} vs ${cpuEffSpeed}) あなたの攻撃！` : `スピード負け…(${playerEffSpeed} vs ${cpuEffSpeed}) CPUの攻撃！`;
  render();
  if (winnerIsPlayer) {
    await wait(700);
  } else {
    // スピードバトルに負けた場合は、結果を確認してから「つぎへ」ボタンで進む
    b.awaitingContinue = true;
    render();
    await waitForContinueClick();
    b.awaitingContinue = false;
  }

  const attacker = winnerIsPlayer ? state.battlePlayer : state.battleCpu;
  const defender = winnerIsPlayer ? state.battleCpu : state.battlePlayer;
  const attackerLabel = winnerIsPlayer ? 'あなた' : 'CPU';
  const choiceFace = winnerIsPlayer ? b.playerChoiceFace : b.cpuChoiceFace;

  let dice;
  if (choiceFace) {
    dice = choiceFace;
    b.diceValue = dice;
    b.message = `${attackerLabel}は「チョイス${choiceFace}」で出目${choiceFace}を使用！`;
    render();
    await wait(700);
  } else {
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
  }

  if (!winnerIsPlayer) {
    b.cpuRevealed.add(dice - 1);
    b.cpuActiveFace = dice - 1;
  } else {
    b.playerActiveFace = dice - 1;
  }

  const command = attacker.commandTable[dice - 1];
  const chargeBonus = winnerIsPlayer ? b.playerAtkBonus : b.cpuAtkBonus;
  const atkBonus = chargeBonus + (attacker.voltageBonus || 0);
  const result = resolveCommand(command, attacker, defender, atkBonus);
  b.commandEffect = { type: command, label: result.label };

  let resultText;
  let hitDefender = false;

  if (result.targetsSelf) {
    // ヒール: 自分の体力を回復する(相手にダメージは無い)。状態異常も同時に治す
    const before = attacker.hp;
    attacker.hp = Math.min(attacker.maxHp, attacker.hp + result.heal);
    const healed = attacker.hp - before;
    resultText = `「${result.label}」！ HPを${healed}回復！`;
    if (result.curesStatus && attacker.poisoned) {
      attacker.poisoned = false;
      attacker.poisonStacks = 0;
      resultText += ' 毒も治った！';
    }
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
      defender.poisonStacks = (defender.poisonStacks || 0) + 1;
      resultText += defender.poisonStacks >= 2 ? ' 相手は猛毒状態になった！' : ' 相手は毒状態になった！';
    }

    if (command === COMMAND_TYPES.COLLAPSE && defender.hp > 0 && defender.hp <= defender.maxHp * 0.2) {
      defender.hp = 0;
      resultText += ' 相手はとどめを刺された！';
    }

    if (command === COMMAND_TYPES.LEG_SWEEP && defender.hp > 0) {
      defender.permanentSpeedBonus = (defender.permanentSpeedBonus || 0) - result.speedPenalty;
      resultText += ` 相手のスピードが永続で-${result.speedPenalty}された！`;
    }

    if (command === COMMAND_TYPES.SWORD_HUNT && defender.hp > 0) {
      defender.atk = Math.max(1, defender.atk - result.atkPenalty);
      resultText += ` 相手の攻撃力が永続で-${result.atkPenalty}された！`;
    }
  }

  addLog(`${attackerLabel}: 出目${dice} → ${resultText}`);
  b.message = resultText;

  await resolveRoundEnd(hitDefender ? defender : null);
}

// 毒状態のキャラクターにダメージを与える(端数切り上げ)。2回以上毒を受けていれば「猛毒」で20%、それ以外は10%。
// 与えたダメージ量を返す(0なら毒なし/対象外)
function tickPoison(character) {
  if (!character.poisoned || character.hp <= 0) return 0;
  const rate = (character.poisonStacks || 0) >= 2 ? 0.2 : 0.1;
  const dmg = Math.ceil(character.hp * rate);
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
    b.message += ` ${combatDefender.name}は倒れた！`;
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

  if (state.battlePlayer.hp <= 0 || state.battleCpu.hp <= 0) {
    const defeated = state.battlePlayer.hp <= 0 ? state.battlePlayer : state.battleCpu;
    b.message = `${defeated.name}は倒れた！`;
    b.awaitingContinue = true;
    render();
    await waitForContinueClick();
    b.awaitingContinue = false;
    endBattle(defeated === state.battleCpu ? 'win' : 'lose');
    return;
  }

  if (b.round % 5 === 0) {
    await runVoltageEvent();
  }

  advanceToNextRound();
}

// 5ラウンドごとに発生する「ボルテージ」。お互いサイコロを振り、出目の数だけ攻撃力が永続上昇する。
// baseAtk(刀狩り等で下がる前の基準値)も同時に引き上げ、永続バフと状態異常由来の増減を区別する。
async function runVoltageEvent() {
  const b = state.battle;
  b.diceValue = null;
  b.commandEffect = null;
  b.arenaColor = '#ffd166';
  b.message = '⚡ボルテージ発生！ サイコロを振って攻撃力が上昇！';
  b.awaitingDiceRoll = true;
  render();
  await waitForContinueClick();
  b.awaitingDiceRoll = false;

  const playerRoll = rollDice();
  state.battlePlayer.voltageBonus = (state.battlePlayer.voltageBonus || 0) + playerRoll;
  b.diceValue = playerRoll;
  b.message = `あなたのボルテージ！ 攻撃力+${playerRoll}`;
  addLog(`⚡ボルテージ: あなたに「ボルテージ+${playerRoll}」が付与された`);
  render();
  await wait(900);

  const cpuRoll = rollDice();
  state.battleCpu.voltageBonus = (state.battleCpu.voltageBonus || 0) + cpuRoll;
  b.diceValue = cpuRoll;
  b.message = `CPUのボルテージ！ 攻撃力+${cpuRoll}`;
  addLog(`⚡ボルテージ: CPUに「ボルテージ+${cpuRoll}」が付与された`);
  render();
  await wait(900);

  b.diceValue = null;
  b.message = '';
  b.arenaColor = null;
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
  b.playerEffSpeed = null;
  b.cpuEffSpeed = null;
  b.diceValue = null;
  b.message = '';
  b.arenaColor = null;
  b.commandEffect = null;
  b.poisonMessages = [];
  b.poisonHitSides = [];
  b.playerActiveFace = null;
  b.cpuActiveFace = null;
  b.attackerSide = null;
  b.playerAtkBonus = 0;
  b.cpuAtkBonus = 0;
  b.busy = false;
  render();
}

// ---------- 結果画面 ----------

function renderResult() {
  const win = state.battleResult === 'win';
  const media = win
    ? `
      <div class="result-photo-wrap">
        <div class="result-crown">👑</div>
        ${state.battlePlayer.image
          ? `<img class="result-photo" src="${state.battlePlayer.image}" alt="${escapeHtml(state.battlePlayer.name)}" />`
          : `<div class="result-photo placeholder">🧑</div>`}
      </div>
    `
    : `<div class="result-emoji">🪦</div>`;
  return `
    <div class="screen result-screen">
      ${media}
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
    state.editingFromReady = false;
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

setupPopup();
render();
