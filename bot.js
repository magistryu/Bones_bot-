require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const crypto = require('crypto');

const token = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

const bot = new TelegramBot(token, { 
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

bot.on('polling_error', (err) => {
  console.log('⚠️ Ошибка polling:', err.message);
  if (err.message.includes('ECONNRESET') || err.message.includes('ETIMEDOUT')) {
    console.log('🔄 Переподключение через 30 секунд...');
    setTimeout(() => {
      bot.startPolling();
    }, 30000);
  }
  if (err.message.includes('409 Conflict')) {
    console.log('🔄 Конфликт 409 игнорируется. Бот продолжает работу.');
  }
});

const PLAYERS_FILE = 'players.json';
const BANK_FILE = 'bank.json';
const QUEUE_FILE = 'withdraw_queue.json';
const HASH_FILE = 'players.hash';
const JACKPOT_FILE = 'jackpot_counter.json';
const MAX_PLAYERS = 1000;
const MIN_BANK = 2000;
const MIN_SUNDUK_BANK = 500;
const COMMISSION_PERCENT = 0.25;
const DUEL_TIMEOUT = 300000;
const MAX_WIN_MULTIPLIER = 5;
const MAX_HISTORY = 10;
const MAX_WITHDRAW_PERCENT = 0.1;
const MAX_WITHDRAW_DAILY = 1000;
const MIN_WITHDRAW = 50;
const MIN_VIP_BET = 500;
const MAX_VIP_BET = 5000;
const MIN_DUEL_MONEY = 100;
const MAX_DUEL_MONEY = 10000;

// ==================== БЛЭКДЖЕК ====================
const BLACKJACK_CONFIG = {
  decks: 6,
  maxBet: 10000,
  minBet: 10
};

// ==================== ЛИМИТ СТАВОК ====================
const MAX_LIMIT_UPGRADES = 50;
const LIMIT_UPGRADE_COST = 5000;
const MAX_CLASSIC_BET = 10000;

// ==================== ТРОФЕИ / ДОСТИЖЕНИЯ ====================
const ACHIEVEMENTS = [
  { id: 1, name: '🎯 Первый шаг', desc: 'Сыграть первую игру', cost: 100, bonus: 1 },
  { id: 2, name: '💪 Серия 5', desc: 'Выиграть 5 игр подряд', cost: 500, bonus: 3 },
  { id: 3, name: '🔥 Серия 10', desc: 'Выиграть 10 игр подряд', cost: 2000, bonus: 5 },
  { id: 4, name: '👑 Победитель', desc: 'Выиграть 100 игр', cost: 5000, bonus: 10 },
  { id: 5, name: '💰 Миллионер', desc: 'Накопить 1 000 000 дуб.', cost: 10000, bonus: 20 },
  { id: 6, name: '⚔️ Дуэлянт', desc: 'Выиграть 50 дуэлей', cost: 3000, bonus: 8 },
  { id: 7, name: '🏴‍☠️ Пират', desc: 'Купить 10 кораблей', cost: 5000, bonus: 10 },
  { id: 8, name: '🌊 Легенда', desc: 'Открыть 100 сундуков', cost: 15000, bonus: 25 },
  { id: 9, name: '🎴 Картёжник', desc: 'Выиграть 50 игр в блэкджек', cost: 8000, bonus: 15 },
  { id: 10, name: '👑 Император', desc: 'Получить все достижения', cost: 50000, bonus: 50 },
];

const SUNDUK_LEVELS = [
  { id: 1, name: '🟢 Низкий', risk: 10, minCost: 50, maxCost: 200, winChance: 70, minWin: 1.5, maxWin: 3, consolation: 50 },
  { id: 2, name: '🟡 Средний', risk: 30, minCost: 200, maxCost: 1000, winChance: 50, minWin: 2, maxWin: 5, consolation: 30 },
  { id: 3, name: '🔴 Высокий', risk: 60, minCost: 1000, maxCost: 5000, winChance: 30, minWin: 3, maxWin: 8, consolation: 20 },
  { id: 4, name: '⚫ Экстремальный', risk: 90, minCost: 5000, maxCost: 25000, winChance: 10, minWin: 5, maxWin: 20, consolation: 10 }
];

let sundukStats = {};
let freeSundukUsed = {};

// ==================== ИНВЕСТИЦИИ ====================
const INVESTMENT_CONFIG = {
  minAmount: 100,
  maxAmount: 100000,
  percentPerDay: 5,
  minDays: 1,
  maxDays: 7,
  earlyWithdrawPenalty: 0.5
};

function safeNumber(value) {
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

let maintenanceMode = false;
let maintenanceMessage = '🔧 Бот на технических работах. Скоро вернёмся!';
let maintenanceEndTime = null;
let maintenanceNotified = false;

// ==================== ТУРНИРЫ ====================
const TOURNAMENT_CONFIG = {
  entryFee: 2000,
  minPlayers: 4,
  maxPlayers: 20,
  prizePoolPercent: 70,
  adminPercent: 30,
  duration: 604800000
};

let tournaments = {
  active: false,
  players: [],
  startTime: null,
  endTime: null,
  prizePool: 0,
  winnerId: null,
  results: []
};

function startTournament() {
  if (tournaments.active) return false;
  tournaments.active = true;
  tournaments.players = [];
  tournaments.startTime = Date.now();
  tournaments.endTime = Date.now() + TOURNAMENT_CONFIG.duration;
  tournaments.prizePool = 0;
  tournaments.winnerId = null;
  tournaments.results = [];
  return true;
}

function joinTournament(playerId) {
  if (!tournaments.active) return false;
  if (tournaments.players.includes(playerId)) return false;
  if (tournaments.players.length >= TOURNAMENT_CONFIG.maxPlayers) return false;
  tournaments.players.push(playerId);
  return true;
}

function endTournament() {
  if (!tournaments.active) return;
  tournaments.active = false;
  tournaments.players.sort((a, b) => {
    const balA = players[a]?.demoMode ? safeNumber(players[a].demoBalance) : safeNumber(players[a]?.balance) || 0;
    const balB = players[b]?.demoMode ? safeNumber(players[b].demoBalance) : safeNumber(players[b]?.balance) || 0;
    return balB - balA;
  });
  tournaments.results = tournaments.players;
  if (tournaments.players.length > 0) {
    tournaments.winnerId = tournaments.players[0];
  }
  tournaments.prizePool = tournaments.players.length * TOURNAMENT_CONFIG.entryFee;
}

// ==================== ФУНКЦИИ БЛЭКДЖЕКА ====================
function createDeck() {
  const suits = ['♠️', '♥️', '♦️', '♣️'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let suit of suits) {
    for (let rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCardValue(rank) {
  if (rank === 'A') return 11;
  if (['J', 'Q', 'K'].includes(rank)) return 10;
  return parseInt(rank);
}

function getHandValue(hand) {
  let value = 0;
  let aces = 0;
  for (let card of hand) {
    if (card.rank === 'A') aces++;
    value += getCardValue(card.rank);
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

function formatHand(hand) {
  return hand.map(c => `${c.suit}${c.rank}`).join(' ');
}

function isBlackjack(hand) {
  return hand.length === 2 && getHandValue(hand) === 21;
}

function initBlackjackGame(playerId) {
  const deck = shuffleDeck(createDeck());
  blackjackGames[playerId] = {
    deck: deck,
    playerHand: [],
    dealerHand: [],
    bet: 0,
    status: 'waiting',
    splitHands: [],
    currentSplit: 0
  };
  return blackjackGames[playerId];
}

function finishBlackjack(playerId) {
  const game = blackjackGames[playerId];
  if (!game) return;
  const p = players[playerId];
  if (!p) return;

  let winAmount = 0;
  let result = '';

  if (game.splitHands && game.splitHands.length > 0) {
    let totalWin = 0;
    let dealerValue = getHandValue(game.dealerHand);
    let dealerHand = game.dealerHand;
    let safetyCounter = 0;
    while (dealerValue < 17 && safetyCounter < 10) {
      const card = game.deck.pop();
      if (!card) break;
      dealerHand.push(card);
      dealerValue = getHandValue(dealerHand);
      safetyCounter++;
    }
    game.dealerHand = dealerHand;
    
    for (let hand of game.splitHands) {
      const value = getHandValue(hand);
      if (value > 21) {
        totalWin -= game.bet;
      } else if (dealerValue > 21 || value > dealerValue) {
        totalWin += game.bet * 2;
      } else if (value === dealerValue) {
        totalWin += game.bet;
      } else {
        totalWin -= game.bet;
      }
    }
    winAmount = totalWin;
    if (winAmount > 0) {
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + winAmount;
      } else {
        p.balance = safeNumber(p.balance) + winAmount;
      }
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(playerId,
      `🎴 РЕЗУЛЬТАТЫ СПЛИТА:\n\n` +
      `Рука 1: ${formatHand(game.splitHands[0])} (${getHandValue(game.splitHands[0])} очков)\n` +
      `Рука 2: ${formatHand(game.splitHands[1])} (${getHandValue(game.splitHands[1])} очков)\n` +
      `Дилер: ${formatHand(game.dealerHand)} (${getHandValue(game.dealerHand)} очков)\n\n` +
      `💰 Итог: ${winAmount > 0 ? '+' : ''}${winAmount} дуб.\n` +
      `📊 Баланс: ${balance} дуб.`,
      mainInlineKeyboard()
    );
    delete blackjackGames[playerId];
    return;
  }

  const playerHand = game.playerHand;
  const dealerHand = game.dealerHand;
  const playerValue = getHandValue(playerHand);
  let dealerValue = getHandValue(dealerHand);

  let safetyCounter = 0;
  while (dealerValue < 17 && safetyCounter < 10) {
    const card = game.deck.pop();
    if (!card) break;
    dealerHand.push(card);
    dealerValue = getHandValue(dealerHand);
    safetyCounter++;
  }

  if (playerValue > 21) {
    result = '❌ Перебор! Ты проиграл!';
    winAmount = -game.bet;
  } else if (dealerValue > 21 || playerValue > dealerValue) {
    result = '✅ Ты выиграл!';
    winAmount = game.bet * 2;
    if (isBlackjack(playerHand)) winAmount = Math.floor(game.bet * 2.5);
  } else if (playerValue === dealerValue) {
    result = '🤝 Ничья!';
    winAmount = game.bet;
  } else {
    result = '❌ Ты проиграл!';
    winAmount = -game.bet;
  }

  if (winAmount > 0) {
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) + winAmount;
    } else {
      p.balance = safeNumber(p.balance) + winAmount;
    }
  }

  const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  bot.sendMessage(playerId,
    `🎴 РЕЗУЛЬТАТ:\n\n` +
    `Твоя рука: ${formatHand(playerHand)} (${playerValue} очков)\n` +
    `Дилер: ${formatHand(dealerHand)} (${dealerValue} очков)\n\n` +
    `${result}\n` +
    `💰 ${winAmount > 0 ? '+' : ''}${winAmount} дуб.\n` +
    `📊 Баланс: ${balance} дуб.`,
    mainInlineKeyboard()
  );
  delete blackjackGames[playerId];
}

// ==================== ПИРАТСКИЙ ФЛОТ ====================
const SHIPS = [
  { id: 1, name: '🚤 Шлюпка', cost: 5000, income: 5, upgradeCost: 3000, level: 0, maxLevel: 10 },
  { id: 2, name: '⛵ Бригантина', cost: 15000, income: 15, upgradeCost: 8000, level: 0, maxLevel: 10 },
  { id: 3, name: '⚓ Фрегат', cost: 30000, income: 30, upgradeCost: 15000, level: 0, maxLevel: 10 },
  { id: 4, name: '🏴‍☠️ Галеон', cost: 50000, income: 50, upgradeCost: 25000, level: 0, maxLevel: 10 },
  { id: 5, name: '👑 Линейный корабль', cost: 80000, income: 80, upgradeCost: 40000, level: 0, maxLevel: 10 },
  { id: 6, name: '⚔️ Дредноут', cost: 120000, income: 120, upgradeCost: 60000, level: 0, maxLevel: 10 },
  { id: 7, name: '🌊 Мана-о-вар', cost: 180000, income: 180, upgradeCost: 90000, level: 0, maxLevel: 10 },
  { id: 8, name: '💀 Летучий голландец', cost: 250000, income: 250, upgradeCost: 120000, level: 0, maxLevel: 10 },
  { id: 9, name: '🔥 Флагман', cost: 350000, income: 350, upgradeCost: 180000, level: 0, maxLevel: 10 },
  { id: 10, name: '👑 Королевский якорь', cost: 500000, income: 500, upgradeCost: 250000, level: 0, maxLevel: 10 },
  { id: 11, name: '🦈 Акула', cost: 700000, income: 700, upgradeCost: 350000, level: 0, maxLevel: 10 },
  { id: 12, name: '🐉 Дракон', cost: 1000000, income: 1000, upgradeCost: 500000, level: 0, maxLevel: 10 },
  { id: 13, name: '⚡ Молния', cost: 1500000, income: 1500, upgradeCost: 750000, level: 0, maxLevel: 10 },
  { id: 14, name: '🌪️ Ураган', cost: 2000000, income: 2000, upgradeCost: 1000000, level: 0, maxLevel: 10 },
  { id: 15, name: '🌌 Звёздный странник', cost: 3000000, income: 3000, upgradeCost: 1500000, level: 0, maxLevel: 10 },
  { id: 16, name: '♾️ Бесконечность', cost: 5000000, income: 5000, upgradeCost: 2500000, level: 0, maxLevel: 10 },
  { id: 17, name: '🔥 Феникс', cost: 8000000, income: 8000, upgradeCost: 4000000, level: 0, maxLevel: 10 },
  { id: 18, name: '💎 Алмазный дракон', cost: 12000000, income: 12000, upgradeCost: 6000000, level: 0, maxLevel: 10 },
  { id: 19, name: '👾 Космический пират', cost: 20000000, income: 20000, upgradeCost: 10000000, level: 0, maxLevel: 10 },
  { id: 20, name: '👑 Император', cost: 50000000, income: 50000, upgradeCost: 25000000, level: 0, maxLevel: 10 }
];

function getShipIncome(ship) {
  return Math.floor(ship.income * (1 + ship.level * 0.2));
}

function getShipUpgradeCost(ship) {
  return Math.floor(ship.upgradeCost * (1 + ship.level * 0.3));
}

function buyShip(playerId, shipId) {
  const p = players[playerId];
  if (!p) return false;
  const ship = SHIPS.find(s => s.id === shipId);
  if (!ship) return false;
  if (!p.fleet) p.fleet = { ships: [], totalIncome: 0, lastCollected: Date.now() };
  if (p.fleet.ships.some(s => s.id === shipId)) return false;
  const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  if (balance < ship.cost) return false;
  if (p.demoMode) {
    p.demoBalance = safeNumber(p.demoBalance) - ship.cost;
  } else {
    p.balance = safeNumber(p.balance) - ship.cost;
  }
  p.fleet.ships.push({ id: shipId, level: 0 });
  p.fleet.totalIncome = calculateTotalIncome(p);
  return true;
}

function upgradeShip(playerId, shipId) {
  const p = players[playerId];
  if (!p) return false;
  if (!p.fleet) return false;
  const shipData = p.fleet.ships.find(s => s.id === shipId);
  if (!shipData) return false;
  const ship = SHIPS.find(s => s.id === shipId);
  if (!ship) return false;
  if (shipData.level >= ship.maxLevel) return false;
  const cost = getShipUpgradeCost({ ...ship, level: shipData.level });
  const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  if (balance < cost) return false;
  if (p.demoMode) {
    p.demoBalance = safeNumber(p.demoBalance) - cost;
  } else {
    p.balance = safeNumber(p.balance) - cost;
  }
  shipData.level++;
  p.fleet.totalIncome = calculateTotalIncome(p);
  return true;
}

function calculateTotalIncome(p) {
  if (!p.fleet) return 0;
  let total = 0;
  for (let shipData of p.fleet.ships) {
    const ship = SHIPS.find(s => s.id === shipData.id);
    if (ship) {
      total += getShipIncome({ ...ship, level: shipData.level });
    }
  }
  return Math.floor(total);
}

function collectFleetIncome(playerId) {
  const p = players[playerId];
  if (!p) return 0;
  if (!p.fleet) return 0;
  const income = p.fleet.totalIncome || 0;
  if (income <= 0) return 0;
  if (p.demoMode) {
    p.demoBalance = safeNumber(p.demoBalance) + income;
  } else {
    p.balance = safeNumber(p.balance) + income;
  }
  p.fleet.lastCollected = Date.now();
  return income;
}

function checkAchievements(p, id) {
  if (!p) return;
  const unlocked = p.achievements || [];
  let newAchievements = [];

  for (let ach of ACHIEVEMENTS) {
    if (unlocked.includes(ach.id)) continue;
    let condition = false;

    switch (ach.id) {
      case 1: condition = p.stats.totalGames >= 1; break;
      case 2: condition = p.stats.maxStreak >= 5; break;
      case 3: condition = p.stats.maxStreak >= 10; break;
      case 4: condition = p.stats.wins >= 100; break;
      case 5: condition = safeNumber(p.totalEarned) >= 1000000; break;
      case 6: condition = p.duelStats.wins >= 50; break;
      case 7: condition = (p.fleet?.ships?.length || 0) >= 10; break;
      case 8: condition = (p.sundukOpened || 0) >= 100; break;
      case 9: condition = (p.blackjackWins || 0) >= 50; break;
      case 10: condition = unlocked.length >= 9; break;
      default: continue;
    }

    if (condition) {
      newAchievements.push(ach.id);
    }
  }

  for (let achId of newAchievements) {
    if (!p.achievements.includes(achId)) {
      p.achievements.push(achId);
      const ach = ACHIEVEMENTS.find(a => a.id === achId);
      p.achievementBonus = (p.achievementBonus || 0) + (ach?.bonus || 0);
      bot.sendMessage(id, `🏆 НОВОЕ ДОСТИЖЕНИЕ!\n${ach.name}\n${ach.desc}\nБонус: +${ach.bonus}% к доходу`);
    }
  }

  if (newAchievements.length > 0) {
    saveData();
  }
}

const EVENTS = [
  { name: '🦜 Пиратский налёт', desc: 'Удвоение банка на 10 минут!', multiplier: 2, duration: 600000 },
  { name: '💰 Золотая лихорадка', desc: '+50% к выигрышу на 1 час!', multiplier: 1.5, duration: 3600000 },
  { name: '🏴‍☠️ Чёрная метка', desc: 'Джекпот увеличивается в 3 раза!', multiplier: 3, duration: 1800000 },
];

let activeEvent = null;
let eventTimer = null;

let players = {};
let bank = { pot: 2000, jackpot: 0, totalStakes: 0, commission: 0, roundActive: false, roundEnd: 0 };
let withdrawQueue = [];
let rateLimit = {};
let roundTimer = null;
let approveAttempts = {};
let blockList = {};
let jackpotCounter = 0;
let adminState = {};
let duelChallenges = {};
let saveTimeout = null;
let blackjackGames = {};

const RANKS = [
  { name: 'Боцман', costDublons: 0, costRub: 0, bonus: 0, passive: 0, emoji: '🪵' },
  { name: 'Шкипер', costDublons: 2000, costRub: 0, bonus: 20, passive: 5, emoji: '⚓' },
  { name: 'Капитан', costDublons: 5000, costRub: 0, bonus: 40, passive: 15, emoji: '🏴' },
  { name: 'Командор', costDublons: 10000, costRub: 0, bonus: 60, passive: 30, emoji: '⚔️' },
  { name: 'Адмирал', costDublons: 20000, costRub: 0, bonus: 80, passive: 50, emoji: '🎖️' },
  { name: 'Король пиратов', costDublons: 40000, costRub: 0, bonus: 120, passive: 80, emoji: '👑' },
  { name: 'Легенда морей', costDublons: 70000, costRub: 0, bonus: 150, passive: 120, emoji: '🌊' },
  { name: 'Властелин океана', costDublons: 100000, costRub: 0, bonus: 200, passive: 200, emoji: '🔱' }
];

const SHARES = [
  { percent: 1, costDublons: 0, costRub: 1500 },
  { percent: 3, costDublons: 0, costRub: 4000 },
  { percent: 5, costDublons: 0, costRub: 6000 },
  { percent: 10, costDublons: 0, costRub: 10000 }
];

function loadData() {
  try {
    if (fs.existsSync(PLAYERS_FILE)) players = JSON.parse(fs.readFileSync(PLAYERS_FILE));
    if (fs.existsSync(BANK_FILE)) bank = JSON.parse(fs.readFileSync(BANK_FILE));
    if (fs.existsSync(QUEUE_FILE)) withdrawQueue = JSON.parse(fs.readFileSync(QUEUE_FILE));
    if (fs.existsSync(JACKPOT_FILE)) jackpotCounter = JSON.parse(fs.readFileSync(JACKPOT_FILE));
    if (fs.existsSync(HASH_FILE)) {
      const currentHash = crypto.createHash('sha256').update(JSON.stringify(players)).digest('hex');
      const savedHash = fs.readFileSync(HASH_FILE, 'utf8');
      if (currentHash !== savedHash) console.log('⚠️ ВНИМАНИЕ! Файл players.json был изменён извне!');
    }
  } catch (e) {
    players = {};
    bank = { pot: 2000, jackpot: 0, totalStakes: 0, commission: 0, roundActive: false, roundEnd: 0 };
    withdrawQueue = [];
    jackpotCounter = 0;
  }
}

function saveData() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(PLAYERS_FILE + '.tmp', JSON.stringify(players, null, 2));
      fs.writeFileSync(BANK_FILE + '.tmp', JSON.stringify(bank, null, 2));
      fs.writeFileSync(QUEUE_FILE + '.tmp', JSON.stringify(withdrawQueue, null, 2));
      fs.writeFileSync(JACKPOT_FILE + '.tmp', JSON.stringify(jackpotCounter));
      fs.renameSync(PLAYERS_FILE + '.tmp', PLAYERS_FILE);
      fs.renameSync(BANK_FILE + '.tmp', BANK_FILE);
      fs.renameSync(QUEUE_FILE + '.tmp', QUEUE_FILE);
      fs.renameSync(JACKPOT_FILE + '.tmp', JACKPOT_FILE);
      const hash = crypto.createHash('sha256').update(JSON.stringify(players)).digest('hex');
      fs.writeFileSync(HASH_FILE, hash);
      saveTimeout = null;
    } catch (e) {
      console.error('❌ Ошибка сохранения:', e.message);
      saveTimeout = null;
    }
  }, 2000);
}

loadData();

bank.pot = safeNumber(bank.pot) || 2000;
bank.jackpot = safeNumber(bank.jackpot) || 0;
bank.totalStakes = safeNumber(bank.totalStakes) || 0;
bank.commission = safeNumber(bank.commission) || 0;
bank.roundActive = bank.roundActive || false;
bank.roundEnd = safeNumber(bank.roundEnd) || 0;
saveData();

function getEntryFee(balance, bet, freeStakesUsed) {
  const bal = Number(balance) || 0;
  const b = Number(bet) || 0;
  const free = Number(freeStakesUsed) || 0;

  if (bal === 0 && free < 3) {
    return { fee: 0, percent: 0, isFree: true };
  }
  let percent = 0.01;
  if (bal > 100) percent = 0.02;
  if (bal > 500) percent = 0.03;
  if (bal > 2000) percent = 0.05;
  if (bal > 10000) percent = 0.10;
  const fee = Math.floor(b * percent);
  return { fee: fee < 1 ? 1 : fee, percent: percent * 100, isFree: false };
}

function getPlayer(id) {
  if (!players[id]) {
    if (Object.keys(players).length >= MAX_PLAYERS) {
      bot.sendMessage(id, '❌ Бот переполнен. Попробуй позже.');
      return null;
    }
    players[id] = {
      balance: 10,
      freeStakesUsed: 0,
      bet: 0,
      point: 0,
      canDouble: false,
      hasRolled: false,
      daily: 0,
      dailyStreak: 0,
      lastDailyDate: null,
      refs: [],
      refBonus: 0,
      history: [],
      username: '',
      withdrawToday: 0,
      withdrawDate: new Date().toDateString(),
      demoMode: false,
      demoBalance: 50,
      demoBet: 0,
      demoPoint: 0,
      demoCanDouble: false,
      demoHasRolled: false,
      demoRollsToday: 0,
      demoDate: new Date().toDateString(),
      currentMode: '🎲 Классика',
      rank: 0,
      share: 0,
      passiveCollected: 0,
      lastPassiveTime: Date.now(),
      totalEarned: 0,
      gamesToday: 0,
      gamesDate: new Date().toDateString(),
      withdrawHistory: [],
      balanceHistory: [],
      giftHistory: [],
      investments: [],
      limitUpgrades: 0,
      achievements: [],
      achievementBonus: 0,
      sundukOpened: 0,
      sundukWins: 0,
      sundukBestWin: 0,
      sundukStreak: 0,
      blackjackWins: 0,
      lastActivity: Date.now(),
      stats: { wins: 0, losses: 0, points: 0, streak: 0, maxStreak: 0, totalGames: 0 },
      duelStats: { wins: 0, losses: 0, totalGames: 0 },
      vipStats: { wins: 0, losses: 0, totalGames: 0 },
      fleet: { ships: [], totalIncome: 0, lastCollected: Date.now() }
    };
          }

if (!players[id].demoDate) players[id].demoDate = new Date().toDateString();
  if (players[id].demoBalance === undefined) players[id].demoBalance = 50;
  if (players[id].demoMode === undefined) players[id].demoMode = false;
  if (players[id].demoBet === undefined) players[id].demoBet = 0;
  if (players[id].demoPoint === undefined) players[id].demoPoint = 0;
  if (players[id].demoCanDouble === undefined) players[id].demoCanDouble = false;
  if (players[id].demoHasRolled === undefined) players[id].demoHasRolled = false;
  if (players[id].demoRollsToday === undefined) players[id].demoRollsToday = 0;
  if (!players[id].fleet) players[id].fleet = { ships: [], totalIncome: 0, lastCollected: Date.now() };
  if (!players[id].lastActivity) players[id].lastActivity = Date.now();

  if (!players[id].stats) players[id].stats = { wins: 0, losses: 0, points: 0, streak: 0, maxStreak: 0, totalGames: 0 };
  if (!players[id].duelStats) players[id].duelStats = { wins: 0, losses: 0, totalGames: 0 };
  if (!players[id].vipStats) players[id].vipStats = { wins: 0, losses: 0, totalGames: 0 };
  if (!players[id].rank) players[id].rank = 0;
  if (!players[id].share) players[id].share = 0;
  if (!players[id].passiveCollected) players[id].passiveCollected = 0;
  if (!players[id].lastPassiveTime) players[id].lastPassiveTime = Date.now();
  if (!players[id].totalEarned) players[id].totalEarned = 0;
  if (!players[id].dailyStreak) players[id].dailyStreak = 0;
  if (!players[id].lastDailyDate) players[id].lastDailyDate = null;
  if (!players[id].gamesToday) players[id].gamesToday = 0;
  if (!players[id].gamesDate) players[id].gamesDate = new Date().toDateString();
  if (!players[id].withdrawHistory) players[id].withdrawHistory = [];
  if (!players[id].balanceHistory) players[id].balanceHistory = [];
  if (!players[id].giftHistory) players[id].giftHistory = [];
  if (!players[id].investments) players[id].investments = [];
  if (players[id].limitUpgrades === undefined) players[id].limitUpgrades = 0;
  if (!players[id].achievements) players[id].achievements = [];
  if (players[id].achievementBonus === undefined) players[id].achievementBonus = 0;
  if (players[id].sundukOpened === undefined) players[id].sundukOpened = 0;
  if (players[id].sundukWins === undefined) players[id].sundukWins = 0;
  if (players[id].sundukBestWin === undefined) players[id].sundukBestWin = 0;
  if (players[id].sundukStreak === undefined) players[id].sundukStreak = 0;
  if (players[id].blackjackWins === undefined) players[id].blackjackWins = 0;
  if (players[id].history && players[id].history.length > MAX_HISTORY) {
    players[id].history = players[id].history.slice(-MAX_HISTORY);
  }
  return players[id];
}

function addHistory(id, text) {
  if (!players[id]) return;
  players[id].history.push({ time: Date.now(), text });
  if (players[id].history.length > MAX_HISTORY) players[id].history.shift();
}

function addBalanceHistory(id, amount, reason) {
  if (!players[id]) return;
  players[id].balanceHistory.push({ time: Date.now(), amount, reason, balance: players[id].balance });
  if (players[id].balanceHistory.length > 30) players[id].balanceHistory.shift();
}

function checkActivityBonus(p, id) {
  const today = new Date().toDateString();
  if (p.gamesDate !== today) {
    p.gamesToday = 0;
    p.gamesDate = today;
  }
  p.gamesToday++;

  let bonus = 0;
  let message = '';
  if (p.gamesToday === 10) {
    bonus = 5;
    message = '🎯 Ты сыграл 10 игр сегодня! Получи бонус +5 дуб.';
  } else if (p.gamesToday === 25) {
    bonus = 15;
    message = '🎯 Ты сыграл 25 игр сегодня! Получи бонус +15 дуб.';
  } else if (p.gamesToday === 50) {
    bonus = 30;
    message = '🎯 Ты сыграл 50 игр сегодня! Получи бонус +30 дуб.';
  } else if (p.gamesToday === 100) {
    bonus = 50;
    message = '🎯 Ты сыграл 100 игр сегодня! Получи бонус +50 дуб.';
  }

  if (bonus > 0) {
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) + bonus;
    } else {
      p.balance = safeNumber(p.balance) + bonus;
    }
    addHistory(id, `Бонус за активность: ${p.gamesToday} игр → +${bonus} дуб.`);
    addBalanceHistory(id, bonus, `Бонус за активность ${p.gamesToday} игр`);
    bot.sendMessage(id, message);
  }
}

function isFlood(id) {
  const now = Date.now();
  if (blockList[id] && blockList[id] > now) {
    bot.sendMessage(id, '⛔ Ты заблокирован на 1 час за подозрительную активность.');
    return true;
  }
  if (rateLimit[id] && now - rateLimit[id] < 2000) {
    console.log(`⚠️ Флуд от ${id} (${players[id]?.username || 'unknown'})`);
    return true;
  }
  rateLimit[id] = now;
  return false;
}

function blockUser(id) {
  blockList[id] = Date.now() + 3600000;
  console.log(`⛔ Заблокирован ${id} на 1 час`);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function checkBalance(p, amount) {
  const bal = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  const amt = Number(amount) || 0;
  if (bal < amt) {
    return { ok: false, message: `❌ Не хватает. У тебя ${bal} дуб.` };
  }
  return { ok: true };
}

function getCurrentBalance(p) {
  return p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
}

function setCurrentBalance(p, value) {
  if (p.demoMode) {
    p.demoBalance = safeNumber(value);
  } else {
    p.balance = safeNumber(value);
  }
}

function addToCurrentBalance(p, amount) {
  if (p.demoMode) {
    p.demoBalance = safeNumber(p.demoBalance) + amount;
  } else {
    p.balance = safeNumber(p.balance) + amount;
  }
}

function subtractFromCurrentBalance(p, amount) {
  if (p.demoMode) {
    p.demoBalance = safeNumber(p.demoBalance) - amount;
  } else {
    p.balance = safeNumber(p.balance) - amount;
  }
}

function enableMaintenance(message, hours = 2) {
  maintenanceMode = true;
  maintenanceMessage = message || '🔧 Бот на технических работах. Скоро вернёмся!';
  maintenanceEndTime = Date.now() + hours * 3600000;
  maintenanceNotified = false;

  for (let id in players) {
    if (players[id].balance > 0 || players[id].demoBalance > 0) {
      bot.sendMessage(id,
        `🔧 ТЕХНИЧЕСКИЕ РАБОТЫ!\n\n` +
        `${maintenanceMessage}\n` +
        `⏳ Ориентировочное время: ${hours} час(ов)\n` +
        `📅 Окончание: ${new Date(maintenanceEndTime).toLocaleTimeString()}\n\n` +
        `Просьба завершить игры до этого времени. Спасибо за понимание! 🙏`
      ).catch(() => {});
    }
  }
  saveData();
  console.log(`🔧 Технические работы включены на ${hours} часов`);
}

function disableMaintenance() {
  maintenanceMode = false;
  maintenanceMessage = '🔧 Бот на технических работах. Скоро вернёмся!';
  maintenanceEndTime = null;
  maintenanceNotified = false;

  for (let id in players) {
    if (players[id].balance > 0 || players[id].demoBalance > 0) {
      bot.sendMessage(id,
        `✅ ТЕХНИЧЕСКИЕ РАБОТЫ ЗАВЕРШЕНЫ!\n\n` +
        `Бот снова в строю! 🏴‍☠️\n` +
        `Приятной игры! 🎲`
      ).catch(() => {});
    }
  }
  saveData();
  console.log('✅ Технические работы завершены');
}

function isMaintenanceActive() {
  if (!maintenanceMode) return false;
  if (maintenanceEndTime && Date.now() > maintenanceEndTime) {
    disableMaintenance();
    return false;
  }
  return true;
}

// ==================== КЛАВИАТУРЫ ====================

function blackjackKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎴 Взять карту', callback_data: 'bj_hit' }, { text: '✋ Остановиться', callback_data: 'bj_stand' }],
        [{ text: '⚡ Удвоить', callback_data: 'bj_double' }, { text: '✂️ Сплит', callback_data: 'bj_split' }],
        [{ text: '⬅️ Выйти', callback_data: 'bj_quit' }]
      ]
    }
  };
}

function fleetKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Мои корабли', callback_data: 'fleet_my' }],
        [{ text: '🛒 Купить корабль', callback_data: 'fleet_buy' }],
        [{ text: '⬆️ Улучшить корабль', callback_data: 'fleet_upgrade' }],
        [{ text: '💰 Собрать доход', callback_data: 'fleet_collect' }],
        [{ text: '🏆 Топ флотов', callback_data: 'fleet_top' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function tournamentKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Инфо о турнире', callback_data: 'tournament_info' }],
        [{ text: '💰 Участвовать', callback_data: 'tournament_join' }],
        [{ text: '🏆 Таблица лидеров', callback_data: 'tournament_leaderboard' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function mainInlineKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎰 Играть', callback_data: 'menu_play' }],
        [{ text: '👤 Профиль', callback_data: 'menu_profile' }, { text: '💰 Банк', callback_data: 'menu_bank' }],
        [{ text: '🏆 Топ', callback_data: 'menu_top' }, { text: '🏴‍☠️ Ранг', callback_data: 'menu_rank' }],
        [{ text: '💳 Пополнить', callback_data: 'menu_topup' }, { text: '📈 Доля', callback_data: 'menu_share' }],
        [{ text: '⚔️ Сундук', callback_data: 'menu_sunduk' }, { text: '🌊 Доход', callback_data: 'menu_income' }],
        [{ text: '🎴 Блэкджек', callback_data: 'menu_blackjack' }, { text: '⚔️ Турнир', callback_data: 'menu_tournament' }],
        [{ text: '🚢 Пиратский флот', callback_data: 'menu_fleet' }, { text: '📈 Инвестиции', callback_data: 'menu_invest' }],
        [{ text: '⬆️ Лимит ставок', callback_data: 'menu_limit' }, { text: '🎮 Демо', callback_data: 'menu_demo' }],
        [{ text: '🏆 Достижения', callback_data: 'menu_achievements' }],
        [{ text: '❓ Помощь', callback_data: 'menu_help' }]
      ]
    }
  };
}

function adminInlineKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📋 Очередь', callback_data: 'admin_queue' }, { text: '✅ Подтвердить', callback_data: 'admin_approve' }],
        [{ text: '💰 Начислить', callback_data: 'admin_addbalance' }, { text: '📋 История', callback_data: 'admin_history' }],
        [{ text: '⚔️ Активировать Сундук', callback_data: 'admin_sunduk' }, { text: '✅ Активировать долю', callback_data: 'admin_share' }],
        [{ text: '⛔ Забанить', callback_data: 'admin_ban' }, { text: '🔓 Разбанить', callback_data: 'admin_unban' }],
        [{ text: '📊 Статистика', callback_data: 'admin_stats' }, { text: '🔄 Перезапустить раунд', callback_data: 'admin_round' }],
        [{ text: '🔧 Тех. работы', callback_data: 'admin_maintenance' }, { text: '✅ Отключить тех. работы', callback_data: 'admin_maintenance_off' }],
        [{ text: '⬅️ Назад', callback_data: 'admin_back' }]
      ]
    }
  };
}

function gameModeKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎲 Классика', callback_data: 'mode_classic' }, { text: '⚔️ Дуэль', callback_data: 'mode_duel' }],
        [{ text: '👑 VIP-игра', callback_data: 'mode_vip' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function duelCurrencyKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💵 Дублоны', callback_data: 'duel_currency_dublons' }, { text: '💰 Реальные деньги', callback_data: 'duel_currency_money' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function gameActionsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎲 Бросить', callback_data: 'game_roll' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function doubleActionsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⚡ Удвоить', callback_data: 'game_double' }, { text: '💰 Забрать', callback_data: 'game_take' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function profileInlineKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Баланс', callback_data: 'profile_balance' }, { text: '🎁 Бонус', callback_data: 'profile_bonus' }],
        [{ text: '🔗 Рефералка', callback_data: 'profile_referral' }, { text: '💸 Вывод', callback_data: 'profile_withdraw' }],
        [{ text: '📈 Статистика', callback_data: 'profile_stats' }, { text: '📋 История выводов', callback_data: 'profile_withdraw_history' }],
        [{ text: '💝 Подарки', callback_data: 'menu_gifts' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function giftKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💝 Отправить подарок', callback_data: 'gift_send' }],
        [{ text: '📋 История подарков', callback_data: 'gift_history' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function investmentKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Мои инвестиции', callback_data: 'invest_my' }],
        [{ text: '💰 Новая инвестиция', callback_data: 'invest_new' }],
        [{ text: '💸 Забрать инвестицию', callback_data: 'invest_withdraw' }],
        [{ text: '📈 Статистика', callback_data: 'invest_stats' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function limitKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 Мой лимит', callback_data: 'limit_my' }],
        [{ text: '⬆️ Увеличить лимит', callback_data: 'limit_upgrade' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function achievementKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🏆 Мои достижения', callback_data: 'ach_my' }],
        [{ text: '📋 Все достижения', callback_data: 'ach_list' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function shareInlineKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📈 1% (1500 ₽)', callback_data: 'share_1' }, { text: '📈 3% (4000 ₽)', callback_data: 'share_3' }],
        [{ text: '📈 5% (6000 ₽)', callback_data: 'share_5' }, { text: '📈 10% (10000 ₽)', callback_data: 'share_10' }],
        [{ text: '📉 Продать долю', callback_data: 'share_sell' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function rankInlineKeyboard() {
  const buttons = [];
  for (let i = 1; i < RANKS.length; i++) {
    buttons.push([{ text: `${RANKS[i].emoji} ${RANKS[i].name} — ${RANKS[i].costDublons} дуб.`, callback_data: `rank_${i}` }]);
  }
  buttons.push([{ text: '⬅️ Назад', callback_data: 'menu_back' }]);
  return { reply_markup: { inline_keyboard: buttons } };
}

function withdrawInlineKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💸 50', callback_data: 'withdraw_50' }, { text: '💸 100', callback_data: 'withdraw_100' }, { text: '💸 200', callback_data: 'withdraw_200' }],
        [{ text: '💸 500', callback_data: 'withdraw_500' }, { text: '💸 1000', callback_data: 'withdraw_1000' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function collectInlineKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Забрать доход', callback_data: 'collect_take' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function sundukInlineKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🟢 Низкий риск', callback_data: 'sunduk_1' }],
        [{ text: '🟡 Средний риск', callback_data: 'sunduk_2' }],
        [{ text: '🔴 Высокий риск', callback_data: 'sunduk_3' }],
        [{ text: '⚫ Экстремальный риск', callback_data: 'sunduk_4' }],
        [{ text: '🎁 Бесплатный сундук', callback_data: 'sunduk_free' }],
        [{ text: '📊 Моя статистика', callback_data: 'sunduk_stats' }],
        [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
      ]
    }
  };
}

function acceptDuelKeyboard(amount, challengerId) {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: `✅ Принять дуэль (${amount} дуб.)`, callback_data: `duel_accept_${challengerId}_${amount}` }],
        [{ text: '❌ Отказаться', callback_data: 'duel_decline' }]
      ]
    }
  };
}

function duelCancelKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Отменить вызов', callback_data: 'duel_cancel' }]
      ]
    }
  };
    }

// ==================== ОБРАБОТЧИК КОМАНДЫ /start ====================
bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  const p = getPlayer(id);
  if (!p) return;
  p.username = msg.from.username || 'noname';

  // ===== ПРОВЕРКА АКТИВНОСТИ ПОЛЬЗОВАТЕЛЯ =====
  const lastActivity = p.lastActivity || 0;
  if (Date.now() - lastActivity > 600000) {
    bot.sendMessage(id, '🏴‍☠️ Добро пожаловать обратно!');
  }
  p.lastActivity = Date.now();

  const args = msg.text.split(' ');
  if (args.length > 1 && args[0] === '/start' && args[1].startsWith('ref_')) {
    const refId = parseInt(args[1].split('_')[1]);
    if (refId && players[refId] && refId !== id) {
      if (!p.refs || !p.refs.includes(refId)) {
        players[refId].balance = safeNumber(players[refId].balance) + 30;
        players[refId].refBonus = (players[refId].refBonus || 0) + 30;
        players[refId].refs = players[refId].refs || [];
        players[refId].refs.push(id);
        p.balance = safeNumber(p.balance) + 15;
        addHistory(refId, `Реферал: +30 дуб. за @${p.username || id}`);
        addBalanceHistory(refId, 30, `Реферал @${p.username || id}`);
        addHistory(id, `Приветственный бонус: +15 дуб. от @${players[refId].username || refId}`);
        addBalanceHistory(id, 15, `Реферальный бонус`);
        saveData();
        bot.sendMessage(refId, `🎁 Твой друг @${p.username || id} зарегистрировался! +30 дуб.`);
        bot.sendMessage(id, `🎁 Приветственный бонус +15 дуб. от @${players[refId].username || refId}!`);
      }
    }
  }

  addHistory(id, 'Зарегистрировался');
  addBalanceHistory(id, 10, 'Начальный баланс');
  saveData();
  const rank = RANKS[p.rank];
  const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  bot.sendMessage(id,
    `🏴‍☠️ Добро пожаловать в ЧЁРНУЮ КОСТЬ!\n\n` +
    `Баланс: ${balance} дуб.\n` +
    `Ранг: ${rank.emoji} ${rank.name} (+${rank.bonus}% к выигрышу)\n` +
    `Доля: ${p.share}% банка\n` +
    `Джекпот: ${safeNumber(bank.jackpot)} | Банк: ${safeNumber(bank.pot)}\n` +
    `Пассивный доход: ${rank.passive} дуб./час`,
    mainInlineKeyboard()
  );
});

// ==================== ОБРАБОТЧИК /admin ====================
bot.onText(/\/admin/, (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, `👑 АДМИН-ПАНЕЛЬ\nВыбери действие:`, adminInlineKeyboard());
});

// ==================== ОСНОВНОЙ ОБРАБОТЧИК CALLBACK_QUERY ====================
bot.on('callback_query', async (query) => {
  const id = query.from.id;
  const data = query.data;

  // Отвечаем на callback БЕЗ ожидания
  bot.answerCallbackQuery(query.id).catch(err => console.log('⚠️ Ошибка answerCallbackQuery:', err.message));
  console.log('📥 CALLBACK ПОЛУЧЕН:', data, 'от', id);

  // ===== ЗАЩИТА ОТ ДУБЛИРОВАНИЯ =====
  if (!global.callbackCooldown) global.callbackCooldown = {};
  const currentTime = Date.now();
  const cooldownKey = `${id}_${data}`;
  if (global.callbackCooldown[cooldownKey] && currentTime - global.callbackCooldown[cooldownKey] < 1500) {
    console.log(`⏳ Дублирование ${data} от ${id} игнорировано`);
    return;
  }
  global.callbackCooldown[cooldownKey] = currentTime;

  const p = getPlayer(id);
  if (!p) return;

  // ===== ПРОВЕРКА ТЕХНИЧЕСКИХ РАБОТ =====
  if (isMaintenanceActive()) {
    const timeLeft = Math.max(0, Math.ceil((maintenanceEndTime - Date.now()) / 60000));
    bot.sendMessage(id,
      `🔧 БОТ НА ТЕХНИЧЕСКИХ РАБОТАХ\n\n` +
      `${maintenanceMessage}\n` +
      `⏳ Осталось примерно: ${timeLeft} минут\n` +
      `Приносим извинения за неудобства! 🙏`
    );
    return;
  }

  if (safeNumber(bank.pot) < 1000 && safeNumber(bank.commission) > 0) {
    const refill = Math.min(safeNumber(bank.commission), 500);
    bank.pot = safeNumber(bank.pot) + refill;
    bank.commission = safeNumber(bank.commission) - refill;
    console.log(`🔄 Банк пополнен на ${refill} из комиссии.`);
    saveData();
  }

  const now = Date.now();
  const rank = RANKS[p.rank];
  if (now - p.lastPassiveTime > 3600000) {
    const hours = Math.floor((now - p.lastPassiveTime) / 3600000);
    const rankBonus = rank.passive * hours;
    const shareBonus = Math.floor((safeNumber(bank.totalStakes) * (p.share / 100)) / 24) * hours;
    const totalBonus = rankBonus + shareBonus;
    if (totalBonus > 0) {
      p.passiveCollected = safeNumber(p.passiveCollected) + totalBonus;
      p.lastPassiveTime += hours * 3600000;
      saveData();
    }
  }

  // ==================== АДМИН ====================
  if (id === ADMIN_ID) {
    if (data === 'admin_queue') {
      if (!withdrawQueue.length) return bot.sendMessage(id, 'Очередь пуста.');
      let msgText = '📋 ОЧЕРЕДЬ ВЫВОДОВ:\n\n';
      withdrawQueue.forEach((q, i) => {
        msgText += `${i+1}. @${q.username || q.id} — ${q.amount} дуб. (${new Date(q.time).toLocaleTimeString()})\n`;
      });
      bot.sendMessage(id, msgText);
      return;
    }
    if (data === 'admin_approve') {
      if (!withdrawQueue.length) return bot.sendMessage(id, 'Очередь пуста.');
      let msgText = '📋 Введи номер заявки для подтверждения:\n\n';
      withdrawQueue.forEach((q, i) => {
        msgText += `${i+1}. @${q.username || q.id} — ${q.amount} дуб.\n`;
      });
      adminState[id] = { action: 'approve' };
      bot.sendMessage(id, msgText);
      return;
    }
    if (data === 'admin_addbalance') {
      adminState[id] = { action: 'addbalance' };
      bot.sendMessage(id, '💰 Введи ID игрока и сумму через пробел:\nПример: 6301554862 1000');
      return;
    }
    if (data === 'admin_history') {
      adminState[id] = { action: 'history' };
      bot.sendMessage(id, '📋 Введи ID игрока для просмотра истории:');
      return;
    }
    if (data === 'admin_sunduk') {
      adminState[id] = { action: 'sunduk' };
      bot.sendMessage(id, '⚔️ Введи ID игрока для активации Сундука:');
      return;
    }
    if (data === 'admin_share') {
      adminState[id] = { action: 'share_activate' };
      bot.sendMessage(id, '📈 Введи ID игрока и процент доли через пробел:\nПример: 6301554862 5');
      return;
    }
    if (data === 'admin_ban') {
      adminState[id] = { action: 'ban' };
      bot.sendMessage(id, '⛔ Введи ID игрока для блокировки:');
      return;
    }
    if (data === 'admin_unban') {
      adminState[id] = { action: 'unban' };
      bot.sendMessage(id, '🔓 Введи ID игрока для разблокировки:');
      return;
    }
    if (data === 'admin_stats') {
      const totalShares = Object.values(players).reduce((sum, p) => sum + (p.share || 0), 0);
      const jackpotPoints = Math.max(0, 10 - (Number(jackpotCounter) || 0));
      bot.sendMessage(id,
        `📊 СТАТИСТИКА АДМИНА:\n` +
        `Комиссия: ${safeNumber(bank.commission)} дуб.\n` +
        `Банк: ${safeNumber(bank.pot)} дуб.\n` +
        `Джекпот: ${safeNumber(bank.jackpot)} дуб.\n` +
        `Всего ставок: ${safeNumber(bank.totalStakes)} дуб.\n` +
        `Общая доля игроков: ${totalShares}%\n` +
        `Очередь: ${withdrawQueue.length}\n` +
        `Игроков: ${Object.keys(players).length}\n` +
        `🎯 До джекпота: ${jackpotPoints} точек`
      );
      return;
    }
    if (data === 'admin_round') {
      bank.roundActive = false;
      if (roundTimer) clearTimeout(roundTimer);
      startRound();
      bot.sendMessage(id, '✅ Раунд перезапущен.');
      return;
    }
    if (data === 'admin_maintenance') {
      adminState[id] = { action: 'maintenance' };
      bot.sendMessage(id,
        `🔧 ВВЕДИ ПАРАМЕТРЫ ТЕХ. РАБОТ:\n\n` +
        `Формат: <сообщение> | <часы>\n` +
        `Пример: Исправляем баги | 2\n\n` +
        `Если не указать часы — будет 2 часа по умолчанию.`
      );
      return;
    }
    if (data === 'admin_maintenance_off') {
      if (!maintenanceMode) {
        bot.answerCallbackQuery(query.id, { text: '❌ Тех. работы не активны.' });
        return;
      }
      disableMaintenance();
      bot.answerCallbackQuery(query.id, { text: '✅ Тех. работы отключены!' });
      bot.sendMessage(id, '✅ Технические работы отключены! Игроки оповещены.');
      return;
    }
    if (data === 'admin_back') {
      delete adminState[id];
      bot.sendMessage(id, `Главное меню:`, mainInlineKeyboard());
      return;
    }
  }

  // ==================== БЛЭКДЖЕК ====================
  if (data === 'menu_blackjack') {
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < BLACKJACK_CONFIG.minBet) {
      bot.sendMessage(id, `❌ Минимальная ставка ${BLACKJACK_CONFIG.minBet} дуб.`);
      return;
    }
    // Принудительно удаляем старую игру
    if (blackjackGames[id]) {
      delete blackjackGames[id];
    }
    const game = initBlackjackGame(id);
    game.status = 'waiting';
    bot.sendMessage(id,
      `🎴 БЛЭКДЖЕК\n\n` +
      `💰 Твой баланс: ${balance} дуб.\n` +
      `🎯 Минимальная ставка: ${BLACKJACK_CONFIG.minBet}\n` +
      `🎯 Максимальная ставка: ${BLACKJACK_CONFIG.maxBet}\n\n` +
      `Введи сумму ставки:`
    );
    return;
  }

  if (data === 'bj_hit') {
    const game = blackjackGames[id];
    if (!game || game.status === 'finished') {
      bot.sendMessage(id, '❌ Игра не активна.');
      return;
    }
    if (game.status === 'waiting') {
      bot.sendMessage(id, '❌ Сначала сделай ставку.');
      return;
    }

    // ===== ЛОГИКА ДЛЯ СПЛИТА =====
    if (game.status === 'split' && game.splitHands.length > 0) {
      const hand = game.splitHands[game.currentSplit];
      if (!hand) {
        bot.sendMessage(id, '❌ Ошибка руки.');
        return;
      }
      const deck = game.deck;
      if (!deck || deck.length === 0) {
        bot.sendMessage(id, '❌ Колода пуста! Игра завершена.');
        game.status = 'finished';
        finishBlackjack(id);
        return;
      }
      hand.push(deck.pop());
      const value = getHandValue(hand);

      if (value > 21) {
        bot.sendMessage(id, `💀 Рука ${game.currentSplit + 1}: ${formatHand(hand)} (${value} очков) — ПЕРЕБОР!`);
        game.currentSplit++;
        if (game.currentSplit >= game.splitHands.length) {
          game.status = 'finished';
          finishBlackjack(id);
        } else {
          const nextHand = game.splitHands[game.currentSplit];
          bot.sendMessage(id,
            `🎴 Твоя рука ${game.currentSplit + 1}: ${formatHand(nextHand)} (${getHandValue(nextHand)} очков)\n💰 Ставка: ${game.bet} дуб.`,
            blackjackKeyboard()
          );
        }
      } else {
        if (hand.length === 2 && getHandValue(hand) === 21) {
          bot.sendMessage(id, `🎉 Рука ${game.currentSplit + 1}: ${formatHand(hand)} (${value} очков) — БЛЭКДЖЕК!`);
          game.currentSplit++;
          if (game.currentSplit >= game.splitHands.length) {
            game.status = 'finished';
            finishBlackjack(id);
          } else {
            const nextHand = game.splitHands[game.currentSplit];
            bot.sendMessage(id,
              `🎴 Твоя рука ${game.currentSplit + 1}: ${formatHand(nextHand)} (${getHandValue(nextHand)} очков)\n💰 Ставка: ${game.bet} дуб.`,
              blackjackKeyboard()
            );
          }
        } else {
          bot.sendMessage(id,
            `🎴 Рука ${game.currentSplit + 1}: ${formatHand(hand)} (${value} очков)\n💰 Ставка: ${game.bet} дуб.`,
            blackjackKeyboard()
          );
        }
      }
      return;
    }

    // ===== ОБЫЧНАЯ ИГРА =====
    const deck = game.deck;
    if (!deck || deck.length === 0) {
      bot.sendMessage(id, '❌ Колода пуста! Игра завершена.');
      game.status = 'finished';
      finishBlackjack(id);
      return;
    }
    game.playerHand.push(deck.pop());
    const value = getHandValue(game.playerHand);
    if (value > 21) {
      game.status = 'finished';
      finishBlackjack(id);
      return;
    }
    bot.sendMessage(id, `🎴 Твоя рука: ${formatHand(game.playerHand)} (${value} очков)`, blackjackKeyboard());
    return;
  }

  if (data === 'bj_stand') {
    const game = blackjackGames[id];
    if (!game || game.status === 'finished') {
      bot.sendMessage(id, '❌ Игра не активна.');
      return;
    }

    // ===== ЛОГИКА ДЛЯ СПЛИТА =====
    if (game.status === 'split' && game.splitHands.length > 0) {
      const hand = game.splitHands[game.currentSplit];
      const value = getHandValue(hand);
      bot.sendMessage(id, `✋ Рука ${game.currentSplit + 1}: ${formatHand(hand)} (${value} очков) — остановился!`);

      game.currentSplit++;
      if (game.currentSplit >= game.splitHands.length) {
        game.status = 'finished';
        finishBlackjack(id);
      } else {
        const nextHand = game.splitHands[game.currentSplit];
        bot.sendMessage(id,
          `🎴 Твоя рука ${game.currentSplit + 1}: ${formatHand(nextHand)} (${getHandValue(nextHand)} очков)\n💰 Ставка: ${game.bet} дуб.`,
          blackjackKeyboard()
        );
      }
      return;
    }

    // ===== ОБЫЧНАЯ ИГРА =====
    game.status = 'finished';
    finishBlackjack(id);
    return;
  }

  if (data === 'bj_double') {
    const game = blackjackGames[id];
    if (!game || game.status === 'finished') {
      bot.sendMessage(id, '❌ Игра не активна.');
      return;
    }
    if (game.playerHand.length !== 2) {
      bot.sendMessage(id, '❌ Удвоить можно только после первых двух карт.');
      return;
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < game.bet) {
      bot.sendMessage(id, `❌ Не хватает. Нужно ${game.bet} дуб.`);
      return;
    }
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - game.bet;
    } else {
      p.balance = safeNumber(p.balance) - game.bet;
    }
    game.bet *= 2;
    game.status = 'doubled';
    const deck = game.deck;
    if (!deck || deck.length === 0) {
      bot.sendMessage(id, '❌ Колода пуста! Игра завершена.');
      game.status = 'finished';
      finishBlackjack(id);
      return;
    }
    game.playerHand.push(deck.pop());
    const value = getHandValue(game.playerHand);
    if (value > 21) {
      game.status = 'finished';
      finishBlackjack(id);
      return;
    }
    game.status = 'finished';
    finishBlackjack(id);
    return;
  }

  if (data === 'bj_split') {
    const game = blackjackGames[id];
    if (!game || game.status === 'finished') {
      bot.sendMessage(id, '❌ Игра не активна.');
      return;
    }
    if (game.status !== 'playing') {
      bot.sendMessage(id, '❌ Сейчас нельзя сделать сплит.');
      return;
    }
    if (game.playerHand.length !== 2 || game.playerHand[0].rank !== game.playerHand[1].rank) {
      bot.sendMessage(id, '❌ Сплит доступен только при двух одинаковых картах.');
      return;
    }

    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < game.bet) {
      bot.sendMessage(id, `❌ Не хватает. Нужно ${game.bet} дуб.`);
      return;
    }

    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - game.bet;
    } else {
      p.balance = safeNumber(p.balance) - game.bet;
    }

    const hand1 = [game.playerHand[0]];
    const hand2 = [game.playerHand[1]];
    const deck = game.deck;
    if (!deck || deck.length < 2) {
      bot.sendMessage(id, '❌ Недостаточно карт для сплита!');
      return;
    }
    hand1.push(deck.pop());
    hand2.push(deck.pop());

    game.splitHands = [hand1, hand2];
    game.currentSplit = 0;
    game.status = 'split';
    game.playerHand = [];

    const hand = game.splitHands[0];
    const value = getHandValue(hand);

    bot.sendMessage(id,
      `✂️ СПЛИТ!\n\n` +
      `Рука 1: ${formatHand(hand)} (${value} очков)\n` +
      `💰 Ставка: ${game.bet} дуб. (каждая рука)\n\n` +
      `Ходи рукой 1:`,
      blackjackKeyboard()
    );
    return;
  }

  if (data === 'bj_quit') {
    delete blackjackGames[id];
    bot.sendMessage(id, `❌ Игра завершена.`, mainInlineKeyboard());
    return;
                        }

       // ==================== ТУРНИРЫ ====================
  if (data === 'menu_tournament') {
    bot.sendMessage(id, `⚔️ ТУРНИРЫ\n\nВыбери действие:`, tournamentKeyboard());
    return;
  }

  if (data === 'tournament_info') {
    if (!tournaments.active) {
      bot.sendMessage(id, `⏳ Турнир не активен. Ожидайте начала.`, tournamentKeyboard());
      return;
    }
    const timeLeft = Math.max(0, tournaments.endTime - Date.now());
    const hours = Math.floor(timeLeft / 3600000);
    const minutes = Math.floor((timeLeft % 3600000) / 60000);
    bot.sendMessage(id,
      `⚔️ ИНФО О ТУРНИРЕ\n\n` +
      `📊 Участников: ${tournaments.players.length}\n` +
      `💰 Призовой фонд: ${tournaments.prizePool} дуб.\n` +
      `⏳ До конца: ${hours}ч ${minutes}м\n` +
      `🏆 Победитель получит 50% призового фонда!\n` +
      `💰 Вход: ${TOURNAMENT_CONFIG.entryFee} дуб.`,
      tournamentKeyboard()
    );
    return;
  }

  if (data === 'tournament_join') {
    if (!tournaments.active) {
      bot.sendMessage(id, `⏳ Турнир не активен. Ожидайте начала.`);
      return;
    }
    if (tournaments.players.includes(id)) {
      bot.sendMessage(id, `❌ Ты уже участвуешь в турнире.`);
      return;
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < TOURNAMENT_CONFIG.entryFee) {
      bot.sendMessage(id, `❌ Не хватает. Нужно ${TOURNAMENT_CONFIG.entryFee} дуб.`);
      return;
    }
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - TOURNAMENT_CONFIG.entryFee;
    } else {
      p.balance = safeNumber(p.balance) - TOURNAMENT_CONFIG.entryFee;
    }
    tournaments.players.push(id);
    tournaments.prizePool += TOURNAMENT_CONFIG.entryFee;
    saveData();
    bot.sendMessage(id, `✅ Ты зарегистрирован в турнире!`);
    return;
  }

  if (data === 'tournament_leaderboard') {
    if (tournaments.results.length === 0) {
      bot.sendMessage(id, `📋 Пока нет результатов.`);
      return;
    }
    let msg = '🏆 ТАБЛИЦА ЛИДЕРОВ ТУРНИРА:\n\n';
    tournaments.results.slice(0, 10).forEach((pid, i) => {
      const player = players[pid];
      const balance = player?.demoMode ? safeNumber(player.demoBalance) : safeNumber(player?.balance) || 0;
      const name = player?.username || pid.toString().substr(-4);
      msg += `${i+1}. ${name} — ${balance} дуб.\n`;
    });
    bot.sendMessage(id, msg, tournamentKeyboard());
    return;
  }

  // ==================== ПИРАТСКИЙ ФЛОТ ====================
  if (data === 'menu_fleet') {
    bot.sendMessage(id, `🚢 ПИРАТСКИЙ ФЛОТ\n\nВыбери действие:`, fleetKeyboard());
    return;
  }

  if (data === 'fleet_my') {
    if (!p.fleet || p.fleet.ships.length === 0) {
      bot.sendMessage(id, `📋 У тебя нет кораблей. Купи их в магазине!`, fleetKeyboard());
      return;
    }
    let msg = `🚢 ТВОЙ ФЛОТ:\n\n`;
    let totalIncome = 0;
    for (let shipData of p.fleet.ships) {
      const ship = SHIPS.find(s => s.id === shipData.id);
      if (ship) {
        const income = getShipIncome({ ...ship, level: shipData.level });
        totalIncome += income;
        msg += `${ship.name} (Уровень ${shipData.level}) — доход ${income} дуб./час\n`;
      }
    }
    msg += `\n💰 Общий доход: ${totalIncome} дуб./час`;
    bot.sendMessage(id, msg, fleetKeyboard());
    return;
  }

  if (data === 'fleet_buy') {
    let msg = `🛒 ДОСТУПНЫЕ КОРАБЛИ:\n\n`;
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    for (let ship of SHIPS) {
      const has = p.fleet?.ships?.some(s => s.id === ship.id) ? '✅' : '❌';
      msg += `${has} [${ship.id}] ${ship.name} — ${ship.cost} дуб. (доход ${ship.income} дуб./час)\n`;
    }
    msg += `\n💰 Твой баланс: ${balance} дуб.\n\nВведи ID корабля (цифра в квадратных скобках) для покупки (или напиши "отмена" для отмены):`;
    adminState[id] = { action: 'fleet_buy' };
    bot.sendMessage(id, msg);
    return;
  }

  if (data === 'fleet_upgrade') {
    if (!p.fleet || p.fleet.ships.length === 0) {
      bot.sendMessage(id, `📋 У тебя нет кораблей для улучшения.`, fleetKeyboard());
      return;
    }
    let msg = `⬆️ УЛУЧШЕНИЕ КОРАБЛЕЙ:\n\n`;
    for (let shipData of p.fleet.ships) {
      const ship = SHIPS.find(s => s.id === shipData.id);
      if (ship) {
        const cost = getShipUpgradeCost({ ...ship, level: shipData.level });
        const maxed = shipData.level >= ship.maxLevel;
        msg += `[${ship.id}] ${ship.name} (Уровень ${shipData.level}/${ship.maxLevel}) — улучшение: ${maxed ? '✅ МАКСИМУМ' : cost + ' дуб.'}\n`;
      }
    }
    msg += `\n💰 Твой баланс: ${p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance)} дуб.\n\nВведи ID корабля (цифра в квадратных скобках) для улучшения (или напиши "отмена" для отмены):`;
    adminState[id] = { action: 'fleet_upgrade' };
    bot.sendMessage(id, msg);
    return;
  }

  if (data === 'fleet_collect') {
    const income = collectFleetIncome(id);
    if (income <= 0) {
      bot.sendMessage(id, `❌ Нет дохода для сбора.`, fleetKeyboard());
      return;
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id, `💰 Ты собрал ${income} дуб. от флота!\n📊 Баланс: ${balance} дуб.`, fleetKeyboard());
    return;
  }

  if (data === 'fleet_top') {
    const fleetList = Object.entries(players)
      .filter(([id, p]) => p.fleet && p.fleet.ships.length > 0)
      .sort((a, b) => (b[1].fleet.totalIncome || 0) - (a[1].fleet.totalIncome || 0))
      .slice(0, 10);
    if (fleetList.length === 0) {
      bot.sendMessage(id, `📋 Нет активных флотов.`, fleetKeyboard());
      return;
    }
    let msg = '🏆 ТОП-10 ФЛОТОВ:\n\n';
    fleetList.forEach(([pid, data], i) => {
      const name = data.username || pid.toString().substr(-4);
      const income = data.fleet.totalIncome || 0;
      msg += `${i+1}. ${name} — доход ${income} дуб./час\n`;
    });
    bot.sendMessage(id, msg, fleetKeyboard());
    return;
  }

  // ==================== ИНВЕСТИЦИИ ====================
  if (data === 'menu_invest') {
    bot.sendMessage(id, `📈 ИНВЕСТИЦИИ\n\nВыбери действие:`, investmentKeyboard());
    return;
  }

  if (data === 'invest_my') {
    if (!p.investments || p.investments.length === 0) {
      bot.sendMessage(id, `📊 У тебя нет активных инвестиций.`, investmentKeyboard());
      return;
    }
    let msg = '📊 ТВОИ ИНВЕСТИЦИИ:\n\n';
    let total = 0;
    let totalProfit = 0;
    p.investments.forEach((inv, i) => {
      const elapsed = Date.now() - inv.startTime;
      const days = elapsed / 86400000;
      const earned = Math.floor(inv.amount * (INVESTMENT_CONFIG.percentPerDay / 100) * days);
      const status = inv.withdrawn ? '✅ ЗАВЕРШЕНА' : '⏳ АКТИВНА';
      total += inv.amount;
      if (!inv.withdrawn) totalProfit += earned;
      msg += `${i+1}. ${inv.amount} дуб. (${inv.days} дн.) — ${status}\n`;
      msg += `   📈 Заработано: ${earned} дуб.\n`;
    });
    msg += `\n💰 Всего вложено: ${total} дуб.\n`;
    msg += `📈 Общая прибыль: ${totalProfit} дуб.`;
    bot.sendMessage(id, msg, investmentKeyboard());
    return;
  }

  if (data === 'invest_new') {
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < INVESTMENT_CONFIG.minAmount) {
      bot.sendMessage(id, `❌ Минимальная инвестиция ${INVESTMENT_CONFIG.minAmount} дуб. У тебя ${balance} дуб.`);
      return;
    }
    adminState[id] = { action: 'invest_new' };
    bot.sendMessage(id,
      `💰 НОВАЯ ИНВЕСТИЦИЯ\n\n` +
      `Введи данные в формате:\n` +
      `<сумма> <дни>\n\n` +
      `📊 Доступно: ${balance} дуб.\n` +
      `📈 Доходность: ${INVESTMENT_CONFIG.percentPerDay}% в день\n` +
      `📅 Срок: от ${INVESTMENT_CONFIG.minDays} до ${INVESTMENT_CONFIG.maxDays} дней\n` +
      `💰 Минимальная сумма: ${INVESTMENT_CONFIG.minAmount} дуб.\n` +
      `⚠️ При досрочном снятии штраф 50%\n\n` +
      `Пример: 1000 3`
    );
    return;
  }

  if (data === 'invest_withdraw') {
    if (!p.investments || p.investments.length === 0) {
      bot.sendMessage(id, `📊 У тебя нет активных инвестиций.`, investmentKeyboard());
      return;
    }
    let msg = '💸 ЗАБРАТЬ ИНВЕСТИЦИЮ\n\nВыбери номер инвестиции:\n\n';
    p.investments.forEach((inv, i) => {
      if (!inv.withdrawn) {
        const elapsed = Date.now() - inv.startTime;
        const days = elapsed / 86400000;
        const earned = Math.floor(inv.amount * (INVESTMENT_CONFIG.percentPerDay / 100) * days);
        msg += `${i+1}. ${inv.amount} дуб. (${inv.days} дн.) — прибыль ${earned} дуб.\n`;
      }
    });
    msg += `\nВведи номер инвестиции для вывода (или напиши "отмена" для отмены):`;
    adminState[id] = { action: 'invest_withdraw' };
    bot.sendMessage(id, msg);
    return;
  }

  if (data === 'invest_stats') {
    const allInvestments = Object.values(players).reduce((sum, p) => sum + (p.investments?.reduce((s, inv) => s + inv.amount, 0) || 0), 0);
    const activeInvestments = Object.values(players).reduce((sum, p) => sum + (p.investments?.filter(inv => !inv.withdrawn).length || 0), 0);
    bot.sendMessage(id,
      `📈 СТАТИСТИКА ИНВЕСТИЦИЙ:\n\n` +
      `💰 Всего вложено: ${allInvestments} дуб.\n` +
      `📊 Активных инвестиций: ${activeInvestments}\n` +
      `📈 Доходность: ${INVESTMENT_CONFIG.percentPerDay}% в день\n` +
      `📅 Максимальный срок: ${INVESTMENT_CONFIG.maxDays} дней`
    );
    return;
  }

  // ==================== ЛИМИТ СТАВОК ====================
  if (data === 'menu_limit') {
    const currentLimit = MAX_CLASSIC_BET + (p.limitUpgrades || 0) * 1000;
    const nextCost = LIMIT_UPGRADE_COST + (p.limitUpgrades || 0) * 500;
    const remaining = MAX_LIMIT_UPGRADES - (p.limitUpgrades || 0);

    bot.sendMessage(id,
      `⬆️ ЛИМИТ СТАВОК\n\n` +
      `📊 Текущий лимит: ${currentLimit} дуб.\n` +
      `⬆️ Улучшений: ${p.limitUpgrades || 0}/${MAX_LIMIT_UPGRADES}\n` +
      `💰 Стоимость следующего улучшения: ${nextCost} дуб.\n` +
      `📈 Следующий лимит: ${currentLimit + 1000} дуб.\n` +
      `⏳ Осталось улучшений: ${remaining}\n\n` +
      `Выбери действие:`,
      limitKeyboard()
    );
    return;
  }

  if (data === 'limit_my') {
    const currentLimit = MAX_CLASSIC_BET + (p.limitUpgrades || 0) * 1000;
    bot.sendMessage(id,
      `📊 ТВОЙ ЛИМИТ СТАВОК\n\n` +
      `💰 Текущий лимит: ${currentLimit} дуб.\n` +
      `⬆️ Улучшений: ${p.limitUpgrades || 0}/${MAX_LIMIT_UPGRADES}\n` +
      `📈 Следующий лимит: ${currentLimit + 1000} дуб.\n` +
      `💰 Стоимость улучшения: ${LIMIT_UPGRADE_COST + (p.limitUpgrades || 0) * 500} дуб.`,
      limitKeyboard()
    );
    return;
  }

  if (data === 'limit_upgrade') {
    const currentUpgrades = p.limitUpgrades || 0;
    if (currentUpgrades >= MAX_LIMIT_UPGRADES) {
      bot.answerCallbackQuery(query.id, { text: '❌ Ты достиг максимального лимита!' });
      return;
    }
    const cost = LIMIT_UPGRADE_COST + currentUpgrades * 500;
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < cost) {
      bot.answerCallbackQuery(query.id, { text: `❌ Не хватает. Нужно ${cost} дуб.` });
      return;
    }

    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - cost;
    } else {
      p.balance = safeNumber(p.balance) - cost;
    }
    p.limitUpgrades = currentUpgrades + 1;

    addHistory(id, `Увеличил лимит ставок до ${MAX_CLASSIC_BET + p.limitUpgrades * 1000} дуб.`);
    addBalanceHistory(id, -cost, `Увеличение лимита ставок`);
    saveData();

    bot.answerCallbackQuery(query.id, { text: '✅ Лимит увеличен!' });
    bot.sendMessage(id,
      `✅ ЛИМИТ УВЕЛИЧЕН!\n\n` +
      `💰 Новый лимит: ${MAX_CLASSIC_BET + p.limitUpgrades * 1000} дуб.\n` +
      `⬆️ Улучшений: ${p.limitUpgrades}/${MAX_LIMIT_UPGRADES}\n` +
      `📈 Следующий лимит: ${MAX_CLASSIC_BET + (p.limitUpgrades + 1) * 1000} дуб.`,
      mainInlineKeyboard()
    );
    return;
  }

  // ==================== ДОСТИЖЕНИЯ ====================
  if (data === 'menu_achievements') {
    bot.sendMessage(id, `🏆 ДОСТИЖЕНИЯ\n\nВыбери действие:`, achievementKeyboard());
    return;
  }

  if (data === 'ach_my') {
    const unlocked = p.achievements || [];
    if (unlocked.length === 0) {
      bot.sendMessage(id, `📋 У тебя пока нет достижений. Играй и зарабатывай их!`, achievementKeyboard());
      return;
    }
    let msg = '🏆 ТВОИ ДОСТИЖЕНИЯ:\n\n';
    let totalBonus = 0;
    for (let achId of unlocked) {
      const ach = ACHIEVEMENTS.find(a => a.id === achId);
      if (ach) {
        msg += `${ach.name} — ${ach.desc}\n`;
        msg += `   Бонус: +${ach.bonus}% к доходу\n\n`;
        totalBonus += ach.bonus;
      }
    }
    msg += `📈 Общий бонус: +${totalBonus}% к доходу`;
    bot.sendMessage(id, msg, achievementKeyboard());
    return;
  }

  if (data === 'ach_list') {
    const unlocked = p.achievements || [];
    let msg = '📋 ВСЕ ДОСТИЖЕНИЯ:\n\n';
    for (let ach of ACHIEVEMENTS) {
      const status = unlocked.includes(ach.id) ? '✅' : '🔒';
      msg += `${status} ${ach.name} — ${ach.desc}\n`;
      if (unlocked.includes(ach.id)) {
        msg += `   ✅ ПОЛУЧЕНО! Бонус: +${ach.bonus}%\n`;
      } else {
        msg += `   🔒 Не выполнено\n`;
      }
      msg += '\n';
    }
    bot.sendMessage(id, msg, achievementKeyboard());
    return;
  }

       // ==================== ДУЭЛЬ (ПРИНЯТИЕ) ====================
  if (data.startsWith('duel_accept_')) {
    try {
      console.log('🔥 ДУЭЛЬ: принятие вызова', data);
      const parts = data.split('_');
      const challengerId = parseInt(parts[2]);
      const amount = parseInt(parts[3]);

      console.log('  challengerId:', challengerId, 'amount:', amount, 'id:', id);

      if (isNaN(challengerId) || isNaN(amount)) {
        bot.sendMessage(id, '❌ Ошибка данных вызова.');
        return;
      }

      if (!duelChallenges[challengerId]) {
        bot.sendMessage(id, '❌ Вызов не найден или уже отменён.');
        return;
      }

      if (duelChallenges[challengerId].amount !== amount) {
        bot.sendMessage(id, '❌ Сумма вызова изменилась.');
        delete duelChallenges[challengerId];
        return;
      }

      if (challengerId === id) {
        bot.sendMessage(id, '❌ Нельзя принять свой вызов.');
        return;
      }

      const challenger = players[challengerId];
      if (!challenger) {
        bot.sendMessage(id, '❌ Игрок не найден.');
        delete duelChallenges[challengerId];
        return;
      }

      if (challenger.bet !== amount) {
        bot.sendMessage(id, '❌ Игрок отменил вызов.');
        delete duelChallenges[challengerId];
        challenger.bet = 0;
        saveData();
        return;
      }

      const challengerBalance = challenger.demoMode ? safeNumber(challenger.demoBalance) : safeNumber(challenger.balance);
      const playerBalance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);

      if (playerBalance < amount) {
        bot.sendMessage(id, `❌ Не хватает. У тебя ${playerBalance}`);
        return;
      }

      if (challengerBalance < amount) {
        bot.sendMessage(id, '❌ У соперника не хватает средств.');
        delete duelChallenges[challengerId];
        challenger.bet = 0;
        saveData();
        return;
      }

      delete duelChallenges[challengerId];

      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) - amount;
      } else {
        p.balance = safeNumber(p.balance) - amount;
      }

      if (challenger.demoMode) {
        challenger.demoBalance = safeNumber(challenger.demoBalance) - amount;
      } else {
        challenger.balance = safeNumber(challenger.balance) - amount;
      }

      const totalPot = amount * 2;
      const comm = Math.floor(totalPot * 0.1);
      bank.commission = safeNumber(bank.commission) + comm;
      bank.totalStakes = safeNumber(bank.totalStakes) + totalPot;
      const winAmount = totalPot - comm;

      bot.sendMessage(challengerId, `🎲 ТВОЙ БРОСОК!`);
      const dice1a = Math.floor(Math.random() * 6) + 1;
      const dice1b = Math.floor(Math.random() * 6) + 1;
      const sum1 = dice1a + dice1b;
      bot.sendDice(challengerId, { emoji: '🎲' }).catch(() => {});
      await sleep(1500);
      bot.sendMessage(challengerId, `🎲 ${dice1a}+${dice1b}=${sum1}`);

      bot.sendMessage(id, `🎲 ТВОЙ БРОСОК!`);
      const dice2a = Math.floor(Math.random() * 6) + 1;
      const dice2b = Math.floor(Math.random() * 6) + 1;
      const sum2 = dice2a + dice2b;
      bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
      await sleep(1500);
      bot.sendMessage(id, `🎲 ${dice2a}+${dice2b}=${sum2}`);

      let winnerId = null;
      if (sum1 > sum2) winnerId = challengerId;
      else if (sum2 > sum1) winnerId = id;

      if (winnerId) {
        const loserId = winnerId === challengerId ? id : challengerId;
        const winnerSum = winnerId === challengerId ? sum1 : sum2;
        const loserSum = winnerId === challengerId ? sum2 : sum1;

        if (players[winnerId].demoMode) {
          players[winnerId].demoBalance = safeNumber(players[winnerId].demoBalance) + winAmount;
        } else {
          players[winnerId].balance = safeNumber(players[winnerId].balance) + winAmount;
        }

        players[winnerId].duelStats.wins++;
        players[winnerId].duelStats.totalGames++;
        players[winnerId].totalEarned = safeNumber(players[winnerId].totalEarned) + winAmount;

        players[loserId].duelStats.losses++;
        players[loserId].duelStats.totalGames++;

        addHistory(winnerId, `Дуэль: победа +${winAmount} (${winnerSum} vs ${loserSum})`);
        addBalanceHistory(winnerId, winAmount, `Дуэль победа`);
        addHistory(loserId, `Дуэль: поражение -${amount} (${loserSum} vs ${winnerSum})`);
        addBalanceHistory(loserId, -amount, `Дуэль поражение`);

        const winnerBalance = players[winnerId].demoMode ? safeNumber(players[winnerId].demoBalance) : safeNumber(players[winnerId].balance);
        const loserBalance = players[loserId].demoMode ? safeNumber(players[loserId].demoBalance) : safeNumber(players[loserId].balance);

        bot.sendMessage(winnerId,
          `⚔️ ДУЭЛЬ: ПОБЕДА!\n\n` +
          `Твой бросок: ${winnerId === challengerId ? dice1a : dice2a}+${winnerId === challengerId ? dice1b : dice2b}=${winnerSum}\n` +
          `Соперник: ${winnerId === challengerId ? dice2a : dice1a}+${winnerId === challengerId ? dice2b : dice1b}=${loserSum}\n\n` +
          `💰 Ты выиграл ${winAmount} дублонов!\n` +
          `📊 Твой баланс: ${winnerBalance} дуб.`,
          mainInlineKeyboard()
        );

        bot.sendMessage(loserId,
          `⚔️ ДУЭЛЬ: ПОРАЖЕНИЕ!\n\n` +
          `Твой бросок: ${loserId === challengerId ? dice1a : dice2a}+${loserId === challengerId ? dice1b : dice2b}=${loserSum}\n` +
          `Соперник: ${loserId === challengerId ? dice2a : dice1a}+${loserId === challengerId ? dice2b : dice1b}=${winnerSum}\n\n` +
          `💸 Ты проиграл ${amount} дублонов.\n` +
          `📊 Твой баланс: ${loserBalance} дуб.`,
          mainInlineKeyboard()
        );
      } else {
        const half = Math.floor(winAmount / 2);

        if (players[challengerId].demoMode) {
          players[challengerId].demoBalance = safeNumber(players[challengerId].demoBalance) + half;
        } else {
          players[challengerId].balance = safeNumber(players[challengerId].balance) + half;
        }

        if (players[id].demoMode) {
          players[id].demoBalance = safeNumber(players[id].demoBalance) + half;
        } else {
          players[id].balance = safeNumber(players[id].balance) + half;
        }

        addHistory(challengerId, `Дуэль: ничья +${half} (${sum1} vs ${sum2})`);
        addBalanceHistory(challengerId, half, `Дуэль ничья`);
        addHistory(id, `Дуэль: ничья +${half} (${sum2} vs ${sum1})`);
        addBalanceHistory(id, half, `Дуэль ничья`);

        const challengerBalanceAfter = players[challengerId].demoMode ? safeNumber(players[challengerId].demoBalance) : safeNumber(players[challengerId].balance);
        const playerBalanceAfter = players[id].demoMode ? safeNumber(players[id].demoBalance) : safeNumber(players[id].balance);

        bot.sendMessage(challengerId,
          `⚔️ ДУЭЛЬ: НИЧЬЯ!\n\n` +
          `Твой бросок: ${dice1a}+${dice1b}=${sum1}\n` +
          `Соперник: ${dice2a}+${dice2b}=${sum2}\n\n` +
          `🤝 Каждый получил по ${half} дублонов.\n` +
          `📊 Твой баланс: ${challengerBalanceAfter} дуб.`,
          mainInlineKeyboard()
        );

      bot.sendMessage(id,
          `⚔️ ДУЭЛЬ: НИЧЬЯ!\n\n` +
          `Твой бросок: ${dice2a}+${dice2b}=${sum2}\n` +
          `Соперник: ${dice1a}+${dice1b}=${sum1}\n\n` +
          `🤝 Каждый получил по ${half} дублонов.\n` +
          `📊 Твой баланс: ${playerBalanceAfter} дуб.`,
          mainInlineKeyboard()
        );
      }

      challenger.bet = 0;
      p.bet = 0;
      saveData();

    } catch (error) {
      console.error('❌ ОШИБКА В ДУЭЛИ:', error);
      bot.sendMessage(id, '❌ Ошибка. Попробуйте ещё раз.');
      if (p && p.balance !== undefined) {
        if (p.demoMode) {
          p.demoBalance = safeNumber(p.demoBalance) + (amount || 0);
        } else {
          p.balance = safeNumber(p.balance) + (amount || 0);
        }
        saveData();
      }
    }
    return;
  }

  // ==================== ОТМЕНА ВЫЗОВА НА ДУЭЛЬ ====================
  if (data === 'duel_cancel') {
    if (!duelChallenges[id]) {
      bot.sendMessage(id, '❌ У тебя нет активного вызова.');
      return;
    }

    delete duelChallenges[id];

    if (p.bet > 0) {
      p.bet = 0;
      p.hasRolled = false;
      saveData();
    }

    bot.sendMessage(id, `✅ Ты отменил вызов на дуэль.`, mainInlineKeyboard());
    return;
  }

  if (data === 'duel_decline') {
    bot.sendMessage(id, `❌ Ты отказался от дуэли.`, mainInlineKeyboard());
    return;
  }

  // ==================== ГЛАВНОЕ МЕНЮ ====================
  if (data === 'menu_play') {
    if (!bank.roundActive) {
      bot.sendMessage(id, '⏳ Раунд не активен, подожди...');
      return;
    }
    bot.sendMessage(id, '🎲 Выбери режим игры:', gameModeKeyboard());
    return;
  }

  if (data === 'menu_back') {
    const rank = RANKS[p.rank];
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id,
      `🏴‍☠️ ЧЁРНАЯ КОСТЬ\n\n` +
      `Баланс: ${balance} дуб.\n` +
      `Ранг: ${rank.emoji} ${rank.name} (+${rank.bonus}% к выигрышу)\n` +
      `Доля: ${p.share}% банка\n` +
      `Джекпот: ${safeNumber(bank.jackpot)} | Банк: ${safeNumber(bank.pot)}\n` +
      `Пассивный доход: ${rank.passive} дуб./час`,
      mainInlineKeyboard()
    );
    return;
  }

  if (data === 'menu_profile') {
    const shareIncome = Math.floor(safeNumber(bank.totalStakes) * (p.share / 100));
    const adminMark = id === ADMIN_ID ? ' 👑 АДМИН' : '';
    const streak = p.dailyStreak || 0;
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id,
      `👤 ПИРАТСКИЙ ПАСПОРТ\n\n` +
      `Имя: ${p.username || 'Без имени'}${adminMark}\n` +
      `Ранг: ${RANKS[p.rank].emoji} ${RANKS[p.rank].name} (+${RANKS[p.rank].bonus}% к выигрышу)\n` +
      `Доля в банке: ${p.share}% (доход ${shareIncome} дуб./день)\n` +
      `Друзей приведено: ${p.refs?.length || 0}\n` +
      `Всего заработано: ${safeNumber(p.totalEarned)} дуб.\n` +
      `Баланс: ${balance} дуб.\n` +
      `Пассивный доход: ${safeNumber(p.passiveCollected)} дуб. накоплено\n` +
      `🔥 Серия дней: ${streak}`,
      profileInlineKeyboard()
    );
    return;
  }

  if (data === 'profile_balance') {
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id,
      `💰 Основной: ${balance}\n` +
      `🎮 Демо: ${safeNumber(p.demoBalance)} (осталось ${20 - (p.demoRollsToday || 0)} бросков)`,
      profileInlineKeyboard()
    );
    return;
  }

  if (data === 'profile_bonus') {
    const now = Date.now();
    const today = new Date().toDateString();

    if (p.lastDailyDate === today) {
      const left = 24 - Math.floor((now - new Date(today).getTime()) / 3600000);
      bot.sendMessage(id, `⏳ Бонус уже получен сегодня. Следующий через ${left} ч.`, profileInlineKeyboard());
      return;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    if (p.lastDailyDate === yesterdayStr) {
      p.dailyStreak = (p.dailyStreak || 0) + 1;
    } else {
      p.dailyStreak = 1;
    }

    const streak = p.dailyStreak || 1;
    let bonus = 5;
    if (streak >= 30) bonus = 100;
    else if (streak >= 14) bonus = 50;
    else if (streak >= 7) bonus = 25;
    else if (streak >= 3) bonus = 10;

    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) + bonus;
    } else {
      p.balance = safeNumber(p.balance) + bonus;
    }
    p.lastDailyDate = today;
    p.dailyStreak = streak;
    addHistory(id, `Ежедневный бонус: +${bonus} дуб. (серия ${streak} дней)`);
    addBalanceHistory(id, bonus, `Ежедневный бонус (серия ${streak})`);
    saveData();
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id,
      `🎁 Ежедневный бонус: +${bonus} дуб.!\n🔥 Серия: ${streak} дней подряд!\nБаланс: ${balance}`,
      profileInlineKeyboard()
    );
    return;
  }

  if (data === 'profile_referral') {
    const botInfo = await bot.getMe();
    const link = `https://t.me/${botInfo.username}?start=ref_${id}`;
    bot.sendMessage(id,
      `🔗 Твоя реф-ссылка:\n${link}\n\n` +
      `За каждого приведённого друга:\n` +
      `🎁 Ты получаешь 30 дуб.\n` +
      `🎁 Друг получаешь 15 дуб.\n\n` +
      `Друзей приведено: ${p.refs?.length || 0}`,
      profileInlineKeyboard()
    );
    return;
  }

  if (data === 'profile_stats') {
    const s = p.stats;
    const winRate = s.totalGames > 0 ? Math.round((s.wins / s.totalGames) * 100) : 0;
    const duel = p.duelStats;
    const duelRate = duel.totalGames > 0 ? Math.round((duel.wins / duel.totalGames) * 100) : 0;
    const vip = p.vipStats;
    const vipRate = vip.totalGames > 0 ? Math.round((vip.wins / vip.totalGames) * 100) : 0;
    bot.sendMessage(id,
      `📊 ТВОЯ СТАТИСТИКА:\n\n` +
      `🎲 Классика:\n` +
      `  Игр: ${s.totalGames}, Побед: ${s.wins} (${winRate}%)\n` +
      `  Лучшая серия: ${s.maxStreak}\n\n` +
      `⚔️ Дуэль:\n` +
      `  Игр: ${duel.totalGames}, Побед: ${duel.wins} (${duelRate}%)\n\n` +
      `👑 VIP:\n` +
      `  Игр: ${vip.totalGames}, Побед: ${vip.wins} (${vipRate}%)`,
      profileInlineKeyboard()
    );
    return;
  }

       // ==================== ПРОДОЛЖЕНИЕ CALLBACK_QUERY (ПРОФИЛЬ, ВЫВОД, БАНК, ТОП, РАНГИ, ДОЛЯ, СУНДУК, ПОДАРКИ, ДОХОД, ДЕМО, ПОМОЩЬ, ИГРОВЫЕ ДЕЙСТВИЯ) ====================

  if (data === 'profile_withdraw') {
    if (p.demoMode) {
      bot.sendMessage(id, '❌ В демо-режиме вывод недоступен.');
      return;
    }
    if (safeNumber(bank.pot) < MIN_BANK) {
      bot.sendMessage(id, `❌ Банк меньше ${MIN_BANK} дуб. Вывод недоступен.`);
      return;
    }
    const hasPurchased = safeNumber(p.totalEarned) > 0;
    if (!hasPurchased && p.rank < 2) {
      bot.sendMessage(id, '❌ Вывод доступен только после покупки дублонов (от 500 дуб.) или ранга Капитан.');
      return;
    }
    const maxWithdraw = Math.floor(Math.min(safeNumber(p.balance) * MAX_WITHDRAW_PERCENT, MAX_WITHDRAW_DAILY));
    if (maxWithdraw < MIN_WITHDRAW) {
      bot.sendMessage(id, `❌ Минимальный вывод ${MIN_WITHDRAW} дуб. Доступно ${maxWithdraw} дуб.`);
      return;
    }
    bot.sendMessage(id,
      `💸 Выбери сумму вывода (мин ${MIN_WITHDRAW}, макс ${maxWithdraw}):\n` +
      `Баланс: ${safeNumber(p.balance)} дуб.\n` +
      `Доступно сегодня: ${maxWithdraw} дуб. (комиссия 10%)`,
      withdrawInlineKeyboard()
    );
    return;
  }

  if (data === 'profile_withdraw_history') {
    if (!p.withdrawHistory || p.withdrawHistory.length === 0) {
      bot.sendMessage(id, '📋 У тебя нет истории выводов.');
      return;
    }
    let msg = '📋 ИСТОРИЯ ВЫВОДОВ:\n\n';
    p.withdrawHistory.slice(-10).forEach(w => {
      const status = w.status === 'ожидание' ? '⏳' : '✅';
      msg += `${status} ${w.amount} дуб. (ком. ${w.fee}) — ${new Date(w.date).toLocaleDateString()}\n`;
    });
    bot.sendMessage(id, msg, profileInlineKeyboard());
    return;
  }

  if (data === 'menu_bank') {
    const totalShares = Object.values(players).reduce((sum, p) => sum + (p.share || 0), 0);
    bot.sendMessage(id,
      `💰 БАНК ПИРАТОВ\n\n` +
      `Банк раунда: ${safeNumber(bank.pot)} дуб.\n` +
      `Джекпот: ${safeNumber(bank.jackpot)} дуб.\n` +
      `Всего ставок: ${safeNumber(bank.totalStakes)} дуб.\n` +
      `Общая доля игроков: ${totalShares}%\n` +
      `🎯 Точки до джекпота: ${Math.max(0, 10 - (Number(jackpotCounter) || 0))}`,
      mainInlineKeyboard()
    );
    return;
  }

  if (data === 'menu_top') {
    const sorted = Object.entries(players)
      .sort((a, b) => {
        const balA = a[1].demoMode ? safeNumber(a[1].demoBalance) : safeNumber(a[1].balance);
        const balB = b[1].demoMode ? safeNumber(b[1].demoBalance) : safeNumber(b[1].balance);
        return balB - balA;
      })
      .slice(0, 10);
    let msgText = '🏆 ТОП-10 ПО БАЛАНСУ:\n\n';
    sorted.forEach(([id, data], i) => {
      const rank = RANKS[data.rank]?.emoji || '🪵';
      const adminMark = parseInt(id) === ADMIN_ID ? ' 👑' : '';
      const balance = data.demoMode ? safeNumber(data.demoBalance) : safeNumber(data.balance);
      msgText += `${i+1}. ${rank} ${data.username || id.substr(-4)}${adminMark} — ${balance} дуб.\n`;
    });
    bot.sendMessage(id, msgText, mainInlineKeyboard());
    return;
  }

  if (data === 'menu_rank') {
    let msg = '🏴‍☠️ ВСЕ РАНГИ ПИРАТОВ:\n\n';
    for (let i = 0; i < RANKS.length; i++) {
      const r = RANKS[i];
      const isCurrent = i === p.rank;
      const isUnlocked = i <= p.rank;
      const status = isCurrent ? ' ✅ ТЕКУЩИЙ' : (isUnlocked ? ' ✅ ДОСТУПЕН' : ' 🔒 ЗАКРЫТ');
      msg += `${r.emoji} ${r.name} — ${r.costDublons} дуб.\n`;
      msg += `   Бонус: +${r.bonus}% | Пассив: ${r.passive} дуб./час${status}\n\n`;
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    msg += `\n💰 Твой баланс: ${balance} дуб.\n`;
    msg += `📤 Твой текущий ранг: ${RANKS[p.rank].emoji} ${RANKS[p.rank].name}\n\n`;
    msg += `Выбери ранг для покупки (доступны только открытые):`;
    bot.sendMessage(id, msg, rankInlineKeyboard());
    return;
  }

  if (data.startsWith('rank_')) {
    const rankIdx = parseInt(data.split('_')[1]);
    const r = RANKS[rankIdx];
    if (rankIdx <= p.rank) {
      bot.sendMessage(id, '❌ У тебя уже есть этот ранг или выше.');
      return;
    }
    if (rankIdx > p.rank + 1) {
      bot.sendMessage(id, `❌ Сначала купи предыдущий ранг: ${RANKS[rankIdx-1].emoji} ${RANKS[rankIdx-1].name}`);
      return;
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < r.costDublons) {
      bot.sendMessage(id, `❌ Не хватает. Нужно ${r.costDublons} дуб.`);
      return;
    }
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - r.costDublons;
    } else {
      p.balance = safeNumber(p.balance) - r.costDublons;
    }
    p.rank = rankIdx;
    addHistory(id, `Купил ранг ${r.name} за ${r.costDublons} дуб.`);
    addBalanceHistory(id, -r.costDublons, `Покупка ранга ${r.name}`);
    saveData();
    bot.sendMessage(id, `✅ Поздравляю! Ты получил ранг ${r.emoji} ${r.name}!`, mainInlineKeyboard());
    return;
  }

  if (data === 'menu_topup') {
    bot.sendMessage(id,
      `💳 ПОПОЛНЕНИЕ БАЛАНСА\n\n` +
      `Курс: 1 дублон = 0.5 ₽\n\n` +
      `Переведи нужную сумму на карту:\n` +
      `❗️ 4100 1173 5261 4250\n` +
      `❗️ Юрий Игоревич В.\n\n` +
      `В назначении укажи: ПОПОЛНЕНИЕ + ${id}\n` +
      `После перевода напиши админу в ЛС: @magistryu\n` +
      `Баланс будет пополнен в течение 24 часов.`,
      mainInlineKeyboard()
    );
    return;
  }

  if (data === 'menu_share') {
    const shareIncome = Math.floor(safeNumber(bank.totalStakes) * (p.share / 100));
    bot.sendMessage(id,
      `📈 ТВОЯ ДОЛЯ В БАНКЕ: ${p.share}%\n` +
      `Доход от доли: ${shareIncome} дуб./день\n\n` +
      `Купи долю в банке за РЕАЛЬНЫЕ ДЕНЬГИ и получай пассивный доход!\n` +
      `Доля даёт % от всех ставок в банке.\n\n` +
      `Доступные доли:`,
      shareInlineKeyboard()
    );
    return;
  }

  if (data.startsWith('share_') && !data.startsWith('share_sell')) {
    const percent = parseInt(data.split('_')[1]);
    const share = SHARES.find(s => s.percent === percent);
    if (!share) return;
    bot.sendMessage(id,
      `💳 ПОКУПКА ДОЛИ ${share.percent}%\n\n` +
      `Стоимость: ${share.costRub} ₽\n\n` +
      `Переведи на карту:\n` +
      `❗️ 4100 1173 5261 4250\n` +
      `❗️ Юрий Игоревич В.\n\n` +
      `В назначении укажи: ДОЛЯ ${share.percent}% + ${id}\n` +
      `После оплаты напиши админу: @magistryu\n` +
      `Доля будет активирована в течение 24 часов.`,
      mainInlineKeyboard()
    );
    return;
  }

  if (data === 'share_sell') {
    if (p.share <= 0) {
      bot.sendMessage(id, '❌ У тебя нет доли для продажи.');
      return;
    }
    const shareObj = SHARES.find(s => s.percent === p.share);
    if (!shareObj) {
      bot.sendMessage(id, '❌ Не удалось найти стоимость доли.');
      return;
    }
    const sellPrice = Math.floor(shareObj.costRub * 0.7);
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) + sellPrice;
    } else {
      p.balance = safeNumber(p.balance) + sellPrice;
    }
    const soldShare = p.share;
    p.share = 0;
    addHistory(id, `Продал долю ${soldShare}% за ${sellPrice} дуб.`);
    addBalanceHistory(id, sellPrice, `Продажа доли ${soldShare}%`);
    saveData();
    bot.sendMessage(id, `✅ Ты продал долю ${soldShare}% за ${sellPrice} дуб.`, mainInlineKeyboard());
    return;
  }

         // ==================== ПОДПОЛЬНАЯ ЛАВКА (СУНДУК 2.0) ====================
  if (data === 'menu_sunduk') {
    if (p.rank < 2) {
      bot.sendMessage(id, '❌ Сундук доступен только с ранга Капитан (или выше).');
      return;
    }

    if (!sundukStats[id]) sundukStats[id] = { opened: 0, wins: 0, bestWin: 0, streak: 0 };

    const today = new Date().toDateString();
    const freeAvailable = freeSundukUsed[id] !== today;

    bot.sendMessage(id,
      `⚔️ ПОДПОЛЬНАЯ ЛАВКА\n\n` +
      `💰 Выбери уровень риска:\n\n` +
      `🟢 Низкий — риск 10% (50-200 дуб.)\n` +
      `🟡 Средний — риск 30% (200-1000 дуб.)\n` +
      `🔴 Высокий — риск 60% (1000-5000 дуб.)\n` +
      `⚫ Экстремальный — риск 90% (5000-25000 дуб.)\n\n` +
      `🎁 ${freeAvailable ? '✅ Доступен бесплатный сундук (1 раз в день)!' : '⏳ Бесплатный сундук уже использован'}\n\n` +
      `📊 Твоя статистика: ${sundukStats[id].opened} открытий, ${sundukStats[id].wins} побед`,
      sundukInlineKeyboard()
    );
    return;
  }

  if (data.startsWith('sunduk_') && data !== 'sunduk_stats' && data !== 'sunduk_free') {
    const levelId = parseInt(data.split('_')[1]);
    const level = SUNDUK_LEVELS.find(l => l.id === levelId);
    if (!level) return;

    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < level.minCost) {
      bot.sendMessage(id, `❌ Минимальная цена для этого уровня ${level.minCost} дуб.`);
      return;
    }

    const cost = Math.floor(Math.random() * (level.maxCost - level.minCost + 1)) + level.minCost;
    if (balance < cost) {
      bot.sendMessage(id, `❌ Не хватает. Нужно ${cost} дуб.`);
      return;
    }

    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - cost;
    } else {
      p.balance = safeNumber(p.balance) - cost;
    }

    // ===== АНИМАЦИЯ =====
    bot.sendMessage(id, `🎲 Сундук открывается...`);
    await sleep(800);
    bot.sendMessage(id, `🎲 ...`);
    await sleep(800);
    bot.sendMessage(id, `🎲 ...РЕЗУЛЬТАТ!`);
    await sleep(500);

    const rand = Math.random() * 100;
    const isWin = rand < level.winChance;

    let reward = 0;
    let resultText = '';
    let emoji = '';
    let isJackpot = false;

    if (isWin) {
      const multiplier = (Math.random() * (level.maxWin - level.minWin) + level.minWin);
      reward = Math.floor(cost * multiplier);

      if (Math.random() < 0.01) {
        reward = Math.floor(cost * 50);
        isJackpot = true;
        emoji = '🎰';
      } else {
        emoji = '🎉';
      }

      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + reward;
      } else {
        p.balance = safeNumber(p.balance) + reward;
      }

      p.sundukWins = (p.sundukWins || 0) + 1;
      p.sundukStreak = (p.sundukStreak || 0) + 1;
      if (reward > (p.sundukBestWin || 0)) p.sundukBestWin = reward;

      resultText = `🎉 ТЫ ВЫИГРАЛ ${reward} дуб. (x${multiplier.toFixed(1)})!`;

      if (reward > 10000) {
        for (let pid in players) {
          if (players[pid].balance > 0 || players[pid].demoBalance > 0) {
            bot.sendMessage(pid,
              `🎰 ${emoji} ИГРОК @${p.username || id} ВЫИГРАЛ ${reward} ДУБ. В ПОДПОЛЬНОЙ ЛАВКЕ!`
            ).catch(() => {});
          }
        }
      }
    } else {
      const consolation = Math.floor(cost * (level.consolation / 100));
      if (consolation > 0) {
        if (p.demoMode) {
          p.demoBalance = safeNumber(p.demoBalance) + consolation;
        } else {
          p.balance = safeNumber(p.balance) + consolation;
        }
        reward = consolation;
        resultText = `💀 Не повезло... Но ты получаешь утешительный приз ${consolation} дуб.`;
      } else {
        resultText = `💀 Не повезло... Ты проиграл ${cost} дуб.`;
      }
      p.sundukStreak = 0;
    }

    p.sundukOpened = (p.sundukOpened || 0) + 1;

    if (p.sundukStreak <= -10 && Math.random() < 0.3) {
      const jackpotBonus = Math.floor(cost * 10);
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + jackpotBonus;
      } else {
        p.balance = safeNumber(p.balance) + jackpotBonus;
      }
      bot.sendMessage(id, `🔥 ДЖЕКПОТ-СУНДУК! За 10 проигрышей подряд ты получаешь ${jackpotBonus} дуб.`);
      p.sundukStreak = 0;
    }

    addHistory(id, `Подпольная лавка: ${isWin ? 'Победа' : 'Поражение'} (уровень ${level.name}, цена ${cost})`);
    addBalanceHistory(id, isWin ? reward : -cost, `Подпольная лавка: ${level.name}`);
    saveData();

    const balanceAfter = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id,
      `⚔️ ПОДПОЛЬНАЯ ЛАВКА\n\n` +
      `💰 Уровень: ${level.name}\n` +
      `💸 Снято: ${cost} дуб.\n` +
      `${resultText}\n` +
      `${isJackpot ? '🎰 ДЖЕКПОТ! x50 от ставки!\n' : ''}\n` +
      `📊 Твой баланс: ${balanceAfter} дуб.\n` +
      `📈 Статистика: ${p.sundukOpened} открытий, ${p.sundukWins} побед, лучший выигрыш: ${p.sundukBestWin || 0} дуб.`,
      mainInlineKeyboard()
    );
    return;
  }

  if (data === 'sunduk_free') {
    const today = new Date().toDateString();
    if (freeSundukUsed[id] === today) {
      bot.sendMessage(id, '❌ Ты уже использовал бесплатный сундук сегодня.');
      return;
    }

    const level = SUNDUK_LEVELS[0];
    const rand = Math.random() * 100;
    const isWin = rand < level.winChance;
    let reward = 0;

    if (isWin) {
      const multiplier = (Math.random() * (level.maxWin - level.minWin) + level.minWin);
      reward = Math.floor(50 * multiplier);
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + reward;
      } else {
        p.balance = safeNumber(p.balance) + reward;
      }
      p.sundukWins = (p.sundukWins || 0) + 1;
    } else {
      reward = 0;
    }

    p.sundukOpened = (p.sundukOpened || 0) + 1;
    freeSundukUsed[id] = today;
    saveData();

    bot.sendMessage(id,
      `🎁 БЕСПЛАТНЫЙ СУНДУК\n\n` +
      `${isWin ? `🎉 Ты выиграл ${reward} дуб.!` : '😔 Не повезло... Но завтра будет новый шанс!'}\n` +
      `📊 Баланс: ${p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance)} дуб.`,
      mainInlineKeyboard()
    );
    return;
  }

  if (data === 'sunduk_stats') {
    const stats = sundukStats[id] || { opened: 0, wins: 0, bestWin: 0, streak: 0 };
    const winRate = stats.opened > 0 ? Math.round((stats.wins / stats.opened) * 100) : 0;
    bot.sendMessage(id,
      `📊 МОЯ СТАТИСТИКА В ПОДПОЛЬНОЙ ЛАВКЕ:\n\n` +
      `📦 Открыто сундуков: ${stats.opened}\n` +
      `🏆 Побед: ${stats.wins}\n` +
      `📈 Процент побед: ${winRate}%\n` +
      `💰 Лучший выигрыш: ${stats.bestWin || 0} дуб.\n` +
      `🔥 Текущая серия: ${stats.streak || 0}`,
      mainInlineKeyboard()
    );
    return;
                    }
   // ==================== ПОДАРКИ ====================
  if (data === 'menu_gifts') {
    bot.sendMessage(id, `💝 ПОДАРКИ\n\nВыбери действие:`, giftKeyboard());
    return;
  }

  if (data === 'gift_send') {
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < 10) {
      bot.sendMessage(id, '❌ Минимальный подарок 10 дуб.');
      return;
    }
    adminState[id] = { action: 'gift_send' };
    bot.sendMessage(id,
      `💝 ОТПРАВКА ПОДАРКА\n\n` +
      `Введи данные в формате:\n` +
      `<ID игрока> <сумма>\n\n` +
      `Пример: 6301554862 100\n\n` +
      `💰 Комиссия: 5% от суммы (минимальный подарок 10 дуб.)\n` +
      `📊 Твой баланс: ${balance} дуб.`
    );
    return;
  }

  if (data === 'gift_history') {
    if (!p.giftHistory || p.giftHistory.length === 0) {
      bot.sendMessage(id, `📋 У тебя нет истории подарков.`, giftKeyboard());
      return;
    }
    let msg = '💝 ИСТОРИЯ ПОДАРКОВ:\n\n';
    p.giftHistory.slice(-15).forEach(g => {
      const type = g.type === 'sent' ? '📤 Отправлено' : '📥 Получено';
      msg += `${type}: ${g.amount} дуб. ${g.type === 'sent' ? '→' : '←'} ${g.username || g.id}\n`;
    });
    bot.sendMessage(id, msg, giftKeyboard());
    return;
  }

  // ==================== ДОХОД ====================
  if (data === 'menu_income') {
    const passivePerHour = RANKS[p.rank].passive;
    const now = Date.now();
    const elapsedMs = now - p.lastPassiveTime;
    const nextHourMs = 3600000 - (elapsedMs % 3600000);
    const nextHourMinutes = Math.ceil(nextHourMs / 60000);
    const shareIncome = Math.floor(safeNumber(bank.totalStakes) * (p.share / 100));

    let msg = `🌊 ПАССИВНЫЙ ДОХОД\n\n`;
    msg += `Твой доход от ранга: ${passivePerHour} дуб./час\n`;
    msg += `Твой доход от доли: ${shareIncome} дуб./день\n`;
    msg += `⏳ Следующий доход через: ${nextHourMinutes} мин.\n`;
    msg += `📦 Накоплено сейчас: ${safeNumber(p.passiveCollected)} дуб.\n`;
    if (safeNumber(p.passiveCollected) > 0) {
      msg += `\n✅ У тебя есть ${safeNumber(p.passiveCollected)} дуб. готовых к сбору!`;
    } else {
      msg += `\n⏳ Пока нет дохода для сбора.`;
    }
    bot.sendMessage(id, msg, collectInlineKeyboard());
    return;
  }

  if (data === 'collect_take') {
    if (safeNumber(p.passiveCollected) <= 0) {
      bot.sendMessage(id, '❌ Нет дохода для сбора.');
      return;
    }
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) + safeNumber(p.passiveCollected);
    } else {
      p.balance = safeNumber(p.balance) + safeNumber(p.passiveCollected);
    }
    p.totalEarned = safeNumber(p.totalEarned) + safeNumber(p.passiveCollected);
    addHistory(id, `Собрал пассивный доход: +${safeNumber(p.passiveCollected)} дуб.`);
    addBalanceHistory(id, safeNumber(p.passiveCollected), 'Сбор пассивного дохода');
    p.passiveCollected = 0;
    saveData();
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id, `💰 Ты собрал доход! Баланс: ${balance} дуб.`, mainInlineKeyboard());
    return;
  }

  // ==================== ДЕМО ====================
  if (data === 'menu_demo') {
    p.demoMode = !p.demoMode;
    if (p.demoMode) {
      if (p.demoDate !== new Date().toDateString()) {
        p.demoRollsToday = 0;
        p.demoDate = new Date().toDateString();
      }
      saveData();
      bot.sendMessage(id,
        `🎮 Демо-режим ВКЛЮЧЁН\nБаланс: ${safeNumber(p.demoBalance)} (осталось ${20 - (p.demoRollsToday || 0)} бросков)`,
        mainInlineKeyboard()
      );
    } else {
      saveData();
      bot.sendMessage(id, `🎮 Демо-режим ВЫКЛЮЧЁН`, mainInlineKeyboard());
    }
    return;
  }

  // ==================== ПОМОЩЬ ====================
  if (data === 'menu_help') {
    bot.sendMessage(id,
      `🏴‍☠️ ДОБРО ПОЖАЛОВАТЬ В ЧЁРНУЮ КОСТЬ!\n\n` +
      `Это пиратская игра на дублоны. Зарабатывай, повышай ранг, покупай долю в банке и выводи деньги!\n\n` +
      `📖 КАК ИГРАТЬ:\n` +
      `1. Нажми «🎰 Играть» и выбери режим:\n` +
      `   • 🎲 Классика — бросок против банка\n` +
      `   • ⚔️ Дуэль — против другого игрока\n` +
      `   • 👑 VIP — против админа (только за деньги)\n` +
      `   • 🎴 Блэкджек — против дилера (карты)\n` +
      `2. Введи сумму ставки и нажми «Бросить»\n` +
      `3. Если выпала точка — можешь удвоить или забрать\n\n` +
      `🏴‍☠️ КАК ЗАРАБОТАТЬ:\n` +
      `• Повышай ранг → получаешь пассивный доход\n` +
      `• Покупай долю в банке → доход от всех ставок\n` +
      `• Забирай ежедневный бонус\n` +
      `• Приводи друзей → +30 дуб. за каждого\n` +
      `• Купи корабли в «Пиратском флоте» → пассивный доход\n` +
      `• Участвуй в еженедельных турнирах → крупные призы\n\n` +
      `💡 СОВЕТЫ:\n` +
      `• Начни с Классики — риск минимален\n` +
      `• Копи дублоны на ранг «Капитан» — он открывает Сундук\n` +
      `• Дуэль выгоднее, чем Классика (комиссия 10% против 25%)\n` +
      `• Доля в банке окупается через 2-3 недели\n` +
      `• Блэкджек — лучший способ быстро заработать, но риск выше\n\n` +
      `⚔️ ПОЧЕМУ ДУЭЛЬ ЛУЧШЕ:\n` +
      `• Комиссия всего 10% (против 25% в Классике)\n` +
      `• Ты играешь против реального игрока, а не против банка\n` +
      `• Можно играть на реальные деньги\n` +
      `• Это честно и азартно\n\n` +
      `🚢 ПИРАТСКИЙ ФЛОТ:\n` +
      `• Купи корабль → получай доход каждый час\n` +
      `• Улучшай корабли → доход растёт\n` +
      `• 20 кораблей от 5000 до 50 000 000 дуб.\n\n` +
      `⚔️ ТУРНИРЫ:\n` +
      `• Каждое воскресенье\n` +
      `• Вход 2000 дуб.\n` +
      `• Призовой фонд: 70% игрокам, 30% админу\n` +
      `• Победитель получает 50% фонда\n\n` +
      `💰 ВЫВОД:\n` +
      `• Мин. сумма: ${MIN_WITHDRAW} дуб.\n` +
      `• Комиссия: 10%\n` +
      `• Лимит: ${MAX_WITHDRAW_DAILY} дуб./сутки\n` +
      `• Доступен при банке > ${MIN_BANK} дуб.\n\n` +
      `❓ Вопросы? Пиши админу: @magistryu`,
      mainInlineKeyboard()
    );
    return;
  }

  // ==================== ВЫВОД ====================
  if (data.startsWith('withdraw_')) {
    const amount = parseInt(data.split('_')[1]);
    if (isNaN(amount)) return;
    if (p.demoMode) {
      bot.sendMessage(id, '❌ В демо-режиме вывод недоступен.');
      return;
    }
    if (safeNumber(p.balance) < amount) {
      bot.sendMessage(id, `❌ Не хватает. У тебя ${safeNumber(p.balance)} дуб.`);
      return;
    }
    const maxWithdraw = Math.floor(Math.min(safeNumber(p.balance) * MAX_WITHDRAW_PERCENT, MAX_WITHDRAW_DAILY));
    if (amount > maxWithdraw) {
      bot.sendMessage(id, `❌ Можно вывести не более ${maxWithdraw} дуб.`);
      return;
    }

    const withdrawFee = Math.floor(amount * 0.1);
    const finalAmount = amount - withdrawFee;
    if (finalAmount < 1) {
      bot.sendMessage(id, '❌ Сумма слишком мала после комиссии.');
      return;
    }

  const today = new Date().toDateString();
    if (p.withdrawDate !== today) { p.withdrawToday = 0; p.withdrawDate = today; }
    if ((p.withdrawToday || 0) + amount > MAX_WITHDRAW_DAILY) {
      bot.sendMessage(id, `❌ Лимит ${MAX_WITHDRAW_DAILY} дуб./сутки. Осталось: ${MAX_WITHDRAW_DAILY - (p.withdrawToday || 0)}`);
      return;
    }
    p.balance = safeNumber(p.balance) - amount;
    p.withdrawToday += amount;
    bank.commission = safeNumber(bank.commission) + withdrawFee;
    withdrawQueue.push({ id, amount: finalAmount, username: p.username, time: Date.now() });
    if (!p.withdrawHistory) p.withdrawHistory = [];
    p.withdrawHistory.push({ amount: finalAmount, fee: withdrawFee, date: new Date().toISOString(), status: 'ожидание' });
    addHistory(id, `Запрос вывода ${finalAmount} (комиссия ${withdrawFee})`);
    addBalanceHistory(id, -amount, `Запрос вывода ${finalAmount} (комиссия ${withdrawFee})`);
    saveData();
    bot.sendMessage(id,
      `✅ Запрос на ${finalAmount} дублонов принят (комиссия ${withdrawFee} дуб.).\nОжидай подтверждения.`,
      mainInlineKeyboard()
    );
    bot.sendMessage(ADMIN_ID, `📤 ВЫВОД: @${p.username || id} — ${finalAmount} дуб. (комиссия ${withdrawFee}). Очередь: ${withdrawQueue.length}`);
    return;
  }

  // ==================== РЕЖИМЫ ИГРЫ ====================
  if (data === 'mode_classic') {
    p.currentMode = '🎲 Классика';
    saveData();
    bot.sendMessage(id,
      `🎲 Выбран режим: Классика\nВведи сумму ставки (минимум 1 дублон):`,
      gameActionsKeyboard()
    );
    return;
  }

  if (data === 'mode_duel') {
    p.currentMode = '⚔️ Дуэль';
    saveData();
    bot.sendMessage(id,
      `⚔️ Выбери валюту для дуэли:`,
      duelCurrencyKeyboard()
    );
    return;
  }

  if (data === 'mode_vip') {
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < MIN_VIP_BET) {
      bot.sendMessage(id, `❌ Для VIP нужно минимум ${MIN_VIP_BET} дуб.`);
      return;
    }
    p.currentMode = '👑 VIP-игра';
    saveData();
    bot.sendMessage(id,
      `👑 VIP-игра (только за деньги)\nВведи сумму в ₽ (от ${MIN_VIP_BET} до ${MAX_VIP_BET}):`,
      gameActionsKeyboard()
    );
    return;
                            }
  if (data === 'duel_currency_dublons' || data === 'duel_currency_money') {
    p.duelCurrency = data === 'duel_currency_dublons' ? '💵 Дублоны' : '💰 Реальные деньги';
    saveData();
    const currencyName = p.duelCurrency === '💵 Дублоны' ? 'дублоны' : 'реальные деньги (₽)';
    bot.sendMessage(id,
      `⚔️ Валюта: ${p.duelCurrency}\nВведи сумму ставки (минимум 1 ${currencyName === 'дублоны' ? 'дублон' : '₽'}):`,
      gameActionsKeyboard()
    );
    return;
  }

  // ==================== ИГРОВЫЕ ДЕЙСТВИЯ ====================
  if (data === 'game_roll') {
    try {
      const fakeMsg = { chat: { id: id }, text: '🎲 Бросить', from: { id: id } };
      bot.emit('message', fakeMsg);
    } catch (e) {
      console.error('❌ Ошибка при эмуляции броска:', e);
      bot.sendMessage(id, '❌ Произошла ошибка. Попробуй ещё раз.', mainInlineKeyboard());
    }
    return;
  }

  if (data === 'game_double') {
    if (p.currentMode !== '🎲 Классика') {
      bot.sendMessage(id, '❌ Удвоение только в режиме Классика.');
      return;
    }
    if (!p.canDouble || p.bet <= 0) {
      bot.sendMessage(id, '❌ Нет активной точки.');
      return;
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < p.bet) {
      bot.sendMessage(id, `❌ Не хватает. Нужно ${p.bet}`);
      return;
    }
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - p.bet;
    } else {
      p.balance = safeNumber(p.balance) - p.bet;
    }
    const oldBet = p.bet;
    p.bet = oldBet * 2;
    p.canDouble = false;
    p.hasRolled = false;
    const comm = Math.floor(oldBet * COMMISSION_PERCENT);
    bank.commission = safeNumber(bank.commission) + comm;
    bank.pot = safeNumber(bank.pot) + (oldBet - comm);
    addHistory(id, `Удвоение до ${p.bet}`);
    addBalanceHistory(id, -oldBet, `Удвоение ставки до ${p.bet}`);
    saveData();
    bot.sendMessage(id, `⚡ Ставка УДВОЕНА до ${p.bet}. Нажми 🎲 Бросить`, gameActionsKeyboard());
    return;
  }

  if (data === 'game_take') {
    if (!p.canDouble || p.bet <= 0) {
      bot.sendMessage(id, '❌ Нет активной точки.');
      return;
    }
    const takenBet = p.bet;
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) + takenBet;
    } else {
      p.balance = safeNumber(p.balance) + takenBet;
    }
    p.bet = 0;
    p.canDouble = false;
    p.point = 0;
    p.stats.streak = 0;
    addHistory(id, `Забрал ставку ${takenBet}`);
    addBalanceHistory(id, takenBet, 'Забрал ставку при точке');
    saveData();
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id, `✅ Забрал ставку ${takenBet} дуб. Баланс: ${balance}`, mainInlineKeyboard());
    return;
  }
});

// ==================== ОБРАБОТЧИК СООБЩЕНИЙ ====================
bot.on('message', async (msg) => {
  console.log('✅ ОБРАБОТЧИК СООБЩЕНИЙ ЗАРЕГИСТРИРОВАН');
  if (!msg.text) return;
  console.log('📥 СООБЩЕНИЕ ПОЛУЧЕНО:', msg.text);
  const id = msg.chat.id;
  const text = msg.text;

  if (isFlood(id)) return;

  const p = getPlayer(id);
  if (!p) return;

  // ===== ПРОВЕРКА АКТИВНОСТИ ПОЛЬЗОВАТЕЛЯ =====
  const lastActivity = p.lastActivity || 0;
  if (Date.now() - lastActivity > 600000) {
    bot.sendMessage(id, '🏴‍☠️ Добро пожаловать обратно!');
  }
  p.lastActivity = Date.now();

  // ===== ПРОВЕРКА ТЕХНИЧЕСКИХ РАБОТ =====
  if (isMaintenanceActive()) {
    const timeLeft = Math.max(0, Math.ceil((maintenanceEndTime - Date.now()) / 60000));
    return bot.sendMessage(id,
      `🔧 БОТ НА ТЕХНИЧЕСКИХ РАБОТАХ\n\n` +
      `${maintenanceMessage}\n` +
      `⏳ Осталось примерно: ${timeLeft} минут\n` +
      `Приносим извинения за неудобства! 🙏`
    );
  }

  if (safeNumber(bank.pot) < 1000 && safeNumber(bank.commission) > 0) {
    const refill = Math.min(safeNumber(bank.commission), 500);
    bank.pot = safeNumber(bank.pot) + refill;
    bank.commission = safeNumber(bank.commission) - refill;
    console.log(`🔄 Банк пополнен на ${refill} из комиссии.`);
    saveData();
  }

  const now = Date.now();
  const rank = RANKS[p.rank];
  if (now - p.lastPassiveTime > 3600000) {
    const hours = Math.floor((now - p.lastPassiveTime) / 3600000);
    const rankBonus = rank.passive * hours;
    const shareBonus = Math.floor((safeNumber(bank.totalStakes) * (p.share / 100)) / 24) * hours;
    const totalBonus = rankBonus + shareBonus;
    if (totalBonus > 0) {
      p.passiveCollected = safeNumber(p.passiveCollected) + totalBonus;
      p.lastPassiveTime += hours * 3600000;
      saveData();
    }
  }

  // ==================== АДМИН-ВВОД ====================
  if (id === ADMIN_ID && adminState[id]) {
    const state = adminState[id];
    const input = text.trim();

    if (state.action === 'approve') {
      const idx = parseInt(input) - 1;
      if (isNaN(idx) || idx < 0 || idx >= withdrawQueue.length) {
        bot.sendMessage(id, '❌ Неверный номер.');
        delete adminState[id];
        return;
      }
      const q = withdrawQueue.splice(idx, 1)[0];
      if (players[q.id] && players[q.id].withdrawHistory) {
        const history = players[q.id].withdrawHistory.find(w => w.amount === q.amount && w.status === 'ожидание');
        if (history) history.status = 'выполнен';
      }
      saveData();
      bot.sendMessage(id, `✅ Вывод ${q.amount} для @${q.username || q.id} подтверждён.`);
      bot.sendMessage(q.id, `✅ Вывод ${q.amount} выполнен. Проверь карту.`);
      delete adminState[id];
      return;
    }

    if (state.action === 'addbalance') {
      const parts = input.split(' ');
      if (parts.length < 2) return bot.sendMessage(id, '❌ Формат: ID сумма');
      const targetId = parseInt(parts[0]);
      const amount = parseInt(parts[1]);
      if (isNaN(targetId) || isNaN(amount)) return bot.sendMessage(id, '❌ Неверный формат.');
      if (!players[targetId]) {
        bot.sendMessage(id, '❌ Игрок не найден.');
        delete adminState[id];
        return;
      }
      const target = players[targetId];
      if (target.demoMode) {
        target.demoBalance = safeNumber(target.demoBalance) + amount;
      } else {
        target.balance = safeNumber(target.balance) + amount;
      }
      addHistory(targetId, `Админ начислил ${amount} дуб.`);
      addBalanceHistory(targetId, amount, 'Админ начислил');
      saveData();
      bot.sendMessage(id, `✅ Начислено ${amount} дуб. игроку ${targetId}`);
      bot.sendMessage(targetId, `👑 Админ начислил тебе ${amount} дуб.`);
      delete adminState[id];
      return;
    }

    if (state.action === 'history') {
      const targetId = parseInt(input);
      if (isNaN(targetId) || !players[targetId]) {
        bot.sendMessage(id, '❌ Игрок не найден.');
        delete adminState[id];
        return;
      }
      const target = players[targetId];
      let msgText = `📋 ИСТОРИЯ ИГРОКА ${targetId}:\n\n`;
      const balance = target.demoMode ? safeNumber(target.demoBalance) : safeNumber(target.balance);
      msgText += `Баланс: ${balance} дуб.\n`;
      msgText += `Ранг: ${RANKS[target.rank].name}\n`;
      msgText += `Доля: ${target.share}%\n\n`;
      msgText += `📜 Последние действия:\n`;
      if (target.history && target.history.length > 0) {
        target.history.slice(-10).forEach(h => {
          msgText += `- ${new Date(h.time).toLocaleTimeString()} ${h.text}\n`;
        });
      } else {
        msgText += 'Нет истории.\n';
      }
      msgText += `\n📊 Динамика баланса (7 дней):\n`;
      if (target.balanceHistory && target.balanceHistory.length > 0) {
        target.balanceHistory.slice(-7).forEach(b => {
          msgText += `- ${new Date(b.time).toLocaleDateString()}: ${b.reason} → ${safeNumber(b.balance)} дуб.\n`;
        });
      } else {
        msgText += 'Нет данных.\n';
      }
      bot.sendMessage(id, msgText);
      delete adminState[id];
      return;
    }

    if (state.action === 'sunduk') {
      const targetId = parseInt(input);
      if (isNaN(targetId) || !players[targetId]) {
        bot.sendMessage(id, '❌ Игрок не найден.');
        delete adminState[id];
        return;
      }
      const target = players[targetId];
      if (safeNumber(bank.pot) < MIN_SUNDUK_BANK) return bot.sendMessage(id, `❌ Банк меньше ${MIN_SUNDUK_BANK} дуб. Сундук недоступен.`);
      const targetBalance = target.demoMode ? safeNumber(target.demoBalance) : safeNumber(target.balance);
      if (targetBalance < 500) return bot.sendMessage(id, `❌ У игрока меньше 500 дуб.`);

      if (target.demoMode) {
        target.demoBalance = safeNumber(target.demoBalance) - 500;
      } else {
        target.balance = safeNumber(target.balance) - 500;
      }
      const winPercent = 90;
      const winAmount = Math.floor(safeNumber(bank.pot) * winPercent / 100);

      const playerDice1 = Math.floor(Math.random() * 6) + 1;
      const playerDice2 = Math.floor(Math.random() * 6) + 1;
      const playerSum = playerDice1 + playerDice2;
      const adminDice1 = Math.floor(Math.random() * 6) + 1;
      const adminDice2 = Math.floor(Math.random() * 6) + 1;
      const adminSum = adminDice1 + adminDice2;

      if (playerSum > adminSum) {
        if (target.demoMode) {
          target.demoBalance = safeNumber(target.demoBalance) + winAmount;
        } else {
          target.balance = safeNumber(target.balance) + winAmount;
        }
        bank.pot = safeNumber(bank.pot) - winAmount;
        addHistory(targetId, `СУНДУК: ПОБЕДА! +${winAmount} дуб.`);
        addBalanceHistory(targetId, winAmount, 'Сундук: победа');
        bot.sendMessage(targetId,
          `⚔️ СУНДУК: ПОБЕДА!\n` +
          `Ты: ${playerDice1}+${playerDice2}=${playerSum}\n` +
          `Капитан: ${adminDice1}+${adminDice2}=${adminSum}\n` +
          `Ты забираешь ${winAmount} дуб. из банка!`
        );
        bot.sendMessage(id, `✅ Сундук активирован. Игрок ${targetId} ПОБЕДИЛ и получил ${winAmount} дуб.`);
      } else {
        addHistory(targetId, `СУНДУК: поражение (-500 дуб.)`);
        addBalanceHistory(targetId, -500, 'Сундук: поражение');
        bot.sendMessage(targetId,
          `⚔️ СУНДУК: ПОРАЖЕНИЕ!\n` +
          `Ты: ${playerDice1}+${playerDice2}=${playerSum}\n` +
          `Капитан: ${adminDice1}+${adminDice2}=${adminSum}\n` +
          `Твой взнос 500 дуб. ушёл в банк.`
        );
        bot.sendMessage(id, `✅ Сундук активирован. Игрок ${targetId} ПРОИГРАЛ.`);
      }
      saveData();
      delete adminState[id];
      return;
    }

  if (state.action === 'share_activate') {
      const parts = input.split(' ');
      if (parts.length < 2) return bot.sendMessage(id, '❌ Формат: ID процент');
      const targetId = parseInt(parts[0]);
      const percent = parseInt(parts[1]);
      if (isNaN(targetId) || isNaN(percent)) return bot.sendMessage(id, '❌ Неверный формат.');
      if (!players[targetId]) {
        bot.sendMessage(id, '❌ Игрок не найден.');
        delete adminState[id];
        return;
      }
      const share = SHARES.find(s => s.percent === percent);
      if (!share) return bot.sendMessage(id, '❌ Неверный процент доли.');
      players[targetId].share += percent;
      addHistory(targetId, `Админ активировал долю ${percent}%`);
      saveData();
      bot.sendMessage(id, `✅ Доля ${percent}% активирована для игрока ${targetId}`);
      bot.sendMessage(targetId, `👑 Админ активировал твою долю ${percent}% в банке!`);
      delete adminState[id];
      return;
    }

    if (state.action === 'ban') {
      const targetId = parseInt(input);
      if (isNaN(targetId) || !players[targetId]) {
        bot.sendMessage(id, '❌ Игрок не найден.');
        delete adminState[id];
        return;
      }
      blockList[targetId] = Date.now() + 86400000;
      bot.sendMessage(id, `⛔ Игрок ${targetId} заблокирован на 24 часа.`);
      bot.sendMessage(targetId, `⛔ Ты заблокирован админом на 24 часа.`);
      delete adminState[id];
      return;
    }

    if (state.action === 'unban') {
      const targetId = parseInt(input);
      if (isNaN(targetId)) return bot.sendMessage(id, '❌ Неверный ID.');
      delete blockList[targetId];
      bot.sendMessage(id, `🔓 Игрок ${targetId} разблокирован.`);
      delete adminState[id];
      return;
    }

    if (state.action === 'fleet_buy') {
      if (text.toLowerCase() === 'отмена' || text.toLowerCase() === '/cancel') {
        delete adminState[id];
        bot.sendMessage(id, '✅ Покупка корабля отменена.', fleetKeyboard());
        return;
      }
      const shipId = parseInt(text);
      if (isNaN(shipId)) {
        bot.sendMessage(id, '❌ Введи ID корабля (число) или напиши "отмена" для отмены.');
        return;
      }
      const ship = SHIPS.find(s => s.id === shipId);
      if (!ship) {
        bot.sendMessage(id, '❌ Корабль с таким ID не найден.');
        return;
      }
      if (buyShip(id, shipId)) {
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        bot.sendMessage(id, `✅ Корабль "${ship.name}" куплен! Баланс: ${balance} дуб.`, fleetKeyboard());
      } else {
        bot.sendMessage(id, `❌ Не удалось купить корабль. Проверь баланс (нужно ${ship.cost} дуб.) и наличие корабля.`, fleetKeyboard());
      }
      delete adminState[id];
      return;
    }

    if (state.action === 'fleet_upgrade') {
      if (text.toLowerCase() === 'отмена' || text.toLowerCase() === '/cancel') {
        delete adminState[id];
        bot.sendMessage(id, '✅ Улучшение корабля отменено.', fleetKeyboard());
        return;
      }
      const shipId = parseInt(text);
      if (isNaN(shipId)) {
        bot.sendMessage(id, '❌ Введи ID корабля (число) или напиши "отмена" для отмены.');
        return;
      }
      const shipData = p.fleet?.ships?.find(s => s.id === shipId);
      if (!shipData) {
        bot.sendMessage(id, '❌ У тебя нет такого корабля.');
        return;
      }
      const ship = SHIPS.find(s => s.id === shipId);
      if (!ship) {
        bot.sendMessage(id, '❌ Корабль не найден.');
        return;
      }
      if (upgradeShip(id, shipId)) {
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        bot.sendMessage(id, `✅ Корабль "${ship.name}" улучшен до ${shipData.level} уровня! Баланс: ${balance} дуб.`, fleetKeyboard());
      } else {
        bot.sendMessage(id, `❌ Не удалось улучшить корабль. Проверь баланс и уровень.`, fleetKeyboard());
      }
      delete adminState[id];
      return;
    }

    if (state.action === 'maintenance') {
      const parts = input.split('|');
      const message = parts[0]?.trim() || '🔧 Бот на технических работах. Скоро вернёмся!';
      const hours = parseInt(parts[1]) || 2;
      enableMaintenance(message, hours);
      bot.sendMessage(id, `✅ Тех. работы включены на ${hours} часов.\nСообщение: ${message}`);
      delete adminState[id];
      return;
    }

    if (state.action === 'gift_send') {
      const parts = input.split(' ');
      if (parts.length < 2) {
        bot.sendMessage(id, '❌ Формат: <ID игрока> <сумма>');
        delete adminState[id];
        return;
      }
      const targetId = parseInt(parts[0]);
      const amount = parseInt(parts[1]);
      if (isNaN(targetId) || isNaN(amount) || amount < 10) {
        bot.sendMessage(id, '❌ Неверный формат. Минимальный подарок 10 дуб.');
        delete adminState[id];
        return;
      }
      if (!players[targetId]) {
        bot.sendMessage(id, '❌ Игрок с таким ID не найден.');
        delete adminState[id];
        return;
      }
      if (targetId === id) {
        bot.sendMessage(id, '❌ Нельзя отправить подарок самому себе.');
        delete adminState[id];
        return;
      }
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      const totalCost = amount + Math.floor(amount * 0.05);
      if (balance < totalCost) {
        bot.sendMessage(id, `❌ Не хватает. Нужно ${totalCost} дуб. (${amount} + комиссия 5%)`);
        delete adminState[id];
        return;
      }

      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) - totalCost;
      } else {
        p.balance = safeNumber(p.balance) - totalCost;
      }

      const target = players[targetId];
      if (target.demoMode) {
        target.demoBalance = safeNumber(target.demoBalance) + amount;
      } else {
        target.balance = safeNumber(target.balance) + amount;
      }

      if (!p.giftHistory) p.giftHistory = [];
      if (!target.giftHistory) target.giftHistory = [];
      p.giftHistory.push({ type: 'sent', amount, id: targetId, username: target.username || targetId, date: Date.now() });
      target.giftHistory.push({ type: 'received', amount, id: id, username: p.username || id, date: Date.now() });

      bank.commission = safeNumber(bank.commission) + Math.floor(amount * 0.05);

      addHistory(id, `Отправил подарок ${amount} дуб. игроку ${targetId}`);
      addBalanceHistory(id, -totalCost, `Подарок для @${target.username || targetId}`);
      addHistory(targetId, `Получил подарок ${amount} дуб. от @${p.username || id}`);
      addBalanceHistory(targetId, amount, `Подарок от @${p.username || id}`);

      saveData();

      bot.sendMessage(id, `✅ Подарок ${amount} дуб. отправлен @${target.username || targetId}! Комиссия: ${Math.floor(amount * 0.05)} дуб.`);
      bot.sendMessage(targetId, `🎁 Ты получил подарок ${amount} дуб. от @${p.username || id}!`);
      delete adminState[id];
      return;
    }

  if (state.action === 'invest_new') {
      const parts = input.split(' ');
      if (parts.length < 2) {
        bot.sendMessage(id, '❌ Формат: <сумма> <дни>');
        delete adminState[id];
        return;
      }
      const amount = parseInt(parts[0]);
      const days = parseInt(parts[1]);
      if (isNaN(amount) || isNaN(days) || amount < INVESTMENT_CONFIG.minAmount || amount > INVESTMENT_CONFIG.maxAmount) {
        bot.sendMessage(id, `❌ Неверный формат. Сумма от ${INVESTMENT_CONFIG.minAmount} до ${INVESTMENT_CONFIG.maxAmount} дуб.`);
        delete adminState[id];
        return;
      }
      if (days < INVESTMENT_CONFIG.minDays || days > INVESTMENT_CONFIG.maxDays) {
        bot.sendMessage(id, `❌ Срок от ${INVESTMENT_CONFIG.minDays} до ${INVESTMENT_CONFIG.maxDays} дней.`);
        delete adminState[id];
        return;
      }
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, `❌ Не хватает. У тебя ${balance} дуб.`);
        delete adminState[id];
        return;
      }

      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) - amount;
      } else {
        p.balance = safeNumber(p.balance) - amount;
      }

      if (!p.investments) p.investments = [];
      p.investments.push({
        amount: amount,
        days: days,
        startTime: Date.now(),
        withdrawn: false
      });

      addHistory(id, `Инвестиция: ${amount} дуб. на ${days} дней`);
      addBalanceHistory(id, -amount, `Инвестиция на ${days} дней`);
      saveData();

      bot.sendMessage(id, `✅ Инвестиция ${amount} дуб. на ${days} дней создана!`);
      bot.sendMessage(id, `📈 Доходность: ${INVESTMENT_CONFIG.percentPerDay}% в день\n💰 Ожидаемая прибыль: ${Math.floor(amount * (INVESTMENT_CONFIG.percentPerDay / 100) * days)} дуб.`);
      delete adminState[id];
      return;
    }

    if (state.action === 'invest_withdraw') {
      if (text.toLowerCase() === 'отмена' || text.toLowerCase() === '/cancel') {
        delete adminState[id];
        bot.sendMessage(id, '✅ Вывод инвестиции отменён.', investmentKeyboard());
        return;
      }
      const idx = parseInt(input) - 1;
      if (isNaN(idx) || idx < 0 || idx >= (p.investments?.length || 0)) {
        bot.sendMessage(id, '❌ Неверный номер.');
        delete adminState[id];
        return;
      }
      const inv = p.investments[idx];
      if (!inv || inv.withdrawn) {
        bot.sendMessage(id, '❌ Инвестиция уже завершена.');
        delete adminState[id];
        return;
      }

      const elapsed = Date.now() - inv.startTime;
      const days = elapsed / 86400000;
      const earned = Math.floor(inv.amount * (INVESTMENT_CONFIG.percentPerDay / 100) * days);
      let totalReturn = inv.amount + earned;

      if (days < inv.days) {
        const penalty = Math.floor(totalReturn * INVESTMENT_CONFIG.earlyWithdrawPenalty);
        totalReturn -= penalty;
        bot.sendMessage(id, `⚠️ Досрочное снятие! Штраф: ${penalty} дуб. (50%)`);
      }

      inv.withdrawn = true;

      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + totalReturn;
      } else {
        p.balance = safeNumber(p.balance) + totalReturn;
      }

      addHistory(id, `Вывод инвестиции: ${totalReturn} дуб. (вложено ${inv.amount}, прибыль ${totalReturn - inv.amount})`);
      addBalanceHistory(id, totalReturn, `Вывод инвестиции`);
      saveData();

      bot.sendMessage(id, `✅ Инвестиция выведена!\n💰 Получено: ${totalReturn} дуб.\n📈 Прибыль: ${totalReturn - inv.amount} дуб.`);
      delete adminState[id];
      return;
    }

    if (state.action === 'ach_buy') {
      const idx = parseInt(input) - 1;
      const unlocked = p.achievements || [];
      const available = ACHIEVEMENTS.filter(a => !unlocked.includes(a.id));
      if (isNaN(idx) || idx < 0 || idx >= available.length) {
        bot.sendMessage(id, '❌ Неверный номер.');
        delete adminState[id];
        return;
      }
      const ach = available[idx];
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < ach.cost) {
        bot.sendMessage(id, `❌ Не хватает. Нужно ${ach.cost} дуб.`);
        delete adminState[id];
        return;
      }

      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) - ach.cost;
      } else {
        p.balance = safeNumber(p.balance) - ach.cost;
      }
      p.achievements.push(ach.id);
      p.achievementBonus = (p.achievementBonus || 0) + ach.bonus;

      addHistory(id, `Купил достижение "${ach.name}" за ${ach.cost} дуб.`);
      addBalanceHistory(id, -ach.cost, `Покупка достижения "${ach.name}"`);
      saveData();

      bot.sendMessage(id, `🏆 ДОСТИЖЕНИЕ ПОЛУЧЕНО!\n${ach.name}\n${ach.desc}\nБонус: +${ach.bonus}% к доходу`);
      delete adminState[id];
      return;
    }
  }

  // ==================== БЛЭКДЖЕК — ВВОД СТАВКИ ====================
  if (blackjackGames[id] && blackjackGames[id].status === 'waiting') {
    const bet = parseInt(text);
    if (isNaN(bet) || bet < BLACKJACK_CONFIG.minBet || bet > BLACKJACK_CONFIG.maxBet) {
      return bot.sendMessage(id, `❌ Ставка от ${BLACKJACK_CONFIG.minBet} до ${BLACKJACK_CONFIG.maxBet} дуб.`);
    }
    // Проверка, что игра не завершена
    if (blackjackGames[id].status === 'finished') {
      delete blackjackGames[id];
      return bot.sendMessage(id, '❌ Игра уже завершена. Начни новую.');
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < bet) {
      return bot.sendMessage(id, `❌ Не хватает. У тебя ${balance} дуб.`);
    }
    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - bet;
    } else {
      p.balance = safeNumber(p.balance) - bet;
    }
    const game = blackjackGames[id];
    game.bet = bet;
    game.status = 'playing';

    const deck = game.deck;
    game.playerHand = [deck.pop(), deck.pop()];
    game.dealerHand = [deck.pop(), deck.pop()];

    const playerValue = getHandValue(game.playerHand);
    const dealerValue = getHandValue(game.dealerHand);

    if (isBlackjack(game.playerHand) && !isBlackjack(game.dealerHand)) {
      game.status = 'finished';
      finishBlackjack(id);
      return;
    }
    if (!isBlackjack(game.playerHand) && isBlackjack(game.dealerHand)) {
      game.status = 'finished';
      finishBlackjack(id);
      return;
    }
    if (isBlackjack(game.playerHand) && isBlackjack(game.dealerHand)) {
      game.status = 'finished';
      finishBlackjack(id);
      return;
    }

    let splitAvailable = false;
    if (game.playerHand.length === 2 && game.playerHand[0].rank === game.playerHand[1].rank) {
      splitAvailable = true;
    }

  const balanceAfter = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id,
      `🎴 НАЧАЛО ИГРЫ!\n\n` +
      `Твоя рука: ${formatHand(game.playerHand)} (${playerValue} очков)\n` +
      `Дилер: ${formatHand([game.dealerHand[0]])} (${getHandValue([game.dealerHand[0]])} очков)\n` +
      `💰 Ставка: ${game.bet} дуб.\n` +
      `📊 Баланс: ${balanceAfter} дуб.\n` +
      `${splitAvailable ? '✂️ Доступен сплит!' : ''}`,
      blackjackKeyboard()
    );
    return;
  }

  // ==================== СТАВКИ (ввод числа) ====================
  if (text.startsWith('/')) return;
  if (text.startsWith('💸')) return;

  const amount = parseInt(text);

  if (!isNaN(amount) && amount >= 1) {
    // ===== ПРОВЕРКА: ЕСЛИ ИДЁТ ИГРА В БЛЭКДЖЕК =====
    if (blackjackGames[id] && blackjackGames[id].status !== 'finished' && blackjackGames[id].status !== 'waiting') {
      return bot.sendMessage(id, '❌ Сначала заверши текущую игру в блэкджек!');
    }

    if (!bank.roundActive) return bot.sendMessage(id, '⏳ Раунд не активен, подожди...');

    checkActivityBonus(p, id);

    // === ДУЭЛЬ ===
    if (p.currentMode === '⚔️ Дуэль') {
      const isRealMoney = p.duelCurrency === '💰 Реальные деньги';
      let finalAmount = amount;

      if (isRealMoney) {
        if (amount < MIN_DUEL_MONEY || amount > MAX_DUEL_MONEY) {
          return bot.sendMessage(id, `❌ Ставка в ₽ от ${MIN_DUEL_MONEY} до ${MAX_DUEL_MONEY}.`);
        }
        finalAmount = Math.floor(amount / 0.5);
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        if (balance < finalAmount) {
          return bot.sendMessage(id, `❌ Не хватает. Нужно ${finalAmount} дуб. (${amount} ₽)`);
        }
      } else {
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        if (balance < amount) {
          return bot.sendMessage(id, `❌ Не хватает. У тебя ${balance} дуб.`);
        }
      }

      if (duelChallenges[id]) {
        return bot.sendMessage(id, '❌ У тебя уже есть активный вызов. Нажми ❌ Отменить вызов', duelCancelKeyboard());
      }
      if (p.bet > 0 && p.currentMode === '⚔️ Дуэль') {
        return bot.sendMessage(id, '❌ Ты уже в дуэли. Дождись завершения.');
      }

      duelChallenges[id] = { amount: finalAmount, timestamp: Date.now(), isRealMoney };
      const username = p.username || 'Игрок';

      let sentCount = 0;
      for (let pid in players) {
        if (pid == id) continue;
        const target = players[pid];
        const targetBalance = target.demoMode ? safeNumber(target.demoBalance) : safeNumber(target.balance);
        if (targetBalance >= finalAmount) {
          const currencyLabel = isRealMoney ? `(${Math.floor(finalAmount * 0.5)} ₽)` : '';
          bot.sendMessage(pid,
            `⚔️ НОВЫЙ ВЫЗОВ НА ДУЭЛЬ!\n\n` +
            `Игрок: @${username}\n` +
            `Ставка: ${finalAmount} дуб. ${currencyLabel}\n` +
            `Твой баланс: ${targetBalance} дуб.\n\n` +
            `Хочешь принять вызов?`,
            acceptDuelKeyboard(finalAmount, id)
          );
          sentCount++;
        }
      }

      p.bet = finalAmount;
      p.hasRolled = false;
      p.duelCurrency = isRealMoney ? 'реальные деньги' : 'дублоны';
      saveData();

      setTimeout(() => {
        if (duelChallenges[id]) {
          delete duelChallenges[id];
          p.bet = 0;
          saveData();
          bot.sendMessage(id, `⏰ Вызов на дуэль (${finalAmount} дуб.) отменён — никто не принял за 5 минут.`);
        }
      }, DUEL_TIMEOUT);

      bot.sendMessage(id,
        `⚔️ ВЫЗОВ ОТПРАВЛЕН!\n\n` +
        `Ставка: ${finalAmount} дуб. ${isRealMoney ? `(${Math.floor(finalAmount * 0.5)} ₽)` : ''}\n` +
        `Твои деньги пока не списаны.\n` +
        `Ожидай, пока кто-то примет вызов.\n` +
        `⏳ Вызов отменится через 5 минут.\n\n` +
        `❌ Чтобы отменить вызов — нажми кнопку ниже.`,
        duelCancelKeyboard()
      );
      return;
    }

    // === VIP ===
    if (p.currentMode === '👑 VIP-игра') {
      if (amount < MIN_VIP_BET || amount > MAX_VIP_BET) {
        return bot.sendMessage(id, `❌ VIP-ставка от ${MIN_VIP_BET} до ${MAX_VIP_BET} ₽.`);
      }
      const dublonsAmount = Math.floor(amount / 0.5);
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < dublonsAmount) {
        return bot.sendMessage(id, `❌ Не хватает. Нужно ${dublonsAmount} дуб. (${amount} ₽)`);
      }
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) - dublonsAmount;
      } else {
        p.balance = safeNumber(p.balance) - dublonsAmount;
      }
      p.bet = dublonsAmount;
      p.hasRolled = false;
      p.canDouble = false;
      p.point = 0;
      p.vipBetRub = amount;
      bank.totalStakes = safeNumber(bank.totalStakes) + dublonsAmount;
      addHistory(id, `VIP-ставка ${amount} ₽ (${dublonsAmount} дуб.)`);
      addBalanceHistory(id, -dublonsAmount, `VIP-ставка ${amount} ₽`);
      saveData();
      const balanceAfter = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      bot.sendMessage(id, `👑 VIP-ставка ${amount} ₽ (${dublonsAmount} дуб.) принята.\n📊 Баланс: ${balanceAfter} дуб.\nНажми 🎲 Бросить`, gameActionsKeyboard());
      return;
    }

    // === КЛАССИКА ===
    if (p.currentMode === '🎲 Классика') {
      if (p.bet > 0) return bot.sendMessage(id, '⚠️ У тебя уже есть ставка. Сначала заверши игру.');

      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);

      const maxBet = MAX_CLASSIC_BET + (p.limitUpgrades || 0) * 1000;
      if (amount > maxBet) {
        return bot.sendMessage(id, `❌ Максимальная ставка ${maxBet} дуб. (увеличено на ${(p.limitUpgrades || 0) * 1000})`);
      }

      if (balance < amount) {
        return bot.sendMessage(id, `❌ Не хватает. У тебя ${balance} дуб.`);
      }

      const feeData = getEntryFee(balance, amount, p.freeStakesUsed || 0);
      const entryFee = feeData.fee;
      const totalCost = amount + entryFee;

      if (balance < totalCost) {
        return bot.sendMessage(id, `❌ Не хватает. Нужно ${totalCost} дуб. (ставка ${amount} + сбор ${entryFee})`);
      }

      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) - totalCost;
      } else {
        p.balance = safeNumber(p.balance) - totalCost;
      }
      p.bet = amount;
      p.hasRolled = false;
      p.canDouble = false;
      p.point = 0;

      const comm = Math.floor(amount * COMMISSION_PERCENT);
      bank.commission = safeNumber(bank.commission) + comm;
      bank.pot = safeNumber(bank.pot) + (amount - comm);
      bank.pot = safeNumber(bank.pot) + entryFee;

      if (feeData.isFree) {
        p.freeStakesUsed = (p.freeStakesUsed || 0) + 1;
      }

    bank.totalStakes = safeNumber(bank.totalStakes) + amount;
      addHistory(id, `Ставка ${amount} (комиссия ${comm}, сбор ${entryFee})`);
      addBalanceHistory(id, -totalCost, `Ставка ${amount} (комиссия ${comm})`);
      saveData();

      let bonusText = '';
      if (feeData.isFree) {
        const left = 3 - (p.freeStakesUsed || 0);
        bonusText = `\n🎁 БЕСПЛАТНАЯ СТАВКА! (осталось ${left})`;
      }

      const balanceAfter = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      bot.sendMessage(id,
        `✅ Ставка ${amount} принята.\n` +
        `📊 Входной сбор: ${entryFee} дуб. (${feeData.percent}% от ставки)\n` +
        `💰 Итого списано: ${totalCost} дуб.${bonusText}\n` +
        `📊 Баланс: ${balanceAfter} дуб.\n` +
        `Нажми 🎲 Бросить`,
        gameActionsKeyboard()
      );
      return;
    }
  }

  // ==================== БРОСОК ====================
  if (text === '🎲 Бросить') {
    const mode = p.currentMode || '🎲 Классика';

    if (mode === '🎲 Классика') {
      if (!p.bet || p.bet <= 0) return bot.sendMessage(id, '❌ Сделай ставку.');
      if (p.hasRolled && !p.canDouble) return bot.sendMessage(id, '⏳ Ты уже бросил.');
      if (p.canDouble) return bot.sendMessage(id, '🎯 Точка! Нажми ⚡ Удвоить или 💰 Забрать', doubleActionsKeyboard());

      const dice1 = Math.floor(Math.random() * 6) + 1;
      const dice2 = Math.floor(Math.random() * 6) + 1;
      const sum = dice1 + dice2;
      const bet = p.bet;
      const rankBonus = 1 + (RANKS[p.rank].bonus / 100);

      if (sum === 12 && safeNumber(bank.jackpot) >= 50) {
        const win = Math.floor(safeNumber(bank.jackpot) * 0.8);
        if (p.demoMode) {
          p.demoBalance = safeNumber(p.demoBalance) + win;
        } else {
          p.balance = safeNumber(p.balance) + win;
        }
        bank.jackpot = safeNumber(bank.jackpot) - win;
        addHistory(id, `ДЖЕКПОТ! +${win}`);
        addBalanceHistory(id, win, 'Джекпот');
        p.bet = 0; p.hasRolled = true; p.canDouble = false;
        p.stats.totalGames++; p.stats.wins++; p.stats.streak++;
        if (p.stats.streak > p.stats.maxStreak) p.stats.maxStreak = p.stats.streak;
        p.totalEarned = safeNumber(p.totalEarned) + win;
        saveData();
        bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        bot.sendMessage(id, `🎰 ДЖЕКПОТ! ${dice1}+${dice2}=12, +${win} дуб! Баланс: ${balance}`, mainInlineKeyboard());
        return;
      }

      if (sum === 7 || sum === 11) {
        let win = Math.floor((bet + Math.floor(safeNumber(bank.pot) * 0.5)) * rankBonus);
        const maxWin = bet * MAX_WIN_MULTIPLIER;
        if (win > maxWin) win = maxWin;
        if (p.demoMode) {
          p.demoBalance = safeNumber(p.demoBalance) + win;
        } else {
          p.balance = safeNumber(p.balance) + win;
        }
        bank.pot = safeNumber(bank.pot) - Math.floor(safeNumber(bank.pot) * 0.5);
        addHistory(id, `Победа +${win}`);
        addBalanceHistory(id, win, 'Победа в классике');
        p.bet = 0; p.hasRolled = true; p.canDouble = false;
        p.stats.totalGames++; p.stats.wins++; p.stats.streak++;
        if (p.stats.streak > p.stats.maxStreak) p.stats.maxStreak = p.stats.streak;
        p.totalEarned = safeNumber(p.totalEarned) + win;
        checkAchievements(p, id);
        saveData();
        bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        bot.sendMessage(id, `🎲 ${dice1}+${dice2}=${sum} — ПОБЕДА! +${win} дуб.\nБаланс: ${balance}\n🔥 Серия: ${p.stats.streak} побед!`, mainInlineKeyboard());
        return;
      } else if (sum === 2 || sum === 3 || sum === 12) {
        addHistory(id, `Проигрыш ${bet}`);
        addBalanceHistory(id, -bet, 'Проигрыш в классике');
        p.bet = 0; p.hasRolled = true; p.canDouble = false;
        p.stats.totalGames++; p.stats.losses++; p.stats.streak = 0;
        saveData();
        bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        bot.sendMessage(id, `💀 ${dice1}+${dice2}=${sum} — ПРОИГРЫШ.\nБаланс: ${balance}`, mainInlineKeyboard());
        return;
      } else {
        p.point = sum;
        p.canDouble = true;
        p.hasRolled = true;
        p.stats.totalGames++; p.stats.points++;
        jackpotCounter++;
        bank.jackpot = safeNumber(bank.jackpot) + 10;
        // Убрано оповещение всем игрокам о джекпоте
        saveData();
        bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        bot.sendMessage(id, `🎯 ${dice1}+${dice2}=${sum} — ТОЧКА!\nСтавка: ${bet} дуб.\nДжекпот: ${safeNumber(bank.jackpot)} дуб.\n⚡ Удвоить или 💰 Забрать`, doubleActionsKeyboard());
        return;
      }
    }

    // VIP бросок
    if (mode === '👑 VIP-игра') {
      if (!p.bet || p.bet <= 0) return bot.sendMessage(id, '❌ Сделай ставку.');
      if (p.hasRolled) return bot.sendMessage(id, '⏳ Ты уже бросил.');

      const dice1 = Math.floor(Math.random() * 6) + 1;
      const dice2 = Math.floor(Math.random() * 6) + 1;
      const sum = dice1 + dice2;
      const bet = p.bet;
      const betRub = p.vipBetRub || Math.floor(bet * 0.5);

      const ad1 = Math.floor(Math.random() * 6) + 1;
      const ad2 = Math.floor(Math.random() * 6) + 1;
      const admSum = ad1 + ad2;

      let result = '';
      let winAmount = 0;
      if (sum > admSum) {
        winAmount = bet * 2;
        if (p.demoMode) {
          p.demoBalance = safeNumber(p.demoBalance) + winAmount;
        } else {
          p.balance = safeNumber(p.balance) + winAmount;
        }
        p.vipStats.wins++;
        result = 'ПОБЕДА!';
        checkAchievements(p, id);
      } else {
        p.vipStats.losses++;
        result = 'ПОРАЖЕНИЕ!';
      }
      p.vipStats.totalGames++;
      p.bet = 0; p.hasRolled = true; p.canDouble = false;
      p.totalEarned = safeNumber(p.totalEarned) + (result === 'ПОБЕДА!' ? winAmount : 0);
      if (result === 'ПОБЕДА!') addBalanceHistory(id, winAmount, 'VIP победа');
      else addBalanceHistory(id, -bet, 'VIP поражение');
      saveData();
      bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
      bot.sendDice(id, { emoji: '🎲' }).catch(() => {});

      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (result === 'ПОБЕДА!') {
        bot.sendMessage(id, `👑 VIP: ${result}\nТы: ${dice1}+${dice2}=${sum}\nАдмин: ${ad1}+${ad2}=${admSum}\nТы выиграл ${winAmount} дуб. (${Math.floor(winAmount * 0.5)} ₽)\nБаланс: ${balance}`, mainInlineKeyboard());
      } else {
        bot.sendMessage(id, `👑 VIP: ${result}\nТы: ${dice1}+${dice2}=${sum}\nАдмин: ${ad1}+${ad2}=${admSum}\nТы проиграл ${betRub} ₽ (${bet} дуб.)\nБаланс: ${balance}`, mainInlineKeyboard());
      }
      return;
    }
  }

  // ==================== СТАТИСТИКА ====================
  if (text === '📈 Статистика') {
    const s = p.stats;
    const winRate = s.totalGames > 0 ? Math.round((s.wins / s.totalGames) * 100) : 0;
    const duel = p.duelStats;
    const duelRate = duel.totalGames > 0 ? Math.round((duel.wins / duel.totalGames) * 100) : 0;
    const vip = p.vipStats;
    const vipRate = vip.totalGames > 0 ? Math.round((vip.wins / vip.totalGames) * 100) : 0;
    bot.sendMessage(id,
      `📊 ТВОЯ СТАТИСТИКА:\n\n` +
      `🎲 Классика:\n` +
      `  Игр: ${s.totalGames}, Побед: ${s.wins} (${winRate}%)\n` +
      `  Лучшая серия: ${s.maxStreak}\n\n` +
      `⚔️ Дуэль:\n` +
      `  Игр: ${duel.totalGames}, Побед: ${duel.wins} (${duelRate}%)\n\n` +
      `👑 VIP:\n` +
      `  Игр: ${vip.totalGames}, Побед: ${vip.wins} (${vipRate}%)`
    );
    return;
  }

  // ==================== БАЛАНС ====================
  if (text === '📊 Баланс') {
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id,
      `💰 Основной: ${balance}\n` +
      `🎮 Демо: ${safeNumber(p.demoBalance)} (осталось ${20 - (p.demoRollsToday || 0)} бросков)`
    );
    return;
  }

  // ==================== БОНУС ====================
  if (text === '🎁 Бонус') {
    const now = Date.now();
    const today = new Date().toDateString();

    if (p.lastDailyDate === today) {
      const left = 24 - Math.floor((now - new Date(today).getTime()) / 3600000);
      return bot.sendMessage(id, `⏳ Бонус уже получен сегодня. Следующий через ${left} ч.`);
    }

  const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();

    if (p.lastDailyDate === yesterdayStr) {
      p.dailyStreak = (p.dailyStreak || 0) + 1;
    } else {
      p.dailyStreak = 1;
    }

    const streak = p.dailyStreak || 1;
    let bonus = 5;
    if (streak >= 30) bonus = 100;
    else if (streak >= 14) bonus = 50;
    else if (streak >= 7) bonus = 25;
    else if (streak >= 3) bonus = 10;

    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) + bonus;
    } else {
      p.balance = safeNumber(p.balance) + bonus;
    }
    p.lastDailyDate = today;
    p.dailyStreak = streak;
    addHistory(id, `Ежедневный бонус: +${bonus} дуб. (серия ${streak} дней)`);
    addBalanceHistory(id, bonus, `Ежедневный бонус (серия ${streak})`);
    saveData();
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    bot.sendMessage(id, `🎁 Ежедневный бонус: +${bonus} дуб.!\n🔥 Серия: ${streak} дней подряд!\nБаланс: ${balance}`);
    return;
  }

  // ==================== РЕФЕРАЛКА ====================
  if (text === '🔗 Рефералка') {
    const botInfo = await bot.getMe();
    const link = `https://t.me/${botInfo.username}?start=ref_${id}`;
    bot.sendMessage(id,
      `🔗 Твоя реф-ссылка:\n${link}\n\n` +
      `За каждого приведённого друга:\n` +
      `🎁 Ты получаешь 30 дуб.\n` +
      `🎁 Друг получаешь 15 дуб.\n\n` +
      `Друзей приведено: ${p.refs?.length || 0}`
    );
    return;
  }

  // ==================== ВЫВОД ====================
  if (text === '💸 Вывод') {
    if (p.demoMode) return bot.sendMessage(id, '❌ В демо-режиме вывод недоступен.');
    if (safeNumber(bank.pot) < MIN_BANK) return bot.sendMessage(id, `❌ Банк меньше ${MIN_BANK} дуб. Вывод временно недоступен.`);
    const hasPurchased = safeNumber(p.totalEarned) > 0;
    if (!hasPurchased && p.rank < 2) {
      return bot.sendMessage(id, '❌ Вывод доступен только после покупки дублонов (от 500 дуб.) или достижения ранга Капитан.');
    }
    const maxWithdraw = Math.floor(Math.min(safeNumber(p.balance) * MAX_WITHDRAW_PERCENT, MAX_WITHDRAW_DAILY));
    if (maxWithdraw < MIN_WITHDRAW) return bot.sendMessage(id, `❌ Минимальный вывод ${MIN_WITHDRAW} дуб. У тебя доступно ${maxWithdraw} дуб.`);
    bot.sendMessage(id,
      `💸 Выбери сумму вывода (мин ${MIN_WITHDRAW}, макс ${maxWithdraw}):\n` +
      `Баланс: ${safeNumber(p.balance)} дуб.\n` +
      `Доступно сегодня: ${maxWithdraw} дуб. (комиссия 10%)`,
      withdrawInlineKeyboard()
    );
    return;
  }

  if (text.startsWith('💸 ')) {
    const amount = parseInt(text.split(' ')[1]);
    if (isNaN(amount)) return bot.sendMessage(id, '❌ Ошибка суммы.');
    if (p.demoMode) return bot.sendMessage(id, '❌ В демо-режиме вывод недоступен.');
    if (safeNumber(p.balance) < amount) return bot.sendMessage(id, `❌ У тебя ${safeNumber(p.balance)} дуб. Не хватает.`);
    const maxWithdraw = Math.floor(Math.min(safeNumber(p.balance) * MAX_WITHDRAW_PERCENT, MAX_WITHDRAW_DAILY));
    if (amount > maxWithdraw) return bot.sendMessage(id, `❌ Можно вывести не более ${maxWithdraw} дуб.`);

    const withdrawFee = Math.floor(amount * 0.1);
    const finalAmount = amount - withdrawFee;
    if (finalAmount < 1) return bot.sendMessage(id, '❌ Сумма слишком мала после комиссии.');

    const today = new Date().toDateString();
    if (p.withdrawDate !== today) { p.withdrawToday = 0; p.withdrawDate = today; }
    if ((p.withdrawToday || 0) + amount > MAX_WITHDRAW_DAILY) {
      return bot.sendMessage(id, `❌ Лимит ${MAX_WITHDRAW_DAILY} дуб./сутки. Осталось: ${MAX_WITHDRAW_DAILY - (p.withdrawToday || 0)}`);
    }
    p.balance = safeNumber(p.balance) - amount;
    p.withdrawToday += amount;
    bank.commission = safeNumber(bank.commission) + withdrawFee;
    withdrawQueue.push({ id, amount: finalAmount, username: p.username, time: Date.now() });
    if (!p.withdrawHistory) p.withdrawHistory = [];
    p.withdrawHistory.push({ amount: finalAmount, fee: withdrawFee, date: new Date().toISOString(), status: 'ожидание' });
    addHistory(id, `Запрос вывода ${finalAmount} (комиссия ${withdrawFee})`);
    addBalanceHistory(id, -amount, `Запрос вывода ${finalAmount} (комиссия ${withdrawFee})`);
    saveData();
    bot.sendMessage(id, `✅ Запрос на ${finalAmount} дублонов принят (комиссия ${withdrawFee} дуб.).\nОжидай подтверждения.`, mainInlineKeyboard());
    bot.sendMessage(ADMIN_ID, `📤 ВЫВОД: @${p.username || id} — ${finalAmount} дуб. (комиссия ${withdrawFee}). Очередь: ${withdrawQueue.length}`);
    return;
  }

  // ==================== ОТКАЗ ОТ ДУЭЛИ ====================
  if (text === '❌ Отказаться') {
    bot.sendMessage(id, '❌ Ты отказался от дуэли.', mainInlineKeyboard());
    return;
  }

  // ==================== СБРОС ДЕМО ====================
  if (text === '/resetdemo') {
    p.demoBalance = 50;
    p.demoRollsToday = 0;
    p.demoDate = new Date().toDateString();
    p.demoBet = 0;
    p.demoCanDouble = false;
    p.demoHasRolled = false;
    saveData();
    bot.sendMessage(id, `🔄 Демо-баланс сброшен до 50. Можно играть заново.`, mainInlineKeyboard());
    return;
  }

  // ==================== НЕИЗВЕСТНАЯ КНОПКА ====================
  if (!text.startsWith('/')) {
    bot.sendMessage(id, `Главное меню:`, mainInlineKeyboard());
  }
});

// ==================== АВТОЗАПУСК ТУРНИРОВ ====================
function scheduleTournament() {
  const now = new Date();
  const day = now.getDay();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const msUntilSunday = ((7 - day) % 7) * 86400000 + (23 - hours) * 3600000 + (59 - minutes) * 60000 + (59 - seconds) * 1000;
  setTimeout(() => {
    startTournament();
    setTimeout(() => {
      endTournament();
      if (tournaments.results.length > 0) {
        const winnerId = tournaments.results[0];
        const prize = Math.floor(tournaments.prizePool * 0.5);
        if (players[winnerId]) {
          if (players[winnerId].demoMode) {
            players[winnerId].demoBalance = safeNumber(players[winnerId].demoBalance) + prize;
          } else {
            players[winnerId].balance = safeNumber(players[winnerId].balance) + prize;
          }
          bot.sendMessage(winnerId, `🏆 ПОБЕДА В ТУРНИРЕ! Ты получил ${prize} дуб.`);
        }
        for (let i = 1; i < Math.min(10, tournaments.results.length); i++) {
          const pid = tournaments.results[i];
          const prize = Math.floor(tournaments.prizePool * 0.05);
          if (players[pid]) {
            if (players[pid].demoMode) {
              players[pid].demoBalance = safeNumber(players[pid].demoBalance) + prize;
            } else {
              players[pid].balance = safeNumber(players[pid].balance) + prize;
            }
            bot.sendMessage(pid, `🎉 Ты занял ${i+1} место в турнире! Получил ${prize} дуб.`);
          }
        }
      }
      tournaments.active = false;
      tournaments.players = [];
      tournaments.results = [];
      saveData();
    }, 604800000);
    saveData();
  }, msUntilSunday);
}
scheduleTournament();

// ==================== СТАРТ РАУНДА ====================
function startRound() {
  if (bank.roundActive) return;
  bank.roundActive = true;
  bank.roundEnd = Date.now() + 600000;
  for (let id in players) {
    if (players[id].bet > 0) {
      if (players[id].demoMode) {
        players[id].demoBalance = safeNumber(players[id].demoBalance) + players[id].bet;
      } else {
        players[id].balance = safeNumber(players[id].balance) + players[id].bet;
      }
      players[id].bet = 0;
      players[id].canDouble = false;
      players[id].hasRolled = false;
      players[id].point = 0;
    }
    if (players[id].demoBet > 0) {
      players[id].demoBet = 0;
      players[id].demoCanDouble = false;
      players[id].demoHasRolled = false;
      players[id].demoPoint = 0;
    }
  }
  saveData();
  const now = Date.now();
  for (let id in players) {
    const p = players[id];
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if ((balance > 0 || safeNumber(p.demoBalance) > 0) && (now - p.lastPassiveTime < 86400000)) {
      bot.sendMessage(id, `🎲 НОВЫЙ РАУНД! Банк: ${safeNumber(bank.pot)} | Джекпот: ${safeNumber(bank.jackpot)}`).catch(() => {});
    }
  }
  if (roundTimer) clearTimeout(roundTimer);
  roundTimer = setTimeout(() => {
    bank.roundActive = false;
    const jackpotPart = Math.floor(safeNumber(bank.pot) * 0.8);
    bank.jackpot = safeNumber(bank.jackpot) + jackpotPart;
    bank.pot = safeNumber(bank.pot) - jackpotPart;
    for (let id in players) {
      const p = players[id];
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if ((balance > 0 || safeNumber(p.demoBalance) > 0) && (Date.now() - p.lastPassiveTime < 86400000)) {
        bot.sendMessage(id, `⏰ РАУНД ЗАВЕРШЁН! ${jackpotPart} ушло в джекпот (теперь ${safeNumber(bank.jackpot)}). Новый раунд через 30 сек.`).catch(() => {});
      }
    }
    saveData();
    setTimeout(() => { bank.roundActive = false; startRound(); }, 30000);
  }, 600000);
}

// ==================== ИВЕНТЫ ====================
function scheduleRandomEvent() {
  setTimeout(() => {
    const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    activeEvent = event;

    for (let id in players) {
      const p = players[id];
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if ((balance > 0 || safeNumber(p.demoBalance) > 0) && (Date.now() - p.lastPassiveTime < 86400000)) {
        bot.sendMessage(id,
          `🎉 СОБЫТИЕ АКТИВИРОВАНО!\n\n` +
          `${event.name}\n` +
          `${event.desc}\n` +
          `⏳ Длится ${event.duration / 60000} минут!`
        ).catch(() => {});
      }
    }

    eventTimer = setTimeout(() => {
      activeEvent = null;
      for (let id in players) {
        const p = players[id];
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        if ((balance > 0 || safeNumber(p.demoBalance) > 0) && (Date.now() - p.lastPassiveTime < 86400000)) {
          bot.sendMessage(id, `⏰ Событие "${event.name}" завершено!`).catch(() => {});
        }
      }
      scheduleRandomEvent();
    }, event.duration);

  }, 24 * 3600000);
}

startRound();
scheduleRandomEvent();

// ==================== АВТООЧИСТКА ====================
function cleanInactivePlayers() {
  const now = Date.now();
  const twoWeeks = 14 * 24 * 3600000;
  let cleaned = 0;
  for (let id in players) {
    const lastActivity = players[id].lastPassiveTime || 0;
    const balance = players[id].demoMode ? safeNumber(players[id].demoBalance) : safeNumber(players[id].balance);
    if (now - lastActivity > twoWeeks && balance === 0 && players[id].rank === 0) {
      delete players[id];
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`🧹 Удалено неактивных игроков: ${cleaned}`);
    saveData();
  }
}

setInterval(() => {
  cleanInactivePlayers();
  saveData();
  console.log('🧹 Автоочистка выполнена');
}, 6 * 3600000);

// ==================== АВТОРЕСТАРТ ====================
process.on('uncaughtException', (err) => {
  console.error('❌ Необработанная ошибка:', err);
  setTimeout(() => {
    console.log('🔄 Перезапуск бота...');
    process.exit(1);
  }, 5000);
});

console.log('🏴‍☠️ ЧЁРНАЯ КОСТЬ v10.7 (ИСПРАВЛЕННАЯ) ЗАПУЩЕНА');
console.log(`👥 Игроков: ${Object.keys(players).length}`);
console.log(`💰 Банк: ${safeNumber(bank.pot)}, Джекпот: ${safeNumber(bank.jackpot)}`);

// ==================== РЕЖИМ РАБОТЫ ПО РАСПИСАНИЮ ====================
function checkWorkHours() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentTime = hours * 60 + minutes;

  console.log(`🕒 Текущее время на сервере: ${hours}:${minutes}`);
  
  const WORK_START = 7 * 60;
  const WORK_END = 23 * 60;

  if (currentTime < WORK_START || currentTime >= WORK_END) {
    if (bot.isPolling) {
      bot.stopPolling();
      console.log(`⏰ Бот остановлен (${hours}:${minutes}). Жду утра...`);
    }
  } else {
    if (!bot.isPolling) {
      bot.startPolling();
      console.log(`⏰ Бот запущен (${hours}:${minutes})`);
    }
  }
}

checkWorkHours();

setInterval(() => {
  checkWorkHours();
}, 300000);
saveData();
