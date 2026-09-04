// バトルロジック: アクトカードのスピード比較・サイコロ・コマンド解決・山札管理

function rollDice() {
  return 1 + Math.floor(Math.random() * 6);
}

// コマンド実行結果 { damage, label } を返す (label はダメージ表示に使う技名)
function resolveCommand(command, atk) {
  switch (command) {
    case COMMAND_TYPES.ATTACK: {
      const damage = Math.round(atk * 1.0);
      return { damage, label: 'こうげき' };
    }
    case COMMAND_TYPES.GUARD_STRIKE: {
      const damage = Math.round(atk * 0.5);
      return { damage, label: 'みねうち' };
    }
    case COMMAND_TYPES.CRITICAL: {
      const damage = Math.round(atk * 2);
      return { damage, label: 'クリティカル' };
    }
    case COMMAND_TYPES.MISS:
    default:
      return { damage: 0, label: 'ミス' };
  }
}

// ---------- アクトカードの山札・手札・捨て札管理 ----------

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 10枚のカードから山札を作り、手札3枚を配る
function createDeckState(cards) {
  const deck = shuffleArray(cards);
  const hand = deck.splice(0, 3);
  return { deck, hand, discard: [] };
}

// 山札が尽きたら捨て札をシャッフルして山札に戻す
function drawCard(deckState) {
  if (deckState.deck.length === 0) {
    if (deckState.discard.length === 0) return null;
    deckState.deck = shuffleArray(deckState.discard);
    deckState.discard = [];
  }
  return deckState.deck.shift();
}

// 手札からカードを1枚出す(捨て札行き)。出したカードを返す
function playCard(deckState, cardId) {
  const idx = deckState.hand.findIndex((c) => c.id === cardId);
  if (idx === -1) return null;
  const [card] = deckState.hand.splice(idx, 1);
  deckState.discard.push(card);
  return card;
}

// 手札が3枚になるまで山札から補充する
function refillHand(deckState) {
  while (deckState.hand.length < 3) {
    const card = drawCard(deckState);
    if (!card) break;
    deckState.hand.push(card);
  }
}

function pickCpuCard(deckState) {
  if (deckState.hand.length === 0) return null;
  return deckState.hand[Math.floor(Math.random() * deckState.hand.length)];
}
