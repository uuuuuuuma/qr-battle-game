// キャラクター生成ロジック
//
// 【QRコード → パラメータ変換の仮ルール】(未確定のため今後調整可)
// 1. QRコードの読み取り文字列をハッシュ化し、疑似乱数シードにする
//    → 同じQRコードからは毎回同じキャラクターが生成される
// 2. シードから以下を決定する
//    - HP        : 70 〜 150
//    - こうげき力 : 8 〜 30
//    - こうげき出現率(35%〜75%): サイコロの目にどれだけ「こうげき」を割り振るか
// 3. サイコロの目(1〜6)それぞれにコマンドを割り当てたコマンド表を3パターン作り、
//    プレイヤーはその中から使用する1つを選ぶ。「クリティカル」「コンボ」「ポイズン」は
//    「Sコマンド」と呼び、各コマンド表に必ず1つ以上入るようにする
// 4. キャラクター生成後、同じQR文字列から「スピードカード」10枚・「スキルカード」6枚を生成する。
//    さらに完全ランダム(QRに依存しない)な「スピードカード2枚+スキルカード3枚」のワイルドセットを
//    3セット用意し、プレイヤーはその中から1セットを選んで自分の候補に追加できる。
//    最終的に(10+2)枚のスピードカードから10枚、(6+3)枚のスキルカードから6枚を選んで使用する。

const COMMAND_TYPES = {
  ATTACK: 'こうげき',
  GUARD_STRIKE: 'みねうち',
  CRITICAL: 'クリティカル',
  MISS: 'ミス',
  COMBO: 'コンボ',
  HEAL: 'ヒール',
  POISON: 'ポイズン',
  COLLAPSE: 'コラプス',
  LEG_SWEEP: '足払い',
  SWORD_HUNT: '刀狩り',
};

// クリティカル・コンボ・ポイズンは「Sコマンド」。各コマンド表に必ず1つ以上含める
const S_COMMANDS = [COMMAND_TYPES.CRITICAL, COMMAND_TYPES.COMBO, COMMAND_TYPES.POISON];

function isSCommand(cmd) {
  return S_COMMANDS.includes(cmd);
}

// スキルカードの効果種別
const EFFECT_TYPES = {
  CHARGE: 'チャージ',
  GUARD: '受け身',
  ACCEL: 'アクセル',
  AGILE: '身軽',
  REVERSE: '騙し討ち',
  CHOICE: 'チョイス',
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// 各面のコマンドを重み付きで選ぶ。attackRate の確率で「こうげき」、
// 残りを「ミス/みねうち/ヒール/コラプス」+「Sコマンド」に振り分ける
function pickCommandForFace(rand, attackRate) {
  if (rand() < attackRate) return COMMAND_TYPES.ATTACK;
  const pool = [
    { cmd: COMMAND_TYPES.MISS, w: 34 },
    { cmd: COMMAND_TYPES.GUARD_STRIKE, w: 14 },
    { cmd: COMMAND_TYPES.HEAL, w: 12 },
    { cmd: COMMAND_TYPES.COLLAPSE, w: 10 },
    { cmd: COMMAND_TYPES.CRITICAL, w: 12 },
    { cmd: COMMAND_TYPES.COMBO, w: 10 },
    { cmd: COMMAND_TYPES.POISON, w: 8 },
    { cmd: COMMAND_TYPES.LEG_SWEEP, w: 10 },
    { cmd: COMMAND_TYPES.SWORD_HUNT, w: 10 },
  ];
  const total = pool.reduce((sum, p) => sum + p.w, 0);
  let r = rand() * total;
  for (const p of pool) {
    if (r < p.w) return p.cmd;
    r -= p.w;
  }
  return COMMAND_TYPES.MISS;
}

function pickRandomSCommand(rand) {
  return S_COMMANDS[Math.floor(rand() * S_COMMANDS.length)];
}

function generateCommandTableVariant(rand, attackRate) {
  const table = [];
  for (let face = 0; face < 6; face++) {
    table.push(pickCommandForFace(rand, attackRate));
  }
  // Sコマンドが1つも無ければ、ランダムな面を強制的にSコマンドにする
  if (!table.some(isSCommand)) {
    const forceIndex = Math.floor(rand() * 6);
    table[forceIndex] = pickRandomSCommand(rand);
  }
  return table;
}

function generateCharacterFromText(text, name, imageDataUrl) {
  const rand = createSeededRandom(text);

  const hp = 70 + Math.floor(rand() * 81); // 70-150
  const atk = 8 + Math.floor(rand() * 23); // 8-30
  const attackRate = 0.35 + rand() * 0.4; // 0.35-0.75

  // コマンド表の候補を3つ用意し、プレイヤー(またはCPU)が1つを選ぶ
  const commandTableOptions = [
    generateCommandTableVariant(rand, attackRate),
    generateCommandTableVariant(rand, attackRate),
    generateCommandTableVariant(rand, attackRate),
  ];

  return {
    name,
    hp,
    maxHp: hp,
    atk,
    baseAtk: atk, // 「刀狩り」で永続的に下がる前の元の攻撃力(バッジ表示用)
    commandTableOptions,
    commandTable: null, // 3択の中から選んだらセットされる
    speedCardBase: [], // QR由来のスピードカード10枚
    skillCardBase: [], // QR由来のスキルカード6枚
    wildcardSetOptions: [], // 完全ランダムな「スピード2枚+スキル3枚」のセット3つ
    speedCardPool: [], // ワイルドセット確定後にできる候補(base+選んだワイルド)
    speedCards: [], // 候補のうちプレイヤーが選んだ10枚
    skillCardPool: [], // ワイルドセット確定後にできる候補(base+選んだワイルド)
    skillCards: [], // 候補のうちプレイヤーが選んだ6枚
    comboMultiplier: 1, // 「コンボ」を使うたびに+0.3され、ゲーム終了まで持続する
    permanentSpeedBonus: 0, // 「アクセル」を使うたびに+1され、ゲーム終了まで持続する
    poisoned: false,
    poisonStacks: 0, // 毒を受けた回数。2以上で「猛毒」(ダメージ率が上がる)になる
    voltageBonus: 0, // 「ボルテージ」で永続加算される攻撃力(状態異常ではないためヒールで解除されない)
    image: imageDataUrl || null,
    sourceText: text,
  };
}

function generateCpuCharacter() {
  const seedText = 'CPU-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
  const cpu = generateCharacterFromText(seedText, 'CPU', null);
  cpu.commandTable = cpu.commandTableOptions[Math.floor(Math.random() * cpu.commandTableOptions.length)];
  cpu.speedCardBase = generateSpeedCardBase(seedText, 'CPU');
  cpu.skillCardBase = generateSkillCardBase(seedText, 'CPU');
  const wildSet = generateWildcardSet('CPU', 0); // CPUは1セットだけ生成してそのまま使う
  cpu.speedCardPool = cpu.speedCardBase.concat(wildSet.speedWilds);
  cpu.skillCardPool = cpu.skillCardBase.concat(wildSet.skillWilds);
  // どのカードが選ばれるかはランダムだが、一覧の表示順はプレイヤー側と同じ並び順に揃える
  const typeOrder = Object.values(EFFECT_TYPES);
  cpu.speedCards = shuffleArray(cpu.speedCardPool).slice(0, 10).sort((a, b) => b.speed - a.speed); // CPUはランダムに10枚選ぶ
  cpu.skillCards = shuffleArray(cpu.skillCardPool).slice(0, 6)
    .sort((a, b) => typeOrder.indexOf(a.effectType) - typeOrder.indexOf(b.effectType)); // CPUはランダムに6枚選ぶ
  return cpu;
}

// ---------- スピードカード生成 ----------
// スピード(1〜10)のみを持つカードを10枚生成する(QR由来の疑似乱数)。
// 少なくとも3枚はスピード7〜10、少なくとも3枚はスピード1〜3になるようにする。

function generateSpeedCardBase(text, name) {
  const rand = createSeededRandom(text + '::speed::' + name);

  const speeds = [];
  for (let i = 0; i < 10; i++) {
    speeds.push(1 + Math.floor(rand() * 10));
  }

  // インデックスをシード乱数でシャッフルし、先頭3枚を低速(1-3)・次の3枚を高速(7-10)に
  // 上書きする。こうすることで両方の枚数保証(残り4枚は完全ランダム)を必ず両立できる。
  const order = [...Array(10).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let k = 0; k < 3; k++) {
    speeds[order[k]] = 1 + Math.floor(rand() * 3); // 1-3
  }
  for (let k = 3; k < 6; k++) {
    speeds[order[k]] = 7 + Math.floor(rand() * 4); // 7-10
  }

  return speeds
    .map((speed, i) => ({
      id: `${name}-speed-${i}-${speed}`,
      speed,
      isWild: false,
    }))
    .sort((a, b) => b.speed - a.speed); // 数値が大きい順に並べる
}

// ---------- スキルカード生成 ----------
// 追加効果(チャージ/受け身/アクセル/身軽)を持つカードを6枚生成する(QR由来の疑似乱数)。

function generateSkillCardBase(text, name) {
  const rand = createSeededRandom(text + '::skill::' + name);

  const baseCards = [];
  for (let i = 0; i < 6; i++) {
    const effectType = pickSkillEffectType(rand);
    const n = rollSkillN(rand, effectType);
    baseCards.push({
      id: `${name}-skill-${i}-${effectType}-${n}`,
      effectType,
      n,
      label: formatSkillLabel(effectType, n),
      isWild: false,
    });
  }
  // 種類順(EFFECT_TYPESの定義順)に並べる
  const typeOrder = Object.values(EFFECT_TYPES);
  baseCards.sort((a, b) => typeOrder.indexOf(a.effectType) - typeOrder.indexOf(b.effectType));
  return baseCards; // 6枚
}

// スキルカードの効果種別を重み付きで選ぶ。「アクセル」「騙し討ち」は他の半分程度の出現率にする
function pickSkillEffectType(randFn) {
  const pool = [
    { type: EFFECT_TYPES.CHARGE, w: 2 },
    { type: EFFECT_TYPES.GUARD, w: 2 },
    { type: EFFECT_TYPES.AGILE, w: 2 },
    { type: EFFECT_TYPES.REVERSE, w: 1 },
    { type: EFFECT_TYPES.CHOICE, w: 2 },
    { type: EFFECT_TYPES.ACCEL, w: 1 },
  ];
  const total = pool.reduce((sum, p) => sum + p.w, 0);
  let r = randFn() * total;
  for (const p of pool) {
    if (r < p.w) return p.type;
    r -= p.w;
  }
  return pool[0].type;
}

// ---------- ワイルドカードセット生成 ----------
// 完全ランダム(QRに依存しないMath.random)な「スピードカード2枚+スキルカード3枚」の
// セットを作る。プレイヤーには3セット提示し、1つだけ選んでもらう。

function generateWildcardSet(name, setIndex) {
  const speedWilds = [0, 1].map((i) => {
    const speed = 1 + Math.floor(Math.random() * 10);
    return { id: `${name}-wildset${setIndex}-speed-${i}-${speed}`, speed, isWild: true };
  });

  const skillWilds = [0, 1, 2].map((i) => {
    const effectType = pickSkillEffectType(Math.random);
    const n = rollSkillN(Math.random, effectType);
    return {
      id: `${name}-wildset${setIndex}-skill-${i}-${effectType}-${n}`,
      effectType,
      n,
      label: formatSkillLabel(effectType, n),
      isWild: true,
    };
  });

  return { speedWilds, skillWilds };
}

function generateWildcardSetOptions(name) {
  return [0, 1, 2].map((i) => generateWildcardSet(name, i));
}

// randFn は 0以上1未満を返す関数(QR由来のrand、またはMath.random)
function rollSkillN(randFn, effectType) {
  switch (effectType) {
    case EFFECT_TYPES.CHARGE:
      return 5 + Math.floor(randFn() * 6); // 5-10
    case EFFECT_TYPES.GUARD: {
      const step = 2 + Math.floor(randFn() * 4); // 2,3,4,5
      return step / 10; // 0.2〜0.5倍
    }
    case EFFECT_TYPES.AGILE:
      return 1 + Math.floor(randFn() * 3); // 1-3
    case EFFECT_TYPES.CHOICE:
      return 1 + Math.floor(randFn() * 6); // 出目1〜6
    case EFFECT_TYPES.ACCEL:
    case EFFECT_TYPES.REVERSE:
    default:
      return null; // アクセル・騙し討ちは固定効果でnを使わない
  }
}

function formatSkillLabel(effectType, n) {
  switch (effectType) {
    case EFFECT_TYPES.CHARGE:
      return `チャージ+${n}`;
    case EFFECT_TYPES.GUARD:
      return `受け身${n}倍`;
    case EFFECT_TYPES.ACCEL:
      return 'アクセル';
    case EFFECT_TYPES.AGILE:
      return `身軽+${n}`;
    case EFFECT_TYPES.REVERSE:
      return '騙し討ち';
    case EFFECT_TYPES.CHOICE:
      return `チョイス${n}`;
    default:
      return '';
  }
}
