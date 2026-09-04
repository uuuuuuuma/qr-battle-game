// QR文字列から決定論的な乱数シードを作るユーティリティ
// 同じQRコードなら常に同じキャラクターが生成される

function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

// mulberry32: シード値から0以上1未満の疑似乱数列を返す軽量PRNG
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeededRandom(text) {
  const seed = djb2Hash(text);
  return mulberry32(seed);
}
