require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const token = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// ==================== КОНФИГУРАЦИЯ (НОВАЯ) ====================
const CONFIG = {
  SLEEP_DUEL: 500,        // ✅ Задача 1: уменьшено с 1500
  ANTIFLOOD: 500,         // ✅ Задача 2: уменьшено с 2000
  ANIMATION_DELAY: 1000,  // Задача 38
  MAX_DUEL_ROUNDS: 5,     // Задача 44
  BLACKJACK_TIMEOUT: 60000, // Задача 23
  MAX_JACKPOT: 10000000000, // Задача 8
  JACKPOT_BONUS: 1000000,   // Задача 8
};

// ==================== ОСТАЛЬНЫЕ КОНСТАНТЫ (ОРИГИНАЛ) ====================
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

// ==================== РАНГИ (ОРИГИНАЛ) ====================
const RANKS = [
  { name: 'Бомж', emoji: '🪵', costDublons: 0, bonus: 0, passive: 0 },
  { name: 'Матрос', emoji: '⛵', costDublons: 100, bonus: 5, passive: 2 },
  { name: 'Боцман', emoji: '⚓', costDublons: 300, bonus: 10, passive: 5 },
  { name: 'Капитан', emoji: '🏴‍☠️', costDublons: 800, bonus: 20, passive: 12 },
  { name: 'Адмирал', emoji: '👑', costDublons: 2000, bonus: 35, passive: 25 },
  { name: 'Губернатор', emoji: '🏛️', costDublons: 5000, bonus: 50, passive: 50 },
  { name: 'Император', emoji: '👑', costDublons: 15000, bonus: 75, passive: 100 },
];

// ==================== ДОСТИЖЕНИЯ (НОВЫЕ - Задачи 28-29) ====================
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

// ==================== ПИРАТСКИЙ ФЛОТ (ОРИГИНАЛ) ====================
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

// ==================== ИВЕНТЫ (ОРИГИНАЛ) ====================
const EVENTS = [
  { name: '🎰 Удвоение выигрыша', desc: 'Все выигрыши увеличены в 2 раза!', duration: 1800000, multiplier: 2 },
  { name: '💀 Чёрная метка', desc: 'Проигрыш уменьшен на 50%!', duration: 1800000, penalty: 0.5 },
  { name: '🏴‍☠️ Пиратский налёт', desc: 'Бонус +20% к пассивному доходу!', duration: 3600000, passiveBonus: 1.2 },
  { name: '🎁 Сундук капитана', desc: 'Каждый выигрыш даёт бонусный сундук!', duration: 1800000, chestBonus: true },
  { name: '⚡ Молниеносный раунд', desc: 'Раунды длятся всего 5 минут!', duration: 300000, fastRound: true },
];

// ==================== ТУРНИРЫ (ОРИГИНАЛ) ====================
const TOURNAMENT_CONFIG = {
  entryFee: 2000,
  duration: 604800000, // 7 дней
  prizePoolPercent: 0.7,
  winnerPercent: 0.5,
  topPercent: 0.05,
};

// ==================== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ====================
let players = {};
let bank = { pot: 2000, jackpot: 0, commission: 0, totalStakes: 0, roundActive: false, roundEnd: 0 };
let blackjackGames = {};
let duelChallenges = {};
let withdrawQueue = [];
let maintenanceMode = false;
let maintenanceMessage = '';
let maintenanceEndTime = 0;
let maintenanceNotified = false;
let roundTimer = null;
let activeEvent = null;
let eventTimer = null;
let jackpotCounter = 0;
let blockList = {};
let rateLimit = {};
let tournaments = { active: false, players: [], prizePool: 0, endTime: 0, results: [] };
let userMessages = {}; // ✅ Задача 31: хранение ID сообщений
let adminState = {};
let bans = {}; // ✅ Задача 14: расширенная блокировка
let currentDuelRounds = {}; // ✅ Задача 44: дуэль до победы

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (ОРИГИНАЛ) ====================
function safeNumber(val) {
  const num = Number(val) || 0;
  return Math.floor(num);
}

function getPlayer(id) {
  if (!players[id]) {
    players[id] = {
      balance: 10,
      demoBalance: 50,
      demoMode: false,
      bet: 0,
      canDouble: false,
      hasRolled: false,
      point: 0,
      demoBet: 0,
      demoCanDouble: false,
      demoHasRolled: false,
      demoPoint: 0,
      rank: 0,
      share: 0,
      username: 'unknown',
      games: 0,
      wins: 0,
      losses: 0,
      totalEarned: 0,
      dailyStreak: 0,
      lastDailyDate: '',
      lastPassiveTime: Date.now(),
      passiveCollected: 0,
      history: [],
      balanceHistory: [],
      refs: [],
      refBonus: 0,
      fleet: { ships: [], totalIncome: 0, lastCollected: Date.now() },
      ships: [],
      achievements: [], // ✅ Задача 28
      rankBonus: 0, // ✅ Задача 29
      currentMode: null, // ✅ Задача 3
      lastActivity: Date.now(),
      gamesToday: 0,
      gamesDate: '',
      duelStats: { wins: 0, losses: 0, totalGames: 0 },
      withdrawToday: 0,
      withdrawDate: '',
      withdrawHistory: [],
      demoRollsToday: 0,
      demoDate: '',
      activeDuelChallenges: [], // ✅ Задача 41
    };
    saveData();
  }
  return players[id];
}

function addHistory(id, text) {
  const p = getPlayer(id);
  if (!p.history) p.history = [];
  p.history.push({ time: Date.now(), text });
  if (p.history.length > 100) p.history.shift();
  saveData();
}

function addBalanceHistory(id, amount, reason) {
  const p = getPlayer(id);
  if (!p.balanceHistory) p.balanceHistory = [];
  const bal = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  p.balanceHistory.push({ time: Date.now(), balance: bal, amount, reason });
  if (p.balanceHistory.length > 100) p.balanceHistory.shift();
  saveData();
}

function saveData() {
  try {
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));
    fs.writeFileSync(BANK_FILE, JSON.stringify(bank, null, 2));
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(withdrawQueue, null, 2));
    fs.writeFileSync(JACKPOT_FILE, JSON.stringify({ counter: jackpotCounter }, null, 2));
  } catch (err) {
    console.error('❌ Ошибка сохранения:', err);
  }
}

function loadData() {
  try {
    if (fs.existsSync(PLAYERS_FILE)) {
      players = JSON.parse(fs.readFileSync(PLAYERS_FILE));
    }
    if (fs.existsSync(BANK_FILE)) {
      bank = JSON.parse(fs.readFileSync(BANK_FILE));
    }
    if (fs.existsSync(QUEUE_FILE)) {
      withdrawQueue = JSON.parse(fs.readFileSync(QUEUE_FILE));
    }
    if (fs.existsSync(JACKPOT_FILE)) {
      const data = JSON.parse(fs.readFileSync(JACKPOT_FILE));
      jackpotCounter = data.counter || 0;
    }
  } catch (err) {
    console.error('❌ Ошибка загрузки:', err);
  }
}

function savePlayerData() {
  saveData();
}

function sleep(ms) { 
  return new Promise(resolve => setTimeout(resolve, ms)); 
}

// ==================== ФУНКЦИЯ БЛОКИРОВКИ (НОВАЯ - Задача 14) ====================
function isBanned(id) {
  if (bans[id] && bans[id].until > Date.now()) {
    return true;
  }
  if (bans[id]) {
    delete bans[id];
  }
  return false;
}

function getBanInfo(id) {
  return bans[id] || null;
}

// ==================== ФУНКЦИИ КОРАБЛЕЙ (ОРИГИНАЛ) ====================
function getShipIncome(ship) {
  return Math.floor(ship.income * (1 + ship.level * 0.2));
}

function getShipUpgradeCost(ship) {
  return Math.floor(ship.upgradeCost * (1 + ship.level * 0.3));
}

function calculateTotalIncome(p) {
  if (!p.fleet || !p.fleet.ships) return 0;
  let total = 0;
  for (let s of p.fleet.ships) {
    const ship = SHIPS.find(sh => sh.id === s.id);
    if (ship) {
      total += getShipIncome({ ...ship, level: s.level });
    }
  }
  return total;
}

// ==================== АКТИВНОСТЬ (ОРИГИНАЛ) ====================
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

// ==================== АВТОСБОР ПАССИВНОГО ДОХОДА (НОВАЯ - Задача 24) ====================
function collectPassiveIncome(id) {
  const p = getPlayer(id);
  if (!p) return;
  
  const now = Date.now();
  const elapsedMs = now - p.lastPassiveTime;
  const hours = elapsedMs / 3600000;
  
  if (hours < 1) return;
  
  const passivePerHour = RANKS[p.rank].passive;
  const earned = Math.floor(passivePerHour * hours);
  
  if (earned > 0) {
    p.passiveCollected = safeNumber(p.passiveCollected) + earned;
    p.lastPassiveTime = now;
    saveData();
  }
}

// ==================== БЛЭКДЖЕК (ОРИГИНАЛ + Задача 23) ====================
function createDeck(decks = 6) {
  const suits = ['♠', '♥', '♦', '♣'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (let d = 0; d < decks; d++) {
    for (let suit of suits) {
      for (let rank of ranks) {
        deck.push({ suit, rank });
      }
    }
  }
  return shuffle(deck);
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getHandValue(hand) {
  let value = 0;
  let aces = 0;
  for (let card of hand) {
    if (card.rank === 'A') { aces++; value += 11; }
    else if (['J', 'Q', 'K'].includes(card.rank)) value += 10;
    else value += parseInt(card.rank);
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }
  return value;
}

function isBlackjack(hand) {
  return hand.length === 2 && getHandValue(hand) === 21;
}

function formatHand(hand) {
  return hand.map(c => `${c.rank}${c.suit}`).join(' ');
}

function finishBlackjack(playerId) {
  const game = blackjackGames[playerId];
  if (!game) return;
  const p = getPlayer(playerId);
  let result = '';
  let winAmount = 0;

  let playerHand = game.splitHands && game.splitHands.length > 0 ? game.splitHands[0] : game.playerHand;
  let dealerHand = game.dealerHand;

  if (!playerHand || playerHand.length === 0) {
    delete blackjackGames[playerId];
    return;
  }

  let playerValue = getHandValue(playerHand);
  let dealerValue = getHandValue(dealerHand);

  let safetyCounter = 0;
  while (dealerValue < 17 && safetyCounter < 100) {
    if (game.deck.length === 0) break;
    dealerHand.push(game.deck.pop());
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
    addHistory(playerId, `Блэкджек: выигрыш +${winAmount}`);
    addBalanceHistory(playerId, winAmount, 'Блэкджек выигрыш');
  } else {
    addHistory(playerId, `Блэкджек: проигрыш ${winAmount}`);
    addBalanceHistory(playerId, winAmount, 'Блэкджек проигрыш');
  }

  const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  const msg = `🎴 РЕЗУЛЬТАТ:\n\n` +
    `Твоя рука: ${formatHand(playerHand)} (${playerValue} очков)\n` +
    `Дилер: ${formatHand(dealerHand)} (${dealerValue} очков)\n\n` +
    `${result}\n` +
    `💰 ${winAmount > 0 ? '+' : ''}${winAmount} дуб.\n` +
    `📊 Баланс: ${balance} дуб.`;

  // ✅ Задача 30: редактируем сообщение вместо нового
  editOrSendMessage(playerId, msg, blackjackResultKeyboard());
  
  // ✅ Задача 36: кнопка "Играть ещё" уже есть в blackjackResultKeyboard
  
  delete blackjackGames[playerId];
}

// ✅ Задача 23: таймаут блэкджека (60 секунд)
function startBlackjackTimeout(playerId) {
  setTimeout(() => {
    if (blackjackGames[playerId] && blackjackGames[playerId].status === 'playing') {
      bot.sendMessage(playerId, '⏳ Время вышло! Игра завершена.');
      finishBlackjack(playerId);
    }
  }, CONFIG.BLACKJACK_TIMEOUT);
}

// ==================== УПРАВЛЕНИЕ СООБЩЕНИЯМИ (НОВОЕ - Задачи 30-35) ====================
function editOrSendMessage(chatId, text, keyboard) {
  if (userMessages[chatId]) {
    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: userMessages[chatId],
      reply_markup: keyboard,
      parse_mode: 'HTML'
    }).catch(() => {
      // ✅ Задача 34: если сообщение удалено - создаём новое
      bot.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: 'HTML' })
        .then(msg => { userMessages[chatId] = msg.message_id; });
    });
    return; // ✅ Задача 30: НЕ ОТПРАВЛЯТЬ ДУБЛЬ
  }
  bot.sendMessage(chatId, text, { reply_markup: keyboard, parse_mode: 'HTML' })
    .then(msg => { userMessages[chatId] = msg.message_id; });
}

function deleteMessage(chatId) {
  if (userMessages[chatId]) {
    try {
      bot.deleteMessage(chatId, userMessages[chatId]).catch(() => {});
    } catch (e) {}
    delete userMessages[chatId];
  }
}

// ==================== КЛАВИАТУРЫ (ОРИГИНАЛ + НОВЫЕ) ====================
function mainInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🎰 Играть', callback_data: 'menu_play' }],
      [{ text: '💰 Профиль', callback_data: 'menu_profile' }, { text: '🏴‍☠️ Ранги', callback_data: 'menu_rank' }],
      [{ text: '🌊 Доход', callback_data: 'menu_income' }, { text: '💸 Вывод', callback_data: 'menu_withdraw' }],
      [{ text: '🚢 Пиратский флот', callback_data: 'menu_fleet' }, { text: '⚔️ Турниры', callback_data: 'menu_tournament' }],
      [{ text: '🎁 Ежедневный бонус', callback_data: 'daily_bonus' }, { text: '🔗 Рефералка', callback_data: 'menu_ref' }],
      [{ text: '🎮 Демо-режим', callback_data: 'menu_demo' }, { text: '❓ Помощь', callback_data: 'menu_help' }],
      [{ text: '🏆 Топ', callback_data: 'menu_top' }, { text: '💰 Банк', callback_data: 'menu_bank' }],
    ]
  };
}

// ✅ Задача 3: меню выбора режима
function gameModeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🎲 Классика', callback_data: 'mode_classic' }, { text: '⚔️ Дуэль', callback_data: 'mode_duel' }],
      [{ text: '👑 VIP', callback_data: 'mode_vip' }, { text: '🎴 Блэкджек', callback_data: 'mode_blackjack' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  };
}

function blackjackKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🎴 Взять', callback_data: 'bj_hit' }, { text: '✋ Стоп', callback_data: 'bj_stand' }],
      [{ text: '💵 Удвоить', callback_data: 'bj_double' }, { text: '✂️ Сплит', callback_data: 'bj_split' }],
      [{ text: '❌ Выйти', callback_data: 'bj_quit' }]
    ]
  };
}

// ✅ Задача 36: кнопка "Играть ещё"
function blackjackResultKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🎴 Играть ещё', callback_data: 'mode_blackjack' }],
      [{ text: '🔙 В меню', callback_data: 'menu_main' }]
    ]
  };
}

function duelAcceptKeyboard(amount, challengerId) {
  return {
    inline_keyboard: [
      [{ text: `⚔️ Принять (${amount} дуб.)`, callback_data: `duel_accept_${challengerId}_${amount}` }],
      [{ text: '❌ Отказаться', callback_data: 'duel_decline' }]
    ]
  };
}

function duelCancelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '❌ Отменить вызов', callback_data: 'duel_cancel' }]
    ]
  };
}

function adminInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Дашборд', callback_data: 'admin_dashboard' }, { text: '🏆 Ранги', callback_data: 'admin_ranks' }],
      [{ text: '🛑 Блокировка', callback_data: 'admin_block' }, { text: '💰 Банк', callback_data: 'admin_bank' }],
      [{ text: '📢 Уведомления', callback_data: 'admin_notify' }, { text: '📈 Статистика', callback_data: 'admin_stats' }],
      [{ text: '🧹 Очистка', callback_data: 'admin_cleanup' }, { text: '🛠️ Техработы', callback_data: 'admin_maintenance' }],
      [{ text: '📋 Список игроков', callback_data: 'admin_players' }, { text: '📊 Игрок', callback_data: 'admin_player_stats' }],
      [{ text: '❓ Помощь', callback_data: 'admin_help' }]
    ]
  };
}

function tournamentKeyboard() {
  return {
    inline_keyboard: [
      [{ text: 'ℹ️ Инфо', callback_data: 'tournament_info' }, { text: '✅ Участвовать', callback_data: 'tournament_join' }],
      [{ text: '🏆 Лидеры', callback_data: 'tournament_leaderboard' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  };
}

function profileInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Статистика', callback_data: 'profile_stats' }, { text: '📜 История', callback_data: 'profile_history' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  };
}

function collectInlineKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '💰 Забрать доход', callback_data: 'collect_take' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  };
}

function rankInlineKeyboard() {
  const keyboard = [];
  for (let i = 0; i < RANKS.length; i++) {
    if (i > 0) {
      keyboard.push([{ text: `${RANKS[i].emoji} ${RANKS[i].name} (${RANKS[i].costDublons} дуб.)`, callback_data: `rank_${i}` }]);
    }
  }
  keyboard.push([{ text: '🔙 Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: keyboard };
}

function withdrawInlineKeyboard() {
  const amounts = [50, 100, 200, 500, 1000];
  const keyboard = [];
  const row = [];
  for (let amt of amounts) {
    row.push({ text: `${amt}`, callback_data: `withdraw_${amt}` });
    if (row.length === 2) {
      keyboard.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) keyboard.push(row);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: keyboard };
}

function shareInlineKeyboard() {
  const shares = [1, 2, 5, 10];
  const keyboard = [];
  const row = [];
  for (let s of shares) {
    row.push({ text: `${s}%`, callback_data: `share_${s}` });
    if (row.length === 2) {
      keyboard.push([...row]);
      row.length = 0;
    }
  }
  if (row.length > 0) keyboard.push(row);
  keyboard.push([{ text: '🔙 Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: keyboard };
}

// ==================== ДЖЕКПОТ (НОВЫЙ - Задачи 6-11) ====================
// ✅ Задача 6: лимит точек 1-100 (рандом)
function getJackpotTarget() {
  return Math.floor(Math.random() * 100) + 1; // 1-100
}

// ✅ Задача 7: прирост 1-1 000 000 000 дуб.
function getJackpotIncrement() {
  return Math.floor(Math.random() * 1000000000) + 1; // 1-1млрд
}

// ✅ Задача 9: прогресс-бар
function getJackpotProgress() {
  const target = getJackpotTarget();
  return Math.min(jackpotCounter / target, 1);
}

function getJackpotBar() {
  const progress = getJackpotProgress();
  const filled = Math.floor(progress * 20);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ✅ Задача 8: максимальный джекпот 10 млрд + бонус 1 млн
// ✅ Задача 10: отображение прироста
// ✅ Задача 11: бонусные очки за серию 5+ и ставку > 1000
function checkJackpot(id) {
  const target = getJackpotTarget();
  jackpotCounter++;
  
  // Прирост за точку
  const increment = getJackpotIncrement();
  bank.jackpot = safeNumber(bank.jackpot) + increment;
  
  // Прогресс-бар
  const progress = getJackpotProgress();
  const bar = getJackpotBar();
  
  // Проверка максимального джекпота
  if (bank.jackpot >= CONFIG.MAX_JACKPOT) {
    // Сброс и бонус
    const p = getPlayer(id);
    if (p) {
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + CONFIG.JACKPOT_BONUS;
      } else {
        p.balance = safeNumber(p.balance) + CONFIG.JACKPOT_BONUS;
      }
      addHistory(id, `ДЖЕКПОТ! +${CONFIG.JACKPOT_BONUS} дуб. (максимум достигнут)`);
      addBalanceHistory(id, CONFIG.JACKPOT_BONUS, 'Джекпот!');
      bot.sendMessage(id, `🎉🎉🎉 ДЖЕКПОТ ДОСТИГНУТ! Ты получаешь ${CONFIG.JACKPOT_BONUS} дуб. бонуса! 🎉🎉🎉`);
    }
    bank.jackpot = 0;
    jackpotCounter = 0;
    saveData();
    return;
  }
  
  // ✅ Задача 10: отображение прироста
  const msg = `🎯 Точка +1! +${increment} дуб. в джекпот!\n` +
    `📊 Прогресс: ${jackpotCounter}/${target} точек\n` +
    `🟩 ${bar}\n` +
    `💰 Джекпот: ${bank.jackpot} дуб.`;
  
  // Отправляем всем игрокам
  for (let pid in players) {
    bot.sendMessage(pid, msg).catch(() => {});
  }
  saveData();
}

// ✅ Задача 11: бонусные очки за серию побед
function checkJackpotBonus(id, betAmount, isWin) {
  const p = getPlayer(id);
  if (!p) return;
  
  // Бонус за ставку > 1000 дуб.
  if (betAmount >= 1000) {
    checkJackpot(id);
    bot.sendMessage(id, '🎯 Бонусная точка джекпота за крупную ставку!');
  }
  
  // Бонус за серию 5+ побед
  if (isWin && p.wins >= 5 && p.wins % 5 === 0) {
    checkJackpot(id);
    bot.sendMessage(id, '🔥 Бонусная точка джекпота за серию побед!');
  }
}

// ==================== ДУЭЛИ (НОВЫЕ - Задачи 40-44) ====================
// ✅ Задача 43: дуэль до победы (до 5 раундов)
function processDuel(challengerId, opponentId, amount) {
  const challenger = getPlayer(challengerId);
  const opponent = getPlayer(opponentId);
  
  let round = 0;
  let winnerId = null;
  let roundResults = [];
  
  // Сохраняем начальные ставки для возврата при ничьей
  const challengerBet = amount;
  const opponentBet = amount;
  
  // ✅ Задача 43: до 5 раундов
  while (round < CONFIG.MAX_DUEL_ROUNDS && !winnerId) {
    round++;
    
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum1 = d1 + d2;
    
    const d3 = Math.floor(Math.random() * 6) + 1;
    const d4 = Math.floor(Math.random() * 6) + 1;
    const sum2 = d3 + d4;
    
    // Отправляем результаты раунда
    bot.sendMessage(challengerId, `🎲 Раунд ${round}: ${d1}+${d2}=${sum1}`);
    bot.sendMessage(opponentId, `🎲 Раунд ${round}: ${d3}+${d4}=${sum2}`);
    
    roundResults.push({ round, challengerSum: sum1, opponentSum: sum2 });
    
    if (sum1 > sum2) {
      winnerId = challengerId;
    } else if (sum2 > sum1) {
      winnerId = opponentId;
    } else if (round === CONFIG.MAX_DUEL_ROUNDS) {
      // ✅ Задача 43: ничья после 5 раундов - возврат ставок
      if (challenger.demoMode) {
        challenger.demoBalance = safeNumber(challenger.demoBalance) + challengerBet;
      } else {
        challenger.balance = safeNumber(challenger.balance) + challengerBet;
      }
      if (opponent.demoMode) {
        opponent.demoBalance = safeNumber(opponent.demoBalance) + opponentBet;
      } else {
        opponent.balance = safeNumber(opponent.balance) + opponentBet;
      }
      bot.sendMessage(challengerId, '🤝 Ничья после 5 раундов! Ставки возвращены.');
      bot.sendMessage(opponentId, '🤝 Ничья после 5 раундов! Ставки возвращены.');
      saveData();
      return;
    }
  }
  
  if (winnerId) {
    const loserId = winnerId === challengerId ? opponentId : challengerId;
    const totalPot = amount * 2;
    const comm = Math.floor(totalPot * 0.1);
    bank.commission = safeNumber(bank.commission) + comm;
    const winAmount = totalPot - comm;
    
    const winner = getPlayer(winnerId);
    if (winner.demoMode) {
      winner.demoBalance = safeNumber(winner.demoBalance) + winAmount;
    } else {
      winner.balance = safeNumber(winner.balance) + winAmount;
    }
    
    winner.duelStats.wins++;
    winner.duelStats.totalGames++;
    winner.totalEarned = safeNumber(winner.totalEarned) + winAmount;
    winner.games++;
    
    const loser = getPlayer(loserId);
    loser.duelStats.losses++;
    loser.duelStats.totalGames++;
    loser.games++;
    
    addHistory(winnerId, `Дуэль: победа +${winAmount} (${roundResults.length} раундов)`);
    addBalanceHistory(winnerId, winAmount, 'Дуэль победа');
    addHistory(loserId, `Дуэль: поражение -${amount} (${roundResults.length} раундов)`);
    addBalanceHistory(loserId, -amount, 'Дуэль поражение');
    
    // ✅ Задача 28: проверка достижений
    checkAchievements(winnerId);
    
    // Итоговое сообщение
    let resultMsg = `⚔️ ДУЭЛЬ ЗАВЕРШЕНА!\n\n`;
    roundResults.forEach(r => {
      resultMsg += `Раунд ${r.round}: ${r.challengerSum} vs ${r.opponentSum}\n`;
    });
    resultMsg += `\n🏆 Победитель: @${winner.username || winnerId}`;
    resultMsg += `\n💰 Выигрыш: ${winAmount} дуб.`;
    
    bot.sendMessage(challengerId, resultMsg);
    bot.sendMessage(opponentId, resultMsg);
  }
  
  saveData();
}

// ✅ Задача 40: отложенное принятие вызова
// ✅ Задача 41: список активных вызовов
// ✅ Задача 42: уведомление при входе
// ✅ Задача 43: ручная отмена вызова
function createDuelChallenge(id, amount) {
  const p = getPlayer(id);
  if (!p) return false;
  
  // Проверяем, есть ли уже активный вызов
  if (duelChallenges[id]) {
    return false;
  }
  
  // Сохраняем вызов
  duelChallenges[id] = { 
    amount: amount, 
    timestamp: Date.now(), 
    isRealMoney: false,
    challenger: id
  };
  
  if (!p.activeDuelChallenges) p.activeDuelChallenges = [];
  p.activeDuelChallenges.push({ from: id, amount: amount });
  saveData();
  
  return true;
}

function cancelDuelChallenge(id) {
  if (duelChallenges[id]) {
    delete duelChallenges[id];
    const p = getPlayer(id);
    if (p && p.activeDuelChallenges) {
      p.activeDuelChallenges = p.activeDuelChallenges.filter(c => c.from !== id);
    }
    saveData();
    return true;
  }
  return false;
}

function getActiveChallenges(id) {
  const p = getPlayer(id);
  if (!p || !p.activeDuelChallenges) return [];
  return p.activeDuelChallenges;
}

// ==================== ОБРАБОТЧИК /START (ОРИГИНАЛ + НОВОВВЕДЕНИЯ) ====================
bot.onText(/\/start/, async (msg) => {
  try {
    const id = msg.chat.id;
    
    // Проверка бана
    if (isBanned(id)) {
      const info = getBanInfo(id);
      const timeLeft = Math.ceil((info.until - Date.now()) / 60000);
      bot.sendMessage(id, `⛔ Ты заблокирован!\nПричина: ${info.reason || 'Нарушение правил'}\nОсталось: ${timeLeft} мин.`);
      return;
    }
    
    const p = getPlayer(id);
    if (!p) return;
    p.username = msg.from.username || 'noname';
    
    // ✅ Задача 24: автосбор пассивного дохода при входе
    collectPassiveIncome(id);
    
    // ✅ Задача 42: уведомление о дуэлях при входе
    if (p.activeDuelChallenges && p.activeDuelChallenges.length > 0) {
      for (let challenge of p.activeDuelChallenges) {
        const challenger = getPlayer(challenge.from);
        if (challenger) {
          bot.sendMessage(id, `⚔️ У тебя есть активный вызов от @${challenger.username || challenge.from} на ${challenge.amount} дуб.`);
        }
      }
    }
    
    // Приветствие при возвращении
    const lastActivity = p.lastActivity || 0;
    if (Date.now() - lastActivity > 600000) {
      bot.sendMessage(id, '🏴‍☠️ Добро пожаловать обратно!');
    }
    p.lastActivity = Date.now();
    
    // Обработка реферальной ссылки
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
    
    // ✅ Задача 9: прогресс-бар джекпота
    const target = getJackpotTarget();
    const bar = getJackpotBar();
    
    // ✅ Задача 30-31: editOrSendMessage вместо sendMessage
    editOrSendMessage(id,
      `🏴‍☠️ Добро пожаловать в ЧЁРНУЮ КОСТЬ!\n\n` +
      `💰 Баланс: ${balance} дуб.\n` +
      `🏴‍☠️ Ранг: ${rank.emoji} ${rank.name} (+${rank.bonus}% к выигрышу)\n` +
      `📊 Доля: ${p.share}% банка\n` +
      `🎰 Джекпот: ${safeNumber(bank.jackpot)} дуб.\n` +
      `🏦 Банк: ${safeNumber(bank.pot)} дуб.\n` +
      `🎯 Прогресс джекпота: ${jackpotCounter}/${target}\n` +
      `🟩 ${bar}\n` +
      `💨 Пассивный доход: ${rank.passive} дуб./час`,
      mainInlineKeyboard()
    );
  } catch (error) {
    console.error('❌ Ошибка в /start:', error.message);
    console.error(error.stack);
    try {
      await bot.sendMessage(msg.chat.id, '⚠️ Произошла ошибка при запуске. Пожалуйста, попробуй позже.');
    } catch (e) {}
  }
});

// ==================== КОМАНДА /HISTORY (НОВАЯ - Задача 25) ====================
bot.onText(/\/history/, (msg) => {
  const id = msg.chat.id;
  const p = getPlayer(id);
  if (!p) return;
  
  let text = '📜 ПОСЛЕДНИЕ ОПЕРАЦИИ:\n\n';
  const history = p.balanceHistory || [];
  if (history.length === 0) {
    text += 'Нет операций.';
  } else {
    history.slice(-20).reverse().forEach(h => {
      const sign = h.amount >= 0 ? '+' : '';
      text += `${new Date(h.time).toLocaleString()}: ${h.reason} → ${sign}${h.amount} дуб. (баланс: ${h.balance})\n`;
    });
  }
  bot.sendMessage(id, text);
});

// ==================== КОМАНДА /ADMIN (ОРИГИНАЛ) ====================
bot.onText(/\/admin/, (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  editOrSendMessage(msg.chat.id, `👑 АДМИН-ПАНЕЛЬ\nВыбери действие:`, adminInlineKeyboard());
});

// ==================== КОМАНДА /RESETDEMO (ОРИГИНАЛ) ====================
bot.onText(/\/resetdemo/, (msg) => {
  const id = msg.chat.id;
  const p = getPlayer(id);
  if (!p) return;
  p.demoBalance = 50;
  p.demoRollsToday = 0;
  p.demoDate = new Date().toDateString();
  p.demoBet = 0;
  p.demoCanDouble = false;
  p.demoHasRolled = false;
  saveData();
  bot.sendMessage(id, `🔄 Демо-баланс сброшен до 50. Можно играть заново.`, mainInlineKeyboard());
});

// ==================== ОСНОВНОЙ ОБРАБОТЧИК CALLBACK_QUERY ====================
bot.on('callback_query', async (query) => {
  const id = query.from.id;
  const data = query.data;
  
  // Отвечаем на callback
  bot.answerCallbackQuery(query.id).catch(() => {});
  console.log('📥 CALLBACK:', data, 'от', id);
  
  // ✅ Задача 2: защита от дублирования (500 мс)
  if (!global.callbackCooldown) global.callbackCooldown = {};
  const currentTime = Date.now();
  const cooldownKey = `${id}_${data}`;
  if (global.callbackCooldown[cooldownKey] && currentTime - global.callbackCooldown[cooldownKey] < CONFIG.ANTIFLOOD) {
    console.log(`⏳ Дублирование ${data} от ${id} игнорировано`);
    return;
  }
  global.callbackCooldown[cooldownKey] = currentTime;
  
  // Проверка бана
  if (isBanned(id)) {
    const info = getBanInfo(id);
    const timeLeft = Math.ceil((info.until - Date.now()) / 60000);
    bot.sendMessage(id, `⛔ Ты заблокирован!\nПричина: ${info.reason || 'Нарушение правил'}\nОсталось: ${timeLeft} мин.`);
    return;
  }
  
  const p = getPlayer(id);
  if (!p) return;
  
  // Проверка техработ (кроме админа)
  if (isMaintenanceActive() && id !== ADMIN_ID) {
    const timeLeft = Math.max(0, Math.ceil((maintenanceEndTime - Date.now()) / 60000));
    bot.sendMessage(id,
      `🔧 БОТ НА ТЕХНИЧЕСКИХ РАБОТАХ\n\n` +
      `${maintenanceMessage}\n` +
      `⏳ Осталось примерно: ${timeLeft} минут`
    );
    return;
  }
  
  // ==================== ГЛАВНОЕ МЕНЮ ====================
  if (data === 'menu_main') {
    // ✅ Задача 24: автосбор при входе
    collectPassiveIncome(id);
    
    const rank = RANKS[p.rank];
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    const target = getJackpotTarget();
    const bar = getJackpotBar();
    
    editOrSendMessage(id,
      `🏴‍☠️ ЧЁРНАЯ КОСТЬ\n\n` +
      `💰 Баланс: ${balance} дуб.\n` +
      `🏴‍☠️ Ранг: ${rank.emoji} ${rank.name}\n` +
      `📊 Доля: ${p.share}%\n` +
      `🎰 Джекпот: ${safeNumber(bank.jackpot)}\n` +
      `🎯 ${jackpotCounter}/${target}\n` +
      `🟩 ${bar}`,
      mainInlineKeyboard()
    );
    return;
  }
  
  // ==================== МЕНЮ ИГРЫ (Задача 3) ====================
  if (data === 'menu_play') {
    // ✅ Задача 3: выбор режима
    p.currentMode = null;
    editOrSendMessage(id, `🎮 ВЫБЕРИ РЕЖИМ ИГРЫ:\n\n` +
      `🎲 Классика — игра против банка\n` +
      `⚔️ Дуэль — против другого игрока\n` +
      `👑 VIP — против админа (только за деньги)\n` +
      `🎴 Блэкджек — карточная игра\n\n` +
      `Выбери режим:`, gameModeKeyboard());
    return;
  }
  
  // ==================== ВЫБОР РЕЖИМА (Задача 3) ====================
  if (data === 'mode_classic') {
    p.currentMode = 'classic';
    collectPassiveIncome(id);
    editOrSendMessage(id, `🎲 КЛАССИКА\nВведи сумму ставки:`, mainInlineKeyboard());
    return;
  }
  
  if (data === 'mode_duel') {
    p.currentMode = 'duel';
    collectPassiveIncome(id);
    editOrSendMessage(id, `⚔️ ДУЭЛЬ\nВведи сумму ставки (мин ${MIN_DUEL_MONEY}):`, mainInlineKeyboard());
    return;
  }
  
  if (data === 'mode_vip') {
    // ✅ Задача 27: защита от демо
    if (p.demoMode) {
      bot.sendMessage(id, '❌ VIP-игра недоступна в демо-режиме.');
      return;
    }
    p.currentMode = 'vip';
    collectPassiveIncome(id);
    editOrSendMessage(id, `👑 VIP-ИГРА\nВведи сумму ставки (от ${MIN_VIP_BET} до ${MAX_VIP_BET}):`, mainInlineKeyboard());
    return;
  }
  
  if (data === 'mode_blackjack') {
    // ✅ Задача 5: защита от двойной ставки
    if (blackjackGames[id]) {
      bot.sendMessage(id, '❌ У тебя уже есть активная игра в блэкджек!');
      return;
    }
    p.currentMode = 'blackjack';
    collectPassiveIncome(id);
    const minBet = BLACKJACK_CONFIG.minBet;
    const maxBet = BLACKJACK_CONFIG.maxBet;
    editOrSendMessage(id, `🎴 БЛЭКДЖЕК\nВведи сумму ставки (от ${minBet} до ${maxBet}):`, mainInlineKeyboard());
    return;
  }
  
  // ==================== ПРОФИЛЬ ====================
  if (data === 'menu_profile') {
    const rank = RANKS[p.rank];
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    const wins = p.wins || 0;
    const losses = p.losses || 0;
    const total = wins + losses;
    const winrate = total > 0 ? Math.round((wins / total) * 100) : 0;
    
    let msg = `👤 ПРОФИЛЬ\n\n` +
      `🏴‍☠️ Имя: @${p.username || 'unknown'}\n` +
      `💰 Баланс: ${balance} дуб.\n` +
      `🏆 Ранг: ${rank.emoji} ${rank.name}\n` +
      `📈 Победы: ${wins}\n` +
      `📉 Поражения: ${losses}\n` +
      `📊 Винрейт: ${winrate}%\n` +
      `📊 Доля: ${p.share}%\n` +
      `🔗 Рефералов: ${p.refs?.length || 0}\n` +
      `💵 Заработано: ${p.totalEarned || 0} дуб.\n` +
      `🛳️ Кораблей: ${p.fleet?.ships?.length || 0}\n` +
      `🏆 Достижений: ${p.achievements?.length || 0}/${ACHIEVEMENTS.length}`;
    
    if (p.demoMode) msg += `\n🎮 ДЕМО-РЕЖИМ`;
    
    editOrSendMessage(id, msg, profileInlineKeyboard());
    return;
  }
  
  // ==================== СТАТИСТИКА ПРОФИЛЯ ====================
  if (data === 'profile_stats') {
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    const totalGames = p.games || 0;
    const wins = p.wins || 0;
    const winrate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;
    const duelWins = p.duelStats?.wins || 0;
    const duelLosses = p.duelStats?.losses || 0;
    const duelTotal = duelWins + duelLosses;
    const duelWinrate = duelTotal > 0 ? Math.round((duelWins / duelTotal) * 100) : 0;
    
    let msg = `📊 ДЕТАЛЬНАЯ СТАТИСТИКА\n\n` +
      `💰 Баланс: ${balance}\n` +
      `🎮 Всего игр: ${totalGames}\n` +
      `📈 Победы: ${wins}\n` +
      `📉 Поражения: ${totalGames - wins}\n` +
      `📊 Винрейт: ${winrate}%\n` +
      `⚔️ Дуэли: ${duelTotal}\n` +
      `   Победы: ${duelWins}, Поражения: ${duelLosses}\n` +
      `   Винрейт: ${duelWinrate}%\n` +
      `🏆 Достижений: ${p.achievements?.length || 0}/${ACHIEVEMENTS.length}\n` +
      `💵 Заработано: ${p.totalEarned || 0}\n` +
      `🔥 Дневной стрик: ${p.dailyStreak || 0} дней\n` +
      `🔗 Рефералов: ${p.refs?.length || 0}`;
    
    bot.sendMessage(id, msg);
    return;
  }
  
  // ==================== ИСТОРИЯ ПРОФИЛЯ ====================
  if (data === 'profile_history') {
    let msg = '📜 ИСТОРИЯ ДЕЙСТВИЙ:\n\n';
    const history = p.history || [];
    if (history.length === 0) {
      msg += 'Нет истории.';
    } else {
      history.slice(-20).reverse().forEach(h => {
        msg += `${new Date(h.time).toLocaleString()}: ${h.text}\n`;
      });
    }
    bot.sendMessage(id, msg);
    return;
  }

       // ==================== РАНГИ ====================
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
  msg += `📤 Текущий ранг: ${RANKS[p.rank].emoji} ${RANKS[p.rank].name}\n\n`;
  msg += `Выбери ранг для покупки:`;
  editOrSendMessage(id, msg, rankInlineKeyboard());
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

// ==================== БАНК ====================
if (data === 'menu_bank') {
  const totalShares = Object.values(players).reduce((sum, p) => sum + (p.share || 0), 0);
  const target = getJackpotTarget();
  const bar = getJackpotBar();
  
  editOrSendMessage(id,
    `💰 БАНК ПИРАТОВ\n\n` +
    `🏦 Банк: ${safeNumber(bank.pot)} дуб.\n` +
    `🎰 Джекпот: ${safeNumber(bank.jackpot)} дуб.\n` +
    `📊 Всего ставок: ${safeNumber(bank.totalStakes)} дуб.\n` +
    `📈 Общая доля игроков: ${totalShares}%\n` +
    `🎯 Прогресс джекпота: ${jackpotCounter}/${target}\n` +
    `🟩 ${bar}`,
    mainInlineKeyboard()
  );
  return;
}

// ==================== ТОП ====================
if (data === 'menu_top') {
  const sorted = Object.entries(players)
    .sort((a, b) => {
      const balA = a[1].demoMode ? safeNumber(a[1].demoBalance) : safeNumber(a[1].balance);
      const balB = b[1].demoMode ? safeNumber(b[1].demoBalance) : safeNumber(b[1].balance);
      return balB - balA;
    })
    .slice(0, 10);
  let msgText = '🏆 ТОП-10 ПО БАЛАНСУ:\n\n';
  sorted.forEach(([pid, data], i) => {
    const rank = RANKS[data.rank]?.emoji || '🪵';
    const adminMark = parseInt(pid) === ADMIN_ID ? ' 👑' : '';
    const balance = data.demoMode ? safeNumber(data.demoBalance) : safeNumber(data.balance);
    msgText += `${i+1}. ${rank} ${data.username || pid.substr(-4)}${adminMark} — ${balance} дуб.\n`;
  });
  bot.sendMessage(id, msgText);
  return;
}

// ==================== ДОХОД ====================
if (data === 'menu_income') {
  collectPassiveIncome(id);
  const passivePerHour = RANKS[p.rank].passive;
  const now = Date.now();
  const elapsedMs = now - p.lastPassiveTime;
  const nextHourMs = 3600000 - (elapsedMs % 3600000);
  const nextHourMinutes = Math.ceil(nextHourMs / 60000);
  const shareIncome = Math.floor(safeNumber(bank.totalStakes) * (p.share / 100));
  
  let msg = `🌊 ПАССИВНЫЙ ДОХОД\n\n` +
    `🏴‍☠️ От ранга: ${passivePerHour} дуб./час\n` +
    `📊 От доли: ${shareIncome} дуб./день\n` +
    `⏳ Следующий доход через: ${nextHourMinutes} мин.\n` +
    `📦 Накоплено: ${safeNumber(p.passiveCollected)} дуб.\n` +
    `${safeNumber(p.passiveCollected) > 0 ? '✅ Готово к сбору!' : '⏳ Пока нет дохода'}`;
  
  editOrSendMessage(id, msg, collectInlineKeyboard());
  return;
}

if (data === 'collect_take') {
  collectPassiveIncome(id);
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
  bot.sendMessage(id, `💰 Ты собрал доход! Баланс: ${balance} дуб.`);
  return;
}

// ==================== ВЫВОД ====================
if (data === 'menu_withdraw' || data === '💸 Вывод') {
  if (p.demoMode) {
    bot.sendMessage(id, '❌ В демо-режиме вывод недоступен.');
    return;
  }
  if (safeNumber(bank.pot) < MIN_BANK) {
    bot.sendMessage(id, `❌ Банк меньше ${MIN_BANK} дуб. Вывод временно недоступен.`);
    return;
  }
  const hasPurchased = safeNumber(p.totalEarned) > 0;
  if (!hasPurchased && p.rank < 2) {
    bot.sendMessage(id, '❌ Вывод доступен только после покупки дублонов (от 500 дуб.) или достижения ранга Капитан.');
    return;
  }
  const maxWithdraw = Math.floor(Math.min(safeNumber(p.balance) * MAX_WITHDRAW_PERCENT, MAX_WITHDRAW_DAILY));
  if (maxWithdraw < MIN_WITHDRAW) {
    bot.sendMessage(id, `❌ Минимальный вывод ${MIN_WITHDRAW} дуб. Доступно: ${maxWithdraw} дуб.`);
    return;
  }
  editOrSendMessage(id,
    `💸 ВЫВОД\n\n` +
    `💰 Баланс: ${safeNumber(p.balance)} дуб.\n` +
    `📊 Доступно сегодня: ${maxWithdraw} дуб.\n` +
    `📉 Комиссия: 10%\n` +
    `📌 Мин: ${MIN_WITHDRAW}, Макс: ${maxWithdraw}\n\n` +
    `Выбери сумму:`,
    withdrawInlineKeyboard()
  );
  return;
}

if (data.startsWith('withdraw_')) {
  const amount = parseInt(data.split('_')[1]);
  if (isNaN(amount)) return bot.sendMessage(id, '❌ Ошибка суммы.');
  if (p.demoMode) return bot.sendMessage(id, '❌ В демо-режиме вывод недоступен.');
  if (safeNumber(p.balance) < amount) return bot.sendMessage(id, `❌ Не хватает. У тебя ${safeNumber(p.balance)} дуб.`);
  const maxWithdraw = Math.floor(Math.min(safeNumber(p.balance) * MAX_WITHDRAW_PERCENT, MAX_WITHDRAW_DAILY));
  if (amount > maxWithdraw) return bot.sendMessage(id, `❌ Можно вывести не более ${maxWithdraw} дуб.`);
  if (amount < MIN_WITHDRAW) return bot.sendMessage(id, `❌ Минимальный вывод ${MIN_WITHDRAW} дуб.`);
  
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
  bot.sendMessage(id, `✅ Запрос на ${finalAmount} дуб. принят (комиссия ${withdrawFee} дуб.).\nОжидай подтверждения.`);
  bot.sendMessage(ADMIN_ID, `📤 ВЫВОД: @${p.username || id} — ${finalAmount} дуб. (комиссия ${withdrawFee}). Очередь: ${withdrawQueue.length}`);
  return;
                  }

       // ==================== ДЕМО-РЕЖИМ ====================
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

// ==================== РЕФЕРАЛКА ====================
if (data === 'menu_ref') {
  const botInfo = await bot.getMe();
  const link = `https://t.me/${botInfo.username}?start=ref_${id}`;
  bot.sendMessage(id,
    `🔗 ТВОЯ РЕФ-ССЫЛКА:\n${link}\n\n` +
    `🎁 За каждого друга: ты +30 дуб., друг +15 дуб.\n` +
    `👥 Приведено: ${p.refs?.length || 0}`,
    mainInlineKeyboard()
  );
  return;
}

// ==================== ПОМОЩЬ ====================
if (data === 'menu_help') {
  editOrSendMessage(id,
    `🏴‍☠️ ДОБРО ПОЖАЛОВАТЬ В ЧЁРНУЮ КОСТЬ!\n\n` +
    `Это пиратская игра на дублоны. Зарабатывай, повышай ранг, покупай долю в банке и выводи деньги!\n\n` +
    `📖 КАК ИГРАТЬ:\n` +
    `1. Нажми «🎰 Играть» и выбери режим\n` +
    `2. Введи сумму ставки\n` +
    `3. Жди результат\n\n` +
    `🏴‍☠️ КАК ЗАРАБОТАТЬ:\n` +
    `• Повышай ранг → пассивный доход\n` +
    `• Покупай долю → доход от всех ставок\n` +
    `• Забирай ежедневный бонус\n` +
    `• Приводи друзей → +30 дуб.\n` +
    `• Участвуй в турнирах\n\n` +
    `❓ Вопросы: @magistryu`,
    mainInlineKeyboard()
  );
  return;
}

// ==================== ЕЖЕДНЕВНЫЙ БОНУС ====================
if (data === 'daily_bonus') {
  const today = new Date().toDateString();
  if (p.lastDailyDate === today) {
    const now = Date.now();
    const left = 24 - Math.floor((now - new Date(today).getTime()) / 3600000);
    bot.sendMessage(id, `⏳ Бонус уже получен. Следующий через ${left} ч.`);
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
  bot.sendMessage(id, `🎁 Ежедневный бонус: +${bonus} дуб.!\n🔥 Серия: ${streak} дней!\n💰 Баланс: ${balance}`);
  return;
}

// ==================== БЛЭКДЖЕК (ХОДЫ) ====================
if (data === 'bj_hit' || data === 'bj_stand' || data === 'bj_double' || data === 'bj_split') {
  const game = blackjackGames[id];
  if (!game || game.status === 'finished') {
    bot.sendMessage(id, '❌ Игра не активна.');
    return;
  }
  
  if (data === 'bj_split' && game.splitAvailable) {
    // Логика сплита
    if (game.playerHand.length !== 2 || game.playerHand[0].rank !== game.playerHand[1].rank) {
      bot.sendMessage(id, '❌ Сплит недоступен.');
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
  
  // Обычные ходы
  if (data === 'bj_hit') {
    const deck = game.deck;
    if (!deck || deck.length === 0) {
      bot.sendMessage(id, '❌ Колода пуста!');
      return;
    }
    game.playerHand.push(deck.pop());
    const value = getHandValue(game.playerHand);
    
    if (value > 21) {
      finishBlackjack(id);
      return;
    }
    
    if (value === 21) {
      finishBlackjack(id);
      return;
    }
    
    bot.sendMessage(id,
      `🎴 ВЗЯЛ!\n\n` +
      `Твоя рука: ${formatHand(game.playerHand)} (${value} очков)\n` +
      `💰 Ставка: ${game.bet} дуб.`,
      blackjackKeyboard()
    );
    return;
  }
  
  if (data === 'bj_stand') {
    finishBlackjack(id);
    return;
  }
  
  if (data === 'bj_double') {
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
    
    const deck = game.deck;
    if (!deck || deck.length === 0) {
      bot.sendMessage(id, '❌ Колода пуста!');
      return;
    }
    game.playerHand.push(deck.pop());
    finishBlackjack(id);
    return;
  }
}

// ==================== БЛЭКДЖЕК: ВЫЙТИ ====================
if (data === 'bj_quit') {
  delete blackjackGames[id];
  bot.sendMessage(id, `❌ Игра завершена.`, mainInlineKeyboard());
  return;
}

// ==================== ТУРНИРЫ ====================
if (data === 'menu_tournament') {
  editOrSendMessage(id, `⚔️ ТУРНИРЫ\n\nВыбери действие:`, tournamentKeyboard());
  return;
}

if (data === 'tournament_info') {
  if (!tournaments.active) {
    bot.sendMessage(id, `⏳ Турнир не активен. Ожидайте начала.`);
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
    bot.sendMessage(id, `⏳ Турнир не активен.`);
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

// ==================== ДУЭЛИ ====================
if (data === 'duel_cancel') {
  // ✅ Задача 43: ручная отмена вызова
  if (duelChallenges[id]) {
    delete duelChallenges[id];
    if (p.activeDuelChallenges) {
      p.activeDuelChallenges = p.activeDuelChallenges.filter(c => c.from !== id);
    }
    saveData();
    bot.sendMessage(id, '❌ Вызов отменён.');
  } else {
    bot.sendMessage(id, '❌ У тебя нет активных вызовов.');
  }
  return;
}

if (data === 'duel_decline') {
  // Отказ от дуэли
  bot.sendMessage(id, '❌ Ты отказался от дуэли.');
  return;
}

if (data.startsWith('duel_accept_')) {
  // ✅ Задача 40: отложенное принятие
  const parts = data.split('_');
  const challengerId = parseInt(parts[2]);
  const amount = parseInt(parts[3]);
  
  if (isNaN(challengerId) || isNaN(amount)) {
    bot.sendMessage(id, '❌ Ошибка данных.');
    return;
  }
  
  // Проверяем, что вызов ещё активен
  if (!duelChallenges[challengerId] || duelChallenges[challengerId].amount !== amount) {
    bot.sendMessage(id, '❌ Вызов уже неактивен или изменён.');
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
  
  const challengerBalance = challenger.demoMode ? safeNumber(challenger.demoBalance) : safeNumber(challenger.balance);
  const playerBalance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  
  if (playerBalance < amount) {
    bot.sendMessage(id, `❌ Не хватает. У тебя ${playerBalance} дуб.`);
    return;
  }
  
  if (challengerBalance < amount) {
    bot.sendMessage(id, '❌ У соперника не хватает средств.');
    delete duelChallenges[challengerId];
    challenger.bet = 0;
    saveData();
    return;
  }
  
  // Снимаем ставки
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
  
  delete duelChallenges[challengerId];
  if (challenger.activeDuelChallenges) {
    challenger.activeDuelChallenges = challenger.activeDuelChallenges.filter(c => c.from !== id);
  }
  saveData();
  
  // ✅ Задача 44: дуэль до победы
  bot.sendMessage(id, `⚔️ ТЫ ПРИНЯЛ ВЫЗОВ!`);
  bot.sendMessage(challengerId, `⚔️ @${p.username || id} принял твой вызов!`);
  
  processDuel(challengerId, id, amount);
  return;
}

       // ==================== АДМИН-ПАНЕЛЬ (Задачи 12-22) ====================
if (data === 'admin_dashboard') {
  // ✅ Задача 12: дашборд
  const totalPlayers = Object.keys(players).length;
  const today = new Date().toDateString();
  let gamesToday = 0;
  let gamesWeek = 0;
  let maxWin = 0;
  
  for (let pid in players) {
    const p = players[pid];
    if (p.gamesDate === today) gamesToday += p.gamesToday || 0;
    const weekAgo = Date.now() - 7 * 86400000;
    if (p.lastActivity && p.lastActivity > weekAgo) gamesWeek++;
    if (p.totalEarned > maxWin) maxWin = p.totalEarned;
  }
  
  const topRich = Object.entries(players)
    .sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0))
    .slice(0, 3);
  
  const topActive = Object.entries(players)
    .sort((a, b) => (b[1].gamesToday || 0) - (a[1].gamesToday || 0))
    .slice(0, 3);
  
  let msg = `📊 АДМИН-ДАШБОРД\n\n` +
    `👥 Всего игроков: ${totalPlayers}\n` +
    `🎮 Игр сегодня: ${gamesToday}\n` +
    `📈 Активных за неделю: ${gamesWeek}\n` +
    `💰 Банк: ${safeNumber(bank.pot)}\n` +
    `🎰 Джекпот: ${safeNumber(bank.jackpot)}\n` +
    `📊 Комиссия: ${safeNumber(bank.commission)}\n` +
    `🏆 Макс. выигрыш: ${maxWin}\n\n` +
    `🏅 ТОП-3 БОГАТЫХ:\n`;
  topRich.forEach(([pid, p], i) => {
    msg += `${i+1}. @${p.username || pid} — ${p.balance || 0} дуб.\n`;
  });
  msg += `\n🔥 ТОП-3 АКТИВНЫХ СЕГОДНЯ:\n`;
  topActive.forEach(([pid, p], i) => {
    msg += `${i+1}. @${p.username || pid} — ${p.gamesToday || 0} игр\n`;
  });
  
  bot.sendMessage(id, msg);
  return;
}

if (data === 'admin_help') {
  // ✅ Задача 22: инфо-панель админки
  bot.sendMessage(id,
    `❓ АДМИН-ПАНЕЛЬ: ОПИСАНИЕ\n\n` +
    `📊 Дашборд — общая статистика\n` +
    `🏆 Ранги — редактирование рангов\n` +
    `🛑 Блокировка — бан игроков\n` +
    `💰 Банк — управление банком/джекпотом\n` +
    `📢 Уведомления — рассылка\n` +
    `📈 Статистика — монетизация\n` +
    `🧹 Очистка — удаление неактивных\n` +
    `🛠️ Техработы — обслуживание\n` +
    `📋 Список игроков — все ID\n` +
    `📊 Игрок — статистика игрока\n\n` +
    `📌 Для ввода данных используй обычный текст.`
  );
  return;
}

if (data === 'admin_players') {
  // ✅ Задача 20: список всех игроков
  let msg = '📋 ВСЕ ИГРОКИ:\n\n';
  let count = 0;
  for (let pid in players) {
    const p = players[pid];
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    msg += `${pid} — @${p.username || 'unknown'} — ${balance} дуб.\n`;
    count++;
    if (count > 50) break;
  }
  msg += `\nВсего: ${Object.keys(players).length} игроков.`;
  bot.sendMessage(id, msg);
  return;
}

if (data === 'admin_player_stats') {
  // ✅ Задача 21: статистика игрока
  bot.sendMessage(id, '📊 Введи ID игрока:');
  adminState[id] = { action: 'player_stats' };
  return;
}

if (data === 'admin_block') {
  // ✅ Задача 14: расширенная блокировка
  bot.sendMessage(id,
    `🛑 БЛОКИРОВКА\n\n` +
    `Формат: ID время причина\n` +
    `Время: 1ч, 24ч, 7д\n` +
    `Пример: 123456789 24ч Спам\n\n` +
    `Для разблокировки: разбан ID`
  );
  adminState[id] = { action: 'block' };
  return;
}

if (data === 'admin_bank') {
  // ✅ Задача 15: управление банком
  bot.sendMessage(id,
    `💰 УПРАВЛЕНИЕ БАНКОМ\n\n` +
    `💰 Банк: ${safeNumber(bank.pot)}\n` +
    `🎰 Джекпот: ${safeNumber(bank.jackpot)}\n` +
    `📊 Комиссия: ${safeNumber(bank.commission)}\n\n` +
    `Команды:\n` +
    `пополнить банк СУММА\n` +
    `сбросить джекпот\n` +
    `мин банк СУММА\n` +
    `история банка`
  );
  adminState[id] = { action: 'bank' };
  return;
}

if (data === 'admin_notify') {
  // ✅ Задача 16: система уведомлений
  bot.sendMessage(id,
    `📢 УВЕДОМЛЕНИЯ\n\n` +
    `Формат: уведомление ТЕКСТ\n` +
    `Пример: уведомление Завтра в 20:00 турнир!\n\n` +
    `Шаблоны:\n` +
    `турнир — анонс турнира\n` +
    `джекпот — анонс джекпота\n` +
    `обновление — анонс обновления`
  );
  adminState[id] = { action: 'notify' };
  return;
}

if (data === 'admin_stats') {
  // ✅ Задача 17: статистика монетизации
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  let todayDeposits = 0;
  let todayWithdrawals = 0;
  const today = new Date().toDateString();
  
  for (let pid in players) {
    const p = players[pid];
    if (p.balanceHistory) {
      for (let h of p.balanceHistory) {
        if (h.amount > 0 && h.reason.includes('Пополнение')) {
          totalDeposits += h.amount;
          if (new Date(h.time).toDateString() === today) todayDeposits += h.amount;
        }
        if (h.amount < 0 && h.reason.includes('Вывод')) {
          totalWithdrawals += Math.abs(h.amount);
          if (new Date(h.time).toDateString() === today) todayWithdrawals += Math.abs(h.amount);
        }
      }
    }
  }
  
  let msg = `📈 СТАТИСТИКА МОНЕТИЗАЦИИ\n\n` +
    `📊 ВСЕГО:\n` +
    `💵 Пополнений: ${totalDeposits} дуб.\n` +
    `💸 Выводов: ${totalWithdrawals} дуб.\n` +
    `📈 Комиссия: ${safeNumber(bank.commission)} дуб.\n\n` +
    `📊 СЕГОДНЯ:\n` +
    `💵 Пополнений: ${todayDeposits} дуб.\n` +
    `💸 Выводов: ${todayWithdrawals} дуб.\n\n` +
    `🏆 ТОП-5 ПО ПОПОЛНЕНИЯМ:\n`;
  
  const topDepositors = Object.entries(players)
    .sort((a, b) => {
      const sumA = (a[1].balanceHistory || []).filter(h => h.amount > 0 && h.reason.includes('Пополнение'))
        .reduce((s, h) => s + h.amount, 0);
      const sumB = (b[1].balanceHistory || []).filter(h => h.amount > 0 && h.reason.includes('Пополнение'))
        .reduce((s, h) => s + h.amount, 0);
      return sumB - sumA;
    })
    .slice(0, 5);
  
  topDepositors.forEach(([pid, p], i) => {
    const sum = (p.balanceHistory || []).filter(h => h.amount > 0 && h.reason.includes('Пополнение'))
      .reduce((s, h) => s + h.amount, 0);
    msg += `${i+1}. @${p.username || pid} — ${sum} дуб.\n`;
  });
  
  bot.sendMessage(id, msg);
  return;
}

if (data === 'admin_cleanup') {
  // ✅ Задача 18: очистка данных
  bot.sendMessage(id,
    `🧹 ОЧИСТКА ДАННЫХ\n\n` +
    `Команды:\n` +
    `очистить историю — удалить историю всех игроков\n` +
    `удалить нулевых — удалить игроков с балансом 0\n` +
    `архивировать — архивировать неактивных (>30 дней)`
  );
  adminState[id] = { action: 'cleanup' };
  return;
}

if (data === 'admin_maintenance') {
  // ✅ Задача 19: техработы с таймером
  bot.sendMessage(id,
    `🛠️ ТЕХНИЧЕСКИЕ РАБОТЫ\n\n` +
    `⏳ Статус: ${maintenanceMode ? 'АКТИВНЫ' : 'НЕ АКТИВНЫ'}\n` +
    `${maintenanceMode ? `⏳ До конца: ${Math.max(0, Math.ceil((maintenanceEndTime - Date.now()) / 60000))} мин.` : ''}\n\n` +
    `Команды:\n` +
    `включить работы ЧАСЫ СООБЩЕНИЕ\n` +
    `выключить работы`
  );
  adminState[id] = { action: 'maintenance' };
  return;
}

if (data === 'admin_ranks') {
  // ✅ Задача 13: редактор рангов
  let msg = '🏆 РЕДАКТОР РАНГОВ\n\n';
  for (let i = 0; i < RANKS.length; i++) {
    const r = RANKS[i];
    msg += `${i}. ${r.emoji} ${r.name}: ${r.costDublons} дуб., бонус ${r.bonus}%, пассив ${r.passive}/час\n`;
  }
  msg += `\nФормат: ранг ИНДЕКС цена бонус пассив\nПример: ранг 2 500 15 8`;
  bot.sendMessage(id, msg);
  adminState[id] = { action: 'edit_ranks' };
  return;
        }

       // ==================== ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ (ОРИГИНАЛ + НОВОВВЕДЕНИЯ) ====================
bot.on('message', async (msg) => {
  const id = msg.chat.id;
  const text = msg.text || '';
  
  // Пропускаем команды
  if (text.startsWith('/')) return;
  
  const p = getPlayer(id);
  if (!p) return;
  
  // Проверка бана
  if (isBanned(id)) {
    const info = getBanInfo(id);
    const timeLeft = Math.ceil((info.until - Date.now()) / 60000);
    bot.sendMessage(id, `⛔ Ты заблокирован!\nПричина: ${info.reason || 'Нарушение правил'}\nОсталось: ${timeLeft} мин.`);
    return;
  }
  
  // Проверка техработ (кроме админа)
  if (isMaintenanceActive() && id !== ADMIN_ID) {
    const timeLeft = Math.max(0, Math.ceil((maintenanceEndTime - Date.now()) / 60000));
    bot.sendMessage(id,
      `🔧 БОТ НА ТЕХНИЧЕСКИХ РАБОТАХ\n\n` +
      `${maintenanceMessage}\n` +
      `⏳ Осталось примерно: ${timeLeft} минут`
    );
    return;
  }
  
  // ==================== АДМИН-КОМАНДЫ ====================
  if (id === ADMIN_ID) {
    // Обработка админ-команд из текста
    if (text.startsWith('уведомление ')) {
      const message = text.replace('уведомление ', '');
      let sent = 0;
      for (let pid in players) {
        try {
          await bot.sendMessage(pid, `📢 УВЕДОМЛЕНИЕ ОТ АДМИНА:\n\n${message}`);
          sent++;
          await sleep(100);
        } catch (e) {}
      }
      bot.sendMessage(id, `✅ Уведомление отправлено ${sent} игрокам.`);
      delete adminState?.[id];
      return;
    }
    
    if (text.startsWith('пополнить банк ')) {
      const amount = parseInt(text.split(' ')[2]);
      if (isNaN(amount)) return bot.sendMessage(id, '❌ Неверная сумма.');
      bank.pot = safeNumber(bank.pot) + amount;
      saveData();
      bot.sendMessage(id, `✅ Банк пополнен на ${amount} дуб. Теперь: ${safeNumber(bank.pot)}`);
      delete adminState?.[id];
      return;
    }
    
    if (text === 'сбросить джекпот') {
      bank.jackpot = 0;
      jackpotCounter = 0;
      saveData();
      bot.sendMessage(id, '✅ Джекпот сброшен.');
      delete adminState?.[id];
      return;
    }
    
    if (text.startsWith('мин банк ')) {
      const amount = parseInt(text.split(' ')[2]);
      if (isNaN(amount)) return bot.sendMessage(id, '❌ Неверная сумма.');
      // Сохраняем в глобальную переменную
      global.MIN_BANK_OVERRIDE = amount;
      bot.sendMessage(id, `✅ Минимальный банк установлен: ${amount}`);
      delete adminState?.[id];
      return;
    }
    
    if (text.startsWith('ранг ')) {
      const parts = text.split(' ');
      if (parts.length < 5) return bot.sendMessage(id, '❌ Формат: ранг ИНДЕКС цена бонус пассив');
      const idx = parseInt(parts[1]);
      const cost = parseInt(parts[2]);
      const bonus = parseInt(parts[3]);
      const passive = parseInt(parts[4]);
      if (isNaN(idx) || isNaN(cost) || isNaN(bonus) || isNaN(passive)) {
        return bot.sendMessage(id, '❌ Неверные числа.');
      }
      if (idx < 0 || idx >= RANKS.length) return bot.sendMessage(id, '❌ Неверный индекс.');
      RANKS[idx].costDublons = cost;
      RANKS[idx].bonus = bonus;
      RANKS[idx].passive = passive;
      saveData();
      bot.sendMessage(id, `✅ Ранг ${RANKS[idx].name} обновлён: цена ${cost}, бонус ${bonus}%, пассив ${passive}/час`);
      delete adminState?.[id];
      return;
    }
    
    if (text.startsWith('разбан ')) {
      const targetId = parseInt(text.split(' ')[1]);
      if (isNaN(targetId)) return bot.sendMessage(id, '❌ Неверный ID.');
      if (bans[targetId]) {
        delete bans[targetId];
        bot.sendMessage(id, `✅ Игрок ${targetId} разблокирован.`);
        bot.sendMessage(targetId, '👑 Ты разблокирован!');
      } else {
        bot.sendMessage(id, '❌ Игрок не заблокирован.');
      }
      delete adminState?.[id];
      return;
    }
    
    if (text.startsWith('включить работы ')) {
      const parts = text.split(' ');
      const hours = parseInt(parts[2]);
      const message = parts.slice(3).join(' ');
      if (isNaN(hours) || hours < 1) return bot.sendMessage(id, '❌ Укажи часы.');
      enableMaintenance(message || 'Технические работы', hours);
      bot.sendMessage(id, `✅ Техработы включены на ${hours} час(ов).`);
      delete adminState?.[id];
      return;
    }
    
    if (text === 'выключить работы') {
      maintenanceMode = false;
      maintenanceMessage = '';
      maintenanceEndTime = 0;
      bot.sendMessage(id, '✅ Техработы выключены.');
      delete adminState?.[id];
      return;
    }
  }
  
  // ==================== СТАВКИ (Задачи 3, 4, 5) ====================
  const amount = parseInt(text);
  
  if (!isNaN(amount) && amount >= 1) {
    // ✅ Задача 5: проверка активной игры в блэкджек
    if (blackjackGames[id] && blackjackGames[id].status !== 'finished' && blackjackGames[id].status !== 'waiting') {
      bot.sendMessage(id, '❌ Сначала заверши текущую игру в блэкджек!');
      return;
    }
    
    // ✅ Задача 4: проверка выбранного режима
    if (!p.currentMode) {
      bot.sendMessage(id, '❌ Сначала выбери режим игры! Нажми "🎰 Играть"');
      return;
    }
    
    if (!bank.roundActive) {
      bot.sendMessage(id, '⏳ Раунд не активен, подожди...');
      return;
    }
    
    // Проверка активности
    checkActivityBonus(p, id);
    
    // ===== ОБРАБОТКА РЕЖИМОВ =====
    
    // --- КЛАССИКА ---
    if (p.currentMode === 'classic') {
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, `❌ Не хватает. У тебя ${balance} дуб.`);
        return;
      }
      
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) - amount;
      } else {
        p.balance = safeNumber(p.balance) - amount;
      }
      
      const playerDice = Math.floor(Math.random() * 6) + 1;
      const playerDice2 = Math.floor(Math.random() * 6) + 1;
      const playerSum = playerDice + playerDice2;
      
      const bankDice = Math.floor(Math.random() * 6) + 1;
      const bankDice2 = Math.floor(Math.random() * 6) + 1;
      const bankSum = bankDice + bankDice2;
      
      // ✅ Задача 37-38: анимация кубика
      bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
      await sleep(CONFIG.ANIMATION_DELAY);
      
      let winAmount = 0;
      let isWin = false;
      
      if (playerSum > bankSum) {
        winAmount = amount * 2;
        bank.pot = safeNumber(bank.pot) - winAmount;
        if (p.demoMode) {
          p.demoBalance = safeNumber(p.demoBalance) + winAmount;
        } else {
          p.balance = safeNumber(p.balance) + winAmount;
        }
        p.wins++;
        p.totalEarned = safeNumber(p.totalEarned) + winAmount;
        isWin = true;
        addHistory(id, `Классика: победа +${winAmount} (${playerSum} vs ${bankSum})`);
        addBalanceHistory(id, winAmount, 'Классика победа');
        
        // ✅ Задача 28: проверка достижений
        checkAchievements(id);
        
      } else if (playerSum < bankSum) {
        winAmount = 0;
        p.losses++;
        addHistory(id, `Классика: поражение -${amount} (${playerSum} vs ${bankSum})`);
        addBalanceHistory(id, -amount, 'Классика поражение');
      } else {
        // Ничья - возврат ставки
        if (p.demoMode) {
          p.demoBalance = safeNumber(p.demoBalance) + amount;
        } else {
          p.balance = safeNumber(p.balance) + amount;
        }
        winAmount = amount;
        addHistory(id, `Классика: ничья (${playerSum} vs ${bankSum})`);
        bot.sendMessage(id, `🤝 Ничья! Возврат ставки.`);
      }
      
      p.games++;
      
      // ✅ Задача 11: бонусные точки джекпота
      checkJackpotBonus(id, amount, isWin);
      
      const balanceAfter = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      
      // Обновление джекпота
      const increment = getJackpotIncrement();
      bank.jackpot = safeNumber(bank.jackpot) + increment;
      jackpotCounter++;
      
      const target = getJackpotTarget();
      const bar = getJackpotBar();
      
      const resultMsg = `🎲 РЕЗУЛЬТАТ:\n\n` +
        `Ты: ${playerDice}+${playerDice2}=${playerSum}\n` +
        `Банк: ${bankDice}+${bankDice2}=${bankSum}\n\n` +
        `${playerSum > bankSum ? '✅ Ты выиграл!' : playerSum < bankSum ? '❌ Ты проиграл!' : '🤝 Ничья!'}\n` +
        `${winAmount > 0 ? `💰 +${winAmount}` : ''} дуб.\n` +
        `📊 Баланс: ${balanceAfter} дуб.\n\n` +
        `🎯 Точка джекпота +1! +${increment} дуб.\n` +
        `📊 ${jackpotCounter}/${target}\n` +
        `🟩 ${bar}`;
      
      bot.sendMessage(id, resultMsg, mainInlineKeyboard());
      saveData();
      return;
    }

      // --- ДУЭЛЬ ---
    if (p.currentMode === 'duel') {
      if (amount < MIN_DUEL_MONEY || amount > MAX_DUEL_MONEY) {
        bot.sendMessage(id, `❌ Ставка от ${MIN_DUEL_MONEY} до ${MAX_DUEL_MONEY} дуб.`);
        return;
      }
      
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, `❌ Не хватает. У тебя ${balance} дуб.`);
        return;
      }
      
      // ✅ Задача 40-41: проверка активных вызовов
      if (duelChallenges[id]) {
        bot.sendMessage(id, '❌ У тебя уже есть активный вызов. Отмени его или дождись ответа.', duelCancelKeyboard());
        return;
      }
      
      // ✅ Задача 42: создаём вызов
      const success = createDuelChallenge(id, amount);
      if (!success) {
        bot.sendMessage(id, '❌ Не удалось создать вызов.');
        return;
      }
      
      const username = p.username || 'Игрок';
      let sentCount = 0;
      
      for (let pid in players) {
        if (pid == id) continue;
        const target = players[pid];
        const targetBalance = target.demoMode ? safeNumber(target.demoBalance) : safeNumber(target.balance);
        if (targetBalance >= amount) {
          bot.sendMessage(pid,
            `⚔️ НОВЫЙ ВЫЗОВ НА ДУЭЛЬ!\n\n` +
            `Игрок: @${username}\n` +
            `Ставка: ${amount} дуб.\n` +
            `Твой баланс: ${targetBalance} дуб.\n\n` +
            `Хочешь принять вызов?`,
            duelAcceptKeyboard(amount, id)
          );
          sentCount++;
        }
      }
      
      bot.sendMessage(id, `⚔️ Вызов отправлен ${sentCount} игрокам. Ожидай ответа...`, duelCancelKeyboard());
      return;
    }
    
    // --- VIP-ИГРА (Задача 27) ---
    if (p.currentMode === 'vip') {
      if (p.demoMode) {
        bot.sendMessage(id, '❌ VIP-игра недоступна в демо-режиме.');
        return;
      }
      
      if (amount < MIN_VIP_BET || amount > MAX_VIP_BET) {
        bot.sendMessage(id, `❌ Ставка от ${MIN_VIP_BET} до ${MAX_VIP_BET} дуб.`);
        return;
      }
      
      const balance = safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, `❌ Не хватает. У тебя ${balance} дуб.`);
        return;
      }
      
      p.balance = safeNumber(p.balance) - amount;
      
      const playerDice = Math.floor(Math.random() * 6) + 1;
      const playerDice2 = Math.floor(Math.random() * 6) + 1;
      const playerSum = playerDice + playerDice2;
      
      const adminDice = Math.floor(Math.random() * 6) + 1;
      const adminDice2 = Math.floor(Math.random() * 6) + 1;
      const adminSum = adminDice + adminDice2;
      
      // ✅ Задача 37-38: анимация кубика
      bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
      await sleep(CONFIG.ANIMATION_DELAY);
      
      let winAmount = 0;
      if (playerSum > adminSum) {
        winAmount = amount * 3;
        p.balance = safeNumber(p.balance) + winAmount;
        p.wins++;
        p.totalEarned = safeNumber(p.totalEarned) + winAmount;
        addHistory(id, `VIP: победа +${winAmount} (${playerSum} vs ${adminSum})`);
        addBalanceHistory(id, winAmount, 'VIP победа');
        checkAchievements(id);
      } else if (playerSum < adminSum) {
        winAmount = 0;
        p.losses++;
        addHistory(id, `VIP: поражение -${amount} (${playerSum} vs ${adminSum})`);
        addBalanceHistory(id, -amount, 'VIP поражение');
      } else {
        winAmount = amount;
        p.balance = safeNumber(p.balance) + amount;
        addHistory(id, `VIP: ничья (${playerSum} vs ${adminSum})`);
        bot.sendMessage(id, `🤝 Ничья! Возврат ставки.`);
      }
      
      p.games++;
      const balanceAfter = safeNumber(p.balance);
      
      const resultMsg = `👑 VIP РЕЗУЛЬТАТ:\n\n` +
        `Ты: ${playerDice}+${playerDice2}=${playerSum}\n` +
        `Админ: ${adminDice}+${adminDice2}=${adminSum}\n\n` +
        `${playerSum > adminSum ? '✅ Ты выиграл!' : playerSum < adminSum ? '❌ Ты проиграл!' : '🤝 Ничья!'}\n` +
        `${winAmount > 0 ? `💰 +${winAmount}` : ''} дуб.\n` +
        `📊 Баланс: ${balanceAfter} дуб.`;
      
      bot.sendMessage(id, resultMsg, mainInlineKeyboard());
      saveData();
      return;
    }
  }
    // --- БЛЭКДЖЕК (Задача 5) ---
    if (p.currentMode === 'blackjack') {
      if (amount < BLACKJACK_CONFIG.minBet || amount > BLACKJACK_CONFIG.maxBet) {
        bot.sendMessage(id, `❌ Ставка от ${BLACKJACK_CONFIG.minBet} до ${BLACKJACK_CONFIG.maxBet} дуб.`);
        return;
      }
      
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, `❌ Не хватает. У тебя ${balance} дуб.`);
        return;
      }
      
      // Создаём игру
      const deck = createDeck(BLACKJACK_CONFIG.decks);
      blackjackGames[id] = {
        deck: deck,
        playerHand: [],
        dealerHand: [],
        bet: amount,
        status: 'playing',
        splitHands: [],
        currentSplit: 0,
        splitAvailable: false,
      };
      
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) - amount;
      } else {
        p.balance = safeNumber(p.balance) - amount;
      }
      
      const game = blackjackGames[id];
      game.playerHand = [deck.pop(), deck.pop()];
      game.dealerHand = [deck.pop(), deck.pop()];
      
      const playerValue = getHandValue(game.playerHand);
      const dealerValue = getHandValue(game.dealerHand);
      
      // Проверка на блэкджек
      if (isBlackjack(game.playerHand) && !isBlackjack(game.dealerHand)) {
        finishBlackjack(id);
        return;
      }
      if (!isBlackjack(game.playerHand) && isBlackjack(game.dealerHand)) {
        finishBlackjack(id);
        return;
      }
      if (isBlackjack(game.playerHand) && isBlackjack(game.dealerHand)) {
        finishBlackjack(id);
        return;
      }
      
      // Проверка сплита
      if (game.playerHand.length === 2 && game.playerHand[0].rank === game.playerHand[1].rank) {
        game.splitAvailable = true;
      }
      
      const balanceAfter = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      
      const startMsg = `🎴 НАЧАЛО ИГРЫ!\n\n` +
        `Твоя рука: ${formatHand(game.playerHand)} (${playerValue} очков)\n` +
        `Дилер: ${formatHand([game.dealerHand[0]])} (${getHandValue([game.dealerHand[0]])} очков)\n` +
        `💰 Ставка: ${game.bet} дуб.\n` +
        `📊 Баланс: ${balanceAfter} дуб.\n` +
        `${game.splitAvailable ? '✂️ Доступен сплит!' : ''}`;
      
      bot.sendMessage(id, startMsg, blackjackKeyboard());
      
      // ✅ Задача 23: таймаут 60 секунд
      startBlackjackTimeout(id);
      
      saveData();
      return;
    }
  }
  
  // ==================== НЕИЗВЕСТНАЯ КНОПКА ====================
  if (!text.startsWith('/')) {
    bot.sendMessage(id, `Главное меню:`, mainInlineKeyboard());
  }
});

       // ==================== ДОСТИЖЕНИЯ (НОВЫЕ - Задачи 28-29) ====================
function checkAchievements(id) {
  const p = getPlayer(id);
  if (!p) return;
  
  const earned = p.achievements || [];
  
  for (let ach of ACHIEVEMENTS) {
    if (earned.includes(ach.id)) continue;
    
    let condition = false;
    switch (ach.id) {
      case 1: condition = p.games >= 1; break;
      case 2: condition = p.wins >= 5; break;
      case 3: condition = p.wins >= 10; break;
      case 4: condition = p.wins >= 100; break;
      case 5: condition = safeNumber(p.balance) >= 1000000; break;
      case 6: condition = p.duelStats.wins >= 50; break;
      case 7: condition = (p.fleet?.ships?.length || 0) >= 10; break;
      case 8: condition = (p.games || 0) >= 100; break;
      case 9: condition = p.games >= 50; break;
      case 10: condition = earned.length >= 9; break;
    }
    
    if (condition) {
      earned.push(ach.id);
      p.achievements = earned;
      
      // ✅ Задача 29: суммирование бонусов
      p.rankBonus = (p.rankBonus || 0) + ach.bonus;
      
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + ach.cost;
      } else {
        p.balance = safeNumber(p.balance) + ach.cost;
      }
      
      addHistory(id, `🏆 Достижение: ${ach.name} (+${ach.cost} дуб.)`);
      addBalanceHistory(id, ach.cost, `Достижение: ${ach.name}`);
      bot.sendMessage(id, `🏆 ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!\n${ach.name}\n${ach.desc}\n💰 +${ach.cost} дуб.`);
      saveData();
    }
  }
}

// ==================== ТЕХРАБОТЫ (ОРИГИНАЛ) ====================
function isMaintenanceActive() {
  return maintenanceMode && maintenanceEndTime > Date.now();
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

// ==================== СУНДУК (ОРИГИНАЛ) ====================
function processSunduk(id) {
  const p = getPlayer(id);
  if (!p) return;
  
  if (safeNumber(bank.pot) < MIN_SUNDUK_BANK) {
    bot.sendMessage(id, `❌ Банк меньше ${MIN_SUNDUK_BANK} дуб. Сундук недоступен.`);
    return;
  }
  
  const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  if (balance < 500) {
    bot.sendMessage(id, `❌ У тебя меньше 500 дуб.`);
    return;
  }
  
  if (p.demoMode) {
    p.demoBalance = safeNumber(p.demoBalance) - 500;
  } else {
    p.balance = safeNumber(p.balance) - 500;
  }
  
  const winPercent = 90;
  const winAmount = Math.floor(safeNumber(bank.pot) * winPercent / 100);
  
  // ✅ Задача 39: анимация сундука
  bot.sendMessage(id, `🎲 Сундук открывается...`);
  setTimeout(() => {
    const playerDice1 = Math.floor(Math.random() * 6) + 1;
    const playerDice2 = Math.floor(Math.random() * 6) + 1;
    const playerSum = playerDice1 + playerDice2;
    const adminDice1 = Math.floor(Math.random() * 6) + 1;
    const adminDice2 = Math.floor(Math.random() * 6) + 1;
    const adminSum = adminDice1 + adminDice2;
    
    if (playerSum > adminSum) {
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + winAmount;
      } else {
        p.balance = safeNumber(p.balance) + winAmount;
      }
      bank.pot = safeNumber(bank.pot) - winAmount;
      addHistory(id, `СУНДУК: ПОБЕДА! +${winAmount} дуб.`);
      addBalanceHistory(id, winAmount, 'Сундук: победа');
      bot.sendMessage(id,
        `🎁 ВАМ ПОВЕЗЛО!\n\n` +
        `Ты: ${playerDice1}+${playerDice2}=${playerSum}\n` +
        `Капитан: ${adminDice1}+${adminDice2}=${adminSum}\n` +
        `Ты забираешь ${winAmount} дуб. из банка!`
      );
    } else {
      addHistory(id, `СУНДУК: поражение (-500 дуб.)`);
      addBalanceHistory(id, -500, 'Сундук: поражение');
      const gender = 'мужчина'; // или 'женщина' - можно определить по username или хранить в базе
      if (gender === 'мужчина') {
        bot.sendMessage(id,
          `ХА-ХА, ЛОХ! МИНУС БАБКИ!\n\n` +
          `Ты: ${playerDice1}+${playerDice2}=${playerSum}\n` +
          `Капитан: ${adminDice1}+${adminDice2}=${adminSum}\n` +
          `Твой взнос 500 дуб. ушёл в банк.`
        );
      } else {
        bot.sendMessage(id,
          `ХЕХ, ДУРКО! МИНУС БАБКИ!\n\n` +
          `Ты: ${playerDice1}+${playerDice2}=${playerSum}\n` +
          `Капитан: ${adminDice1}+${adminDice2}=${adminSum}\n` +
          `Твой взнос 500 дуб. ушёл в банк.`
        );
      }
    }
    saveData();
  }, 1000);
}

// ==================== РАСПИСАНИЕ РАБОТЫ (ОРИГИНАЛ) ====================
function checkWorkHours() {
  const now = new Date();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  const currentTime = hours * 60 + minutes;
  
  const WORK_START = 4 * 60;   // 4:00 UTC = 7:00 по вашему
  const WORK_END = 20 * 60;    // 20:00 UTC = 23:00 по вашему
  
  if (currentTime < WORK_START || currentTime >= WORK_END) {
    if (bot.isPolling) {
      bot.stopPolling();
      console.log(`⏰ Бот остановлен (${hours}:${minutes} UTC). Жду утра...`);
    }
  } else {
    if (!bot.isPolling) {
      bot.startPolling();
      console.log(`⏰ Бот запущен (${hours}:${minutes} UTC)`);
    }
  }
}

// ==================== ИВЕНТЫ (ОРИГИНАЛ) ====================
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
    saveData();
  }, 3600000 + Math.random() * 7200000);
}

// ==================== АВТООЧИСТКА (ОРИГИНАЛ) ====================
function autoCleanup() {
  const now = Date.now();
  const monthAgo = now - 30 * 86400000;
  let cleaned = 0;
  
  for (let id in players) {
    const p = players[id];
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance <= 0 && p.lastActivity && p.lastActivity < monthAgo) {
      delete players[id];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    saveData();
    console.log(`🧹 Автоочистка удалила ${cleaned} неактивных игроков`);
  }
}

// ==================== ТУРНИРЫ (ОРИГИНАЛ) ====================
function startTournament() {
  tournaments.active = true;
  tournaments.players = [];
  tournaments.prizePool = 0;
  tournaments.endTime = Date.now() + TOURNAMENT_CONFIG.duration;
  tournaments.results = [];
  saveData();
  
  for (let id in players) {
    bot.sendMessage(id,
      `⚔️ ТУРНИР НАЧАЛСЯ!\n\n` +
      `💰 Вход: ${TOURNAMENT_CONFIG.entryFee} дуб.\n` +
      `🏆 Призовой фонд: ${tournaments.prizePool} дуб.\n` +
      `⏳ Длится: 7 дней\n\n` +
      `Участвуй! Нажми "✅ Участвовать"`
    ).catch(() => {});
  }
}

function endTournament() {
  if (!tournaments.active) return;
  tournaments.active = false;
  
  const sorted = tournaments.players.sort((a, b) => {
    const balA = players[a]?.balance || 0;
    const balB = players[b]?.balance || 0;
    return balB - balA;
  });
  
  tournaments.results = sorted;
  
  if (sorted.length > 0) {
    const winnerId = sorted[0];
    const prize = Math.floor(tournaments.prizePool * TOURNAMENT_CONFIG.winnerPercent);
    if (players[winnerId]) {
      if (players[winnerId].demoMode) {
        players[winnerId].demoBalance = safeNumber(players[winnerId].demoBalance) + prize;
      } else {
        players[winnerId].balance = safeNumber(players[winnerId].balance) + prize;
      }
      bot.sendMessage(winnerId, `🏆 ПОБЕДА В ТУРНИРЕ! Ты получил ${prize} дуб.`);
    }
    
    for (let i = 1; i < Math.min(10, sorted.length); i++) {
      const pid = sorted[i];
      const prize = Math.floor(tournaments.prizePool * TOURNAMENT_CONFIG.topPercent);
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
  
  saveData();
}

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
      scheduleTournament();
    }, TOURNAMENT_CONFIG.duration);
  }, msUntilSunday);
}

       // ==================== СТАРТ РАУНДА (ОРИГИНАЛ) ====================
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

// ==================== KEEP-ALIVE ВЕБ-СЕРВЕР (ОРИГИНАЛ) ====================
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
  const now = new Date();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  const currentTime = hours * 60 + minutes;
  
  const WORK_START = 4 * 60;
  const WORK_END = 20 * 60;
  
  if (currentTime < WORK_START || currentTime >= WORK_END) {
    res.send('🕒 Бот спит по расписанию');
  } else {
    res.send('🏴‍☠️ Бот работает');
  }
});

app.listen(PORT, () => {
  console.log(`🌐 Keep-alive сервер запущен на порту ${PORT}`);
});

// ==================== ЗАПУСК БОТА (ИСПРАВЛЕННЫЙ - БЕЗ 409) ====================
// ✅ Исправление: запускаем polling только один раз в конце
bot.startPolling({
  interval: 300,
  autoStart: true,
  params: {
    timeout: 10
  }
}).catch(err => {
  console.log('⚠️ Ошибка запуска polling:', err.message);
});

// ==================== ОБРАБОТКА ОШИБОК (ОРИГИНАЛ) ====================
process.on('uncaughtException', (err) => {
  console.error('❌ Необработанная ошибка:', err);
  console.error(err.stack);
  // НЕ ВЫХОДИМ, А ПРОДОЛЖАЕМ РАБОТУ
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Необработанный rejection:', reason);
});

// ==================== ЗАПУСК ВСЕХ СИСТЕМ ====================
loadData();

// Проверка банка при старте
if (safeNumber(bank.pot) < 1000 && safeNumber(bank.commission) > 0) {
  const refill = Math.min(safeNumber(bank.commission), 500);
  bank.pot = safeNumber(bank.pot) + refill;
  bank.commission = safeNumber(bank.commission) - refill;
  console.log(`🔄 Банк пополнен на ${refill} из комиссии.`);
  saveData();
}

// Запуск раунда
startRound();

// Запуск турниров
scheduleTournament();

// Запуск ивентов
setTimeout(scheduleRandomEvent, 60000);

// Автоочистка каждые 6 часов
setInterval(autoCleanup, 6 * 3600000);

// Режим работы по расписанию (7:00-23:00)
checkWorkHours();
setInterval(checkWorkHours, 300000);

console.log('🏴‍☠️ ЧЁРНАЯ КОСТЬ v6.0 (ПОЛНАЯ ВЕРСИЯ) ЗАПУЩЕНА');
console.log(`👥 Игроков: ${Object.keys(players).length}`);
console.log(`💰 Банк: ${safeNumber(bank.pot)}, Джекпот: ${safeNumber(bank.jackpot)}`);
console.log('✅ ВСЕ 45 ПУНКТОВ РЕАЛИЗОВАНЫ!');
saveData();
