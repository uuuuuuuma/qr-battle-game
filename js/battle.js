// バトルロジック: アクトカードのスピード比較・サイコロ・コマンド解決・山札管理

function rollDice() {
  return 1 + Math.floor(Math.random() * 6);
}

// コマンドを実行する。attacker/defender は battlePlayer/battleCpu のキャラクターオブジェクトそのもの。
// COMBO はキャラクターの comboMultiplier を直接書き換える(永続・重ねがけ可能)。
// 戻り値: { targetsSelf, damage, heal, label, poison, collapseCheck, comboMultBefore }
function resolveCommand(command, attacker, defender, atkBonus) {
  const effAtk = attacker.atk + (atkBonus || 0);
  switch (command) {
    case COMMAND_TYPES.ATTACK:
      return { targetsSelf: false, damage: Math.round(effAtk * 1.0), label: 'こうげき' };
    case COMMAND_TYPES.GUARD_STRIKE:
      return { targetsSelf: false, damage: Math.round(effAtk * 0.5), label: 'みねうち' };
    case COMMAND_TYPES.CRITICAL:
      return { targetsSelf: false, damage: Math.round(effAtk * 2), label: 'クリティカル' };
    case COMMAND_TYPES.COMBO: {
      const multBefore = attacker.comboMultiplier;
      const damage = Math.round(effAtk * multBefore);
      attacker.comboMultiplier = Math.round((multBefore + 0.3) * 10) / 10;
      return { targetsSelf: false, damage, label: 'コンボ', comboMultBefore: multBefore };
    }
    case COMMAND_TYPES.HEAL: {
      const heal = Math.round(effAtk * 0.5);
      return { targetsSelf: true, heal, label: 'ヒール', curesStatus: true };
    }
    case COMMAND_TYPES.POISON: {
      const damage = Math.round(effAtk * 0.5);
      const poison = Math.random() < 0.5;
      return { targetsSelf: false, damage, label: 'ポイズン', poison };
    }
    case COMMAND_TYPES.COLLAPSE: {
      const damage = Math.round(defender.maxHp * 0.1);
      return { targetsSelf: false, damage, label: 'コラプス', collapseCheck: true };
    }
    case COMMAND_TYPES.LEG_SWEEP: {
      const damage = Math.round(effAtk * 0.5);
      return { targetsSelf: false, damage, label: '足払い', speedPenalty: 0.5 };
    }
    case COMMAND_TYPES.SWORD_HUNT: {
      const damage = Math.round(effAtk * 0.5);
      return { targetsSelf: false, damage, label: '刀狩り', atkPenalty: 2 };
    }
    case COMMAND_TYPES.MISS:
    default:
      return { targetsSelf: false, damage: 0, label: 'ミス' };
  }
}

// ---------- アクトカードの山札・手札・捨て札管理 ----------

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
