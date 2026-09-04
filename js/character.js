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
// 4. キャラクター生成後、同じQR文字列から10枚のアクトカードを生成する。
//    さらにそのうち3枚は完全ランダム(QRに依存しない)なカードに差し替える

const COMMAND_TYPES = {
  ATTACK: 'こうげき',
  GUARD_STRIKE: 'みねうち',
  CRITICAL: 'クリティカル',
  MISS: 'ミス',
  COMBO: 'コンボ',
  HEAL: 'ヒール',
  POISON: 'ポイズン',
  COLLAPSE: 'コラプス',
};

// クリティカル・コンボ・ポイズンは「Sコマンド」。各コマンド表に必ず1つ以上含める
const S_COMMANDS = [COMMAND_TYPES.CRITICAL, COMMAND_TYPES.COMBO, COMMAND_TYPES.POISON];

function isSCommand(cmd) {
  return S_COMMANDS.includes(cmd);
}

const EFFECT_TYPES = {
  BUFF: 'バフ',
  GUARD: '受け身',
  FOCUS: '集中',
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
    commandTableOptions,
    commandTable: null, // 3択の中から選んだらセットされる
    actCards: [],
    focusOverrides: {},
    comboMultiplier: 1, // 「コンボ」を使うたびに+0.3され、ゲーム終了まで持続する
    poisoned: false,
    image: imageDataUrl || null,
    sourceText: text,
  };
}

function generateCpuCharacter() {
  const seedText = 'CPU-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
  const cpu = generateCharacterFromText(seedText, 'CPU', null);
  cpu.commandTable = cpu.commandTableOptions[Math.floor(Math.random() * cpu.commandTableOptions.length)];
  cpu.actCards = generateActCards(seedText, 'CPU');
  return cpu;
}

// ---------- アクトカード生成 ----------
// スピード(1〜10)と追加効果を持つカードを10枚生成する。
// 少なくとも3枚はスピード7〜10になるようにする。
// さらに、10枚とは別に完全ランダム(QRに依存しないMath.random)なカードを3枚作り、
// そのうち3枚のスロットと差し替える(毎回結果が変わる)

function generateActCards(text, name) {
  const rand = createSeededRandom(text + '::cards::' + name);

  const speeds = [];
  for (let i = 0; i < 10; i++) {
    speeds.push(1 + Math.floor(rand() * 10));
  }
  let highCount = speeds.filter((s) => s >= 7).length;
  for (let i = 0; i < speeds.length && highCount < 3; i++) {
    if (speeds[i] < 7) {
      speeds[i] = 7 + Math.floor(rand() * 4); // 7-10
      highCount++;
    }
  }

  const effectPool = [EFFECT_TYPES.BUFF, EFFECT_TYPES.GUARD, EFFECT_TYPES.FOCUS, EFFECT_TYPES.CHOICE];

  const cards = speeds.map((speed, i) => {
    const effectType = effectPool[Math.floor(rand() * effectPool.length)];
    const n = rollEffectN(rand, speed, effectType);
    return {
      id: `${name}-card-${i}-${speed}-${effectType}-${n}`,
      speed,
      effectType,
      n,
      label: formatEffectLabel(effectType, n),
    };
  });

  // 完全ランダムなカードを3枚生成し、ランダムな3スロットと差し替える
  const wildSlots = shuffleArray([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3);
  wildSlots.forEach((slot, i) => {
    cards[slot] = generateRandomActCard(name, slot, i);
  });

  return cards;
}

// スピードに関係なく完全ランダムに効果値を決める(Math.random。QRに依存しない)
function generateRandomActCard(name, slot, wildIndex) {
  const speed = 1 + Math.floor(Math.random() * 10);
  const effectPool = [EFFECT_TYPES.BUFF, EFFECT_TYPES.GUARD, EFFECT_TYPES.FOCUS, EFFECT_TYPES.CHOICE];
  const effectType = effectPool[Math.floor(Math.random() * effectPool.length)];
  const n = rollRandomEffectN(effectType);
  return {
    id: `${name}-wild-${slot}-${wildIndex}-${speed}-${effectType}-${n}`,
    speed,
    effectType,
    n,
    label: formatEffectLabel(effectType, n),
  };
}

function rollRandomEffectN(effectType) {
  switch (effectType) {
    case EFFECT_TYPES.BUFF:
      return 5 + Math.floor(Math.random() * 6); // 5-10
    case EFFECT_TYPES.GUARD:
      return (1 + Math.floor(Math.random() * 8)) / 10; // 0.1-0.8
    case EFFECT_TYPES.FOCUS:
      return 1 + Math.floor(Math.random() * 6);
    case EFFECT_TYPES.CHOICE:
      return 1 + Math.floor(Math.random() * 6);
    default:
      return 0;
  }
}

// スピードが低いカードほど「バフ」は強く、「受け身」は硬くなる(遅さを補うため)
function rollEffectN(rand, speed, effectType) {
  const slowness = (10 - speed) / 9; // 0(最速) 〜 1(最遅)
  switch (effectType) {
    case EFFECT_TYPES.BUFF: {
      const base = 5 + slowness * 5; // 5〜10、遅いほど大きい
      return clamp(Math.round(base + (rand() - 0.5) * 2), 5, 10);
    }
    case EFFECT_TYPES.GUARD: {
      const stepBase = 1 + (1 - slowness) * 7; // 1〜8相当、遅いほど小さい(=ダメージ倍率が低く防御が固い)
      const step = clamp(Math.round(stepBase + (rand() - 0.5) * 2), 1, 8);
      return step / 10; // 0.1〜0.8倍
    }
    case EFFECT_TYPES.FOCUS:
      return 1 + Math.floor(rand() * 6); // 出目1〜6
    case EFFECT_TYPES.CHOICE:
      return 1 + Math.floor(rand() * 6); // 出目1〜6
    default:
      return 0;
  }
}

function formatEffectLabel(effectType, n) {
  switch (effectType) {
    case EFFECT_TYPES.BUFF:
      return `バフ+${n}`;
    case EFFECT_TYPES.GUARD:
      return `受け身${n}倍`;
    case EFFECT_TYPES.FOCUS:
      return `集中${n}`;
    case EFFECT_TYPES.CHOICE:
      return `チョイス${n}`;
    default:
      return '';
  }
}
