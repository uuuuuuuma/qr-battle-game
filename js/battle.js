// バトルロジック: じゃんけん・サイコロ・コマンド解決

const HANDS = ['グー', 'チョキ', 'パー'];
const HAND_EMOJI = { 'グー': '✊', 'チョキ': '✌️', 'パー': '✋' };

function randomHand() {
  return HANDS[Math.floor(Math.random() * HANDS.length)];
}

// 'player' | 'cpu' | 'draw' を返す
function judgeJanken(playerHand, cpuHand) {
  if (playerHand === cpuHand) return 'draw';
  const beats = { 'グー': 'チョキ', 'チョキ': 'パー', 'パー': 'グー' };
  return beats[playerHand] === cpuHand ? 'player' : 'cpu';
}

function rollDice() {
  return 1 + Math.floor(Math.random() * 6);
}

// コマンド実行結果 { damage, message } を返す
function resolveCommand(command, atk) {
  switch (command) {
    case COMMAND_TYPES.ATTACK: {
      const damage = Math.round(atk * 1.0);
      return { damage, message: `「こうげき」！ ${damage} のダメージ！` };
    }
    case COMMAND_TYPES.GUARD_STRIKE: {
      const damage = Math.round(atk * 0.5);
      return { damage, message: `「みねうち」！ ${damage} のダメージ！` };
    }
    case COMMAND_TYPES.CRITICAL: {
      const damage = Math.round(atk * 2);
      return { damage, message: `「クリティカル」！ ${damage} の大ダメージ！！` };
    }
    case COMMAND_TYPES.MISS:
    default:
      return { damage: 0, message: '「ミス」…このラウンドは何も起こらなかった' };
  }
}
