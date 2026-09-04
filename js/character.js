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
//    「こうげき」または「ミス」を割り当て、コマンド表を作る
//
// 「みねうち」「クリティカル」はバトルエンジン側では既に対応済み。
// QR変換ルールを拡張すればコマンド表に混ぜられるようにしてある。

const COMMAND_TYPES = {
  ATTACK: 'こうげき',
  GUARD_STRIKE: 'みねうち',
  CRITICAL: 'クリティカル',
  MISS: 'ミス',
};

function generateCharacterFromText(text, name, imageDataUrl) {
  const rand = createSeededRandom(text);

  const hp = 70 + Math.floor(rand() * 81); // 70-150
  const atk = 8 + Math.floor(rand() * 23); // 8-30
  const attackRate = 0.35 + rand() * 0.4; // 0.35-0.75

  const commandTable = [];
  for (let face = 0; face < 6; face++) {
    commandTable.push(rand() < attackRate ? COMMAND_TYPES.ATTACK : COMMAND_TYPES.MISS);
  }

  return {
    name,
    hp,
    maxHp: hp,
    atk,
    commandTable, // index 0 = 出目1, index 5 = 出目6
    image: imageDataUrl || null,
    sourceText: text,
  };
}

function generateCpuCharacter() {
  const seedText = 'CPU-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
  return generateCharacterFromText(seedText, 'CPU', null);
}
