// キャラクター生成ロジック
//
// 【QRコード → パラメータ変換の仮ルール】(未確定のため今後調整可)
// 1. QRコードの読み取り文字列をハッシュ化し、疑似乱数シードにする
//    → 同じQRコードからは毎回同じキャラクターが生成される
// 2. シードから以下を決定する
//    - HP        : 70 〜 150
//    - こうげき力 : 8 〜 30
//    - こうげき出現率(35%〜75%): サイコロの目にどれだけ「こうげき」を割り振るか
// 3. サイコロの目(1〜6)それぞれに「こうげき」出現率に従って
//    「こうげき」または「ミス」を割り当てたコマンド表を3パターン作り、
//    プレイヤーはその中から使用する1つを選ぶ
// 4. キャラクター生成後、同じQR文字列から10枚のアクトカードを生成する
//
// 「みねうち」「クリティカル」はバトルエンジン側では既に対応済み。
// QR変換ルールを拡張すればコマンド表に混ぜられるようにしてある。

const COMMAND_TYPES = {
  ATTACK: 'こうげき',
  GUARD_STRIKE: 'みねうち',
  CRITICAL: 'クリティカル',
  MISS: 'ミス',
};

const EFFECT_TYPES = {
  BUFF: 'バフ',
  GUARD: '受け身',
  FOCUS: '集中',
  CHOICE: 'チョイス',
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function generateCommandTableVariant(rand, attackRate) {
  const table = [];
  for (let face = 0; face < 6; face++) {
    table.push(rand() < attackRate ? COMMAND_TYPES.ATTACK : COMMAND_TYPES.MISS);
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

  return speeds.map((speed, i) => {
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
}

// スピードが低いカードほど「バフ」は強く、「受け身」は硬くなる(遅さを補うため)
function rollEffectN(rand, speed, effectType) {
  const slowness = (10 - speed) / 9; // 0(最速) 〜 1(最遅)
  switch (effectType) {
    case EFFECT_TYPES.BUFF: {
      const base = 5 + slowness * 15; // 5〜20、遅いほど大きい
      return clamp(Math.round(base + (rand() - 0.5) * 4), 5, 20);
    }
    case EFFECT_TYPES.GUARD: {
      const base = 1 + (1 - slowness) * 7; // 1〜8、遅いほど小さい(=ダメージ倍率が低く防御が固い)
      return clamp(Math.round(base + (rand() - 0.5) * 2), 1, 8);
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
      return `受け身+${n}`;
    case EFFECT_TYPES.FOCUS:
      return `集中${n}`;
    case EFFECT_TYPES.CHOICE:
      return `チョイス${n}`;
    default:
      return '';
  }
}
