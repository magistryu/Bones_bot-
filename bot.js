require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

const token = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// ==================== ИНИЦИАЛИЗАЦИЯ БОТА ====================
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

const DATA_DIR = process.env.DATA_DIR || '/app/data/';
const PLAYERS_FILE = DATA_DIR + 'players.json';
const BANK_FILE = DATA_DIR + 'bank.json';
const QUEUE_FILE = DATA_DIR + 'withdraw_queue.json';
const JACKPOT_FILE = DATA_DIR + 'jackpot_counter.json';
const HASH_FILE = DATA_DIR + 'players.hash';
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

// ==================== ФОРМАТТЕР СООБЩЕНИЙ ====================
function formatMessage(title, body, footer = '') {
  const line = '━'.repeat(30);
  return `🏴‍☠️ ${title} ${line}\n\n${body}\n\n${footer ? footer + '\n' : ''}${line} 🏴‍☠️`;
}

function gameResultMessage(title, player, bank, win, balance) {
  const line = '▬'.repeat(28);
  return `🎲 ${title} ${line}\n\n` +
    `🎯 Ты: ${player}\n` +
    `🏦 Банк: ${bank}\n\n` +
    `💰 Результат: ${win > 0 ? '✅ +' + win : win < 0 ? '❌ ' + win : '🤝 0'}\n` +
    `📊 Баланс: ${balance} дуб.\n` +
    `${line} 🏴‍☠️`;
}

// ==================== БЛЭКДЖЕК (ФУНКЦИИ) ====================
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

// ==================== ДОСТИЖЕНИЯ (ПРОЦЕНТЫ ПАССИВНОГО ДОХОДА) ====================
const ACHIEVEMENTS = [
  { id: 1, name: '🎯 Первый шаг', desc: 'Сыграть первую игру', bonusPassive: 0.5 },
  { id: 2, name: '💪 Серия 5', desc: 'Выиграть 5 игр подряд', bonusPassive: 1.5 },
  { id: 3, name: '🔥 Серия 10', desc: 'Выиграть 10 игр подряд', bonusPassive: 3 },
  { id: 4, name: '👑 Победитель', desc: 'Выиграть 100 игр', bonusPassive: 5 },
  { id: 5, name: '💰 Миллионер', desc: 'Накопить 1 000 000 дуб.', bonusPassive: 10 },
  { id: 6, name: '⚔️ Дуэлянт', desc: 'Выиграть 50 дуэлей', bonusPassive: 4 },
  { id: 7, name: '🏴‍☠️ Пират', desc: 'Купить 10 кораблей', bonusPassive: 6 },
  { id: 8, name: '🌊 Легенда', desc: 'Открыть 100 сундуков', bonusPassive: 8 },
  { id: 9, name: '🎴 Картёжник', desc: 'Выиграть 50 игр в блэкджек', bonusPassive: 7 },
  { id: 10, name: '👑 Император', desc: 'Получить все достижения', bonusPassive: 20 },
];

// ==================== НОВЫЕ РАНГИ (СБАЛАНСИРОВАННЫЕ) ====================
const RANKS = [
  { name: 'Бомж', emoji: '🪵', costDublons: 0, bonus: 0, passive: 10 },
  { name: 'Матрос', emoji: '⛵', costDublons: 80, bonus: 5, passive: 20 },
  { name: 'Боцман', emoji: '⚓', costDublons: 250, bonus: 10, passive: 35 },
  { name: 'Капитан', emoji: '🏴‍☠️', costDublons: 600, bonus: 18, passive: 55 },
  { name: 'Адмирал', emoji: '👑', costDublons: 1500, bonus: 28, passive: 80 },
  { name: 'Губернатор', emoji: '🏛️', costDublons: 4000, bonus: 40, passive: 120 },
  { name: 'Император', emoji: '👑', costDublons: 10000, bonus: 55, passive: 180 },
];

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

const TOURNAMENT_CONFIG = {
  entryFee: 2000,
  duration: 604800000,
  winnerPercent: 0.5,
  topPercent: 0.05,
};

// ==================== ПИРАТСКИЕ ФРАЗЫ (ПО 50 НА КАТЕГОРИЮ) ====================
const WIN_PHRASES = [
  '🗝️ "Клад наш! Йо-хо-хо!" 🗝️', '💎 "Золото моё! Пиастры!" 💎',
  '🏴‍☠️ "Бочка рома сегодня наша!" 🍾', '⚓ "Победа за нами, капитан!" ⚓',
  '🦜 "Попугай доволен! Клюёт золото!" 🦜', '💰 "Ещё одна монета в сундук!" 💰',
  '🏆 "Ты — настоящий пират!" 🏆', '🌊 "Море сегодня на нашей стороне!" 🌊',
  '💀 "Даже череп улыбается!" 💀', '🔥 "Горячая победа!" 🔥',
  '⚔️ "Шпага остра, удача быстра!" ⚔️', '🏴‍☠️ "Поднять флаг победы!" 🏴‍☠️',
  '💎 "Сокровище уже в руках!" 💎', '🦜 "Попугай кричит: «Победа!»" 🦜',
  '🗝️ "Сундук открыт, клад наш!" 🗝️', '⚓ "Якорь в сердце удачи!" ⚓',
  '💰 "Дублоны сыплются дождём!" 💰', '🏆 "Твоя легенда растёт!" 🏆',
  '🌊 "Волны поют тебе хвалу!" 🌊', '💀 "Берегись, удача любит смелых!" 💀',
  '🔥 "Ты сжёг банк!" 🔥', '⚔️ "Пиратская честь соблюдена!" ⚔️',
  '🏴‍☠️ "Флаг «Чёрная кость» реет гордо!" 🏴‍☠️', '💎 "Бриллиантовый улов!" 💎',
  '🦜 "Попугай уже считает добычу!" 🦜', '🗝️ "Ключ от всех сокровищ у тебя!" 🗝️',
  '⚓ "Штурвал удачи в твоих руках!" ⚓', '💰 "Банк трещит по швам!" 💰',
  '🏆 "Ты — гроза морей!" 🏆', '🌊 "Океан сегодня твой!" 🌊',
  '💀 "Фортуна улыбнулась тебе!" 💀', '🔥 "Победа — твой трофей!" 🔥',
  '⚔️ "Пиратский клинок не знает промаха!" ⚔️', '🏴‍☠️ "Берегись, пират в ударе!" 🏴‍☠️',
  '💎 "Твоя доля — лучшая!" 💎', '🦜 "Попугай танцует от радости!" 🦜',
  '🗝️ "Клад уже в сундуке!" 🗝️', '⚓ "Форт удачи взят!" ⚓',
  '💰 "Дублоны звенят в карманах!" 💰', '🏆 "Пиратская слава бессмертна!" 🏆',
  '🌊 "Ты покорил волны!" 🌊', '💀 "Смерть не страшна, когда есть удача!" 💀',
  '🔥 "Твой час настал!" 🔥', '⚔️ "Враг повержен!" ⚔️',
  '🏴‍☠️ "Флаг пирата — символ победы!" 🏴‍☠️', '💎 "Золото само идёт в руки!" 💎',
  '🦜 "Попугай кричит: «Йо-хо-хо!»" 🦜', '🗝️ "Сокровище ждало тебя!" 🗝️',
  '⚓ "Якорь счастья брошен!" ⚓', '💰 "Богатство — твой удел!" 💰'
];

const LOSE_PHRASES = [
  '💀 "Тысяча чертей! В следующий раз повезёт!" 💀', '🗡️ "Проклятые кости!" 🗡️',
  '🌊 "Волна унесла удачу..." 🌊', '💀 "Череп сегодня не на твоей стороне!" 💀',
  '⚓ "Якорь упал на дно..." ⚓', '🏴‍☠️ "Флаг приспущен..." 🏴‍☠️',
  '🗡️ "Ржавый клинок сегодня..." 🗡️', '💀 "Даже попугай отвернулся!" 💀',
  '🌊 "Шторм неудач..." 🌊', '⚓ "Судно дало течь..." ⚓',
  '🏴‍☠️ "Пиратская удача покинула тебя!" 🏴‍☠️', '🗡️ "Шпага сломалась..." 🗡️',
  '💀 "Морской дьявол помешал!" 💀', '🌊 "Волны сегодня жестоки!" 🌊',
  '⚓ "Якорь на дне..." ⚓', '🏴‍☠️ "Флаг вниз, капитан!" 🏴‍☠️',
  '🗡️ "Оружие сегодня не в руку!" 🗡️', '💀 "Череп смеётся над тобой!" 💀',
  '🌊 "Море выбрало другого!" 🌊', '⚓ "Судно село на мель!" ⚓',
  '🏴‍☠️ "Пиратский совет не одобряет!" 🏴‍☠️', '🗡️ "Клинок затупился..." 🗡️',
  '💀 "Фортуна отвернулась!" 💀', '🌊 "Ты попал в шторм!" 🌊',
  '⚓ "Якорь потерян..." ⚓', '🏴‍☠️ "Флаг пирата в крови!" 🏴‍☠️',
  '🗡️ "Шпага выпала из рук!" 🗡️', '💀 "Смерть смеётся последней!" 💀',
  '🌊 "Волны унесли твои надежды!" 🌊', '⚓ "Судно разбито о скалы!" ⚓',
  '🏴‍☠️ "Пиратский дух сломлен!" 🏴‍☠️', '🗡️ "Клинок не выдержал!" 🗡️',
  '💀 "Череп победил!" 💀', '🌊 "Море сегодня злое!" 🌊',
  '⚓ "Якорь утонул..." ⚓', '🏴‍☠️ "Флаг — чёрный цвет!" 🏴‍☠️',
  '🗡️ "Бой проигран..." 🗡️', '💀 "Пиратская карма догнала!" 💀',
  '🌊 "Шторм сильнее тебя!" 🌊', '⚓ "Судно тонет..." ⚓',
  '🏴‍☠️ "Удача была не с тобой!" 🏴‍☠️', '🗡️ "Шпага в руке дрогнула!" 🗡️',
  '💀 "Череп забрал победу!" 💀', '🌊 "Волны унесли твою удачу!" 🌊',
  '⚓ "Якорь — символ поражения!" ⚓', '🏴‍☠️ "Флаг склонён!" 🏴‍☠️',
  '🗡️ "Клинок сломан!" 🗡️', '💀 "Фортуна не на твоей стороне!" 💀',
  '🌊 "Море безжалостно!" 🌊', '⚓ "Судно проиграло битву!" ⚓'
];

const DRAW_PHRASES = [
  '🤝 "Братан, ничья!" 🤝', '⚓ "Море уравняло шансы!" ⚓',
  '🏴‍☠️ "Пиратская честь не позволяет проигрывать!" 🏴‍☠️', '💀 "Череп улыбается обоим!" 💀',
  '🗡️ "Шпаги скрестились в ничью!" 🗡️', '🌊 "Волны не выбрали победителя!" 🌊',
  '🦜 "Попугай кричит: «Братва, ничья!»" 🦜', '💎 "Золото поделено поровну!" 💎',
  '🗝️ "Клад остался при своих!" 🗝️', '🔥 "Ничья — честный итог!" 🔥',
  '⚓ "Якорь успокоился!" ⚓', '🏴‍☠️ "Флаг не склоняется!" 🏴‍☠️',
  '💀 "Море сохранило равновесие!" 💀', '🗡️ "Бой завершён миром!" 🗡️',
  '🌊 "Волны утихли!" 🌊', '🦜 "Попугай успокоился!" 🦜',
  '💎 "Сокровище поделено!" 💎', '🗝️ "Ключ повернулся в обе стороны!" 🗝️',
  '🔥 "Огонь равенства!" 🔥', '⚓ "Штиль после битвы!" ⚓',
  '🏴‍☠️ "Мирное море!" 🏴‍☠️', '💀 "Череп ничьей!" 💀',
  '🗡️ "Оружие отдыхает!" 🗡️', '🌊 "Море выбрало мир!" 🌊',
  '🦜 "Попугай доволен ничьей!" 🦜', '💎 "Сокровище осталось в сундуке!" 💎',
  '🗝️ "Клад не открыт!" 🗝️', '🔥 "Огонь погас!" 🔥',
  '⚓ "Якорь в равновесии!" ⚓', '🏴‍☠️ "Флаг на месте!" 🏴‍☠️',
  '💀 "Фортуна нейтральна!" 💀', '🗡️ "Шпаги сплетены в дружбе!" 🗡️',
  '🌊 "Волны успокоились!" 🌊', '🦜 "Попугай качает головой!" 🦜',
  '💎 "Золото не ушло!" 💎', '🗝️ "Ключ остался в замке!" 🗝️',
  '🔥 "Пламя ровное!" 🔥', '⚓ "Судно на месте!" ⚓',
  '🏴‍☠️ "Пиратский совет — ничья!" 🏴‍☠️', '💀 "Череп улыбается!" 💀',
  '🗡️ "Клинки скрестились!" 🗡️', '🌊 "Море сохранило тайну!" 🌊',
  '🦜 "Попугай молчит!" 🦜', '💎 "Сокровище не тронуто!" 💎',
  '🗝️ "Клад не взят!" 🗝️', '🔥 "Огонь погас!" 🔥',
  '⚓ "Якорь на месте!" ⚓', '🏴‍☠️ "Флаг не поднят!" 🏴‍☠️',
  '💀 "Фортуна в равновесии!" 💀', '🗡️ "Шпаги убраны!" 🗡️'
];

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
let userMessages = {};
let adminState = {};
let bans = {};

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
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
      pointBet: 0,
      pointMultiplier: 1,
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
      passiveBonus: 0,
      history: [],
      balanceHistory: [],
      refs: [],
      refBonus: 0,
      fleet: { ships: [], totalIncome: 0, lastCollected: Date.now() },
      ships: [],
      achievements: [],
      currentMode: null,
      lastActivity: Date.now(),
      gamesToday: 0,
      gamesDate: '',
      duelStats: { wins: 0, losses: 0, totalGames: 0 },
      withdrawToday: 0,
      withdrawDate: '',
      withdrawHistory: [],
      demoRollsToday: 0,
      demoDate: '',
      activeDuelChallenges: [],
      tempBet: 0,
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isBanned(id) {
  if (bans[id] && bans[id].until > Date.now()) return true;
  if (bans[id]) delete bans[id];
  return false;
}

function getBanInfo(id) {
  return bans[id] || null;
}

// ==================== ФУНКЦИИ КОРАБЛЕЙ ====================
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
    bot.sendMessage(id, formatMessage('АКТИВНОСТЬ', message));
  }
}

function collectPassiveIncome(id) {
  const p = getPlayer(id);
  if (!p) return;
  const now = Date.now();
  const elapsedMs = now - p.lastPassiveTime;
  const hours = elapsedMs / 3600000;
  if (hours < 1) return;
  const basePassive = RANKS[p.rank].passive;
  const bonusMultiplier = 1 + (p.passiveBonus || 0) / 100;
  const earned = Math.floor(basePassive * hours * bonusMultiplier);
  if (earned > 0) {
    p.passiveCollected = safeNumber(p.passiveCollected) + earned;
    p.lastPassiveTime = now;
    saveData();
  }
}

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
      p.passiveBonus = (p.passiveBonus || 0) + ach.bonusPassive;
      addHistory(id, `🏆 Достижение: ${ach.name} (+${ach.bonusPassive}% к пассивному доходу)`);
      bot.sendMessage(id, formatMessage(
        'ДОСТИЖЕНИЕ РАЗБЛОКИРОВАНО!',
        `${ach.name}\n${ach.desc}\n📈 +${ach.bonusPassive}% к пассивному доходу\n💰 Текущий бонус: ${p.passiveBonus || 0}%`
      ));
      saveData();
    }
  }
}

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
      bot.sendMessage(id, formatMessage(
        'ТЕХНИЧЕСКИЕ РАБОТЫ',
        `${maintenanceMessage}\n⏳ Ориентировочное время: ${hours} час(ов)\n📅 Окончание: ${new Date(maintenanceEndTime).toLocaleTimeString()}\n\nПросьба завершить игры до этого времени.`
      )).catch(() => {});
    }
  }
  saveData();
  console.log(`🔧 Технические работы включены на ${hours} часов`);
}

function processSunduk(id) {
  const p = getPlayer(id);
  if (!p) return;
  if (safeNumber(bank.pot) < MIN_SUNDUK_BANK) {
    bot.sendMessage(id, formatMessage('СУНДУК', `❌ Банк меньше ${MIN_SUNDUK_BANK} дуб. Сундук недоступен.`));
    return;
  }
  const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
  if (balance < 500) {
    bot.sendMessage(id, formatMessage('СУНДУК', '❌ У тебя меньше 500 дуб.'));
    return;
  }
  if (p.demoMode) {
    p.demoBalance = safeNumber(p.demoBalance) - 500;
  } else {
    p.balance = safeNumber(p.balance) - 500;
  }
  const winPercent = 90;
  const winAmount = Math.floor(safeNumber(bank.pot) * winPercent / 100);

  bot.sendMessage(id, formatMessage('СУНДУК', '🎲 Сундук открывается...'));
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
      bot.sendMessage(id, formatMessage(
        '🎁 ВАМ ПОВЕЗЛО!',
        `Ты: ${playerDice1}+${playerDice2}=${playerSum}\nКапитан: ${adminDice1}+${adminDice2}=${adminSum}\n\nТы забираешь ${winAmount} дуб. из банка!`
      ));
    } else {
      addHistory(id, `СУНДУК: поражение (-500 дуб.)`);
      addBalanceHistory(id, -500, 'Сундук: поражение');
      bot.sendMessage(id, formatMessage(
        '💀 ПРОИГРЫШ',
        `Ты: ${playerDice1}+${playerDice2}=${playerSum}\nКапитан: ${adminDice1}+${adminDice2}=${adminSum}\n\nТвой взнос 500 дуб. ушёл в банк.`
      ));
    }
    saveData();
  }, 1000);
}

function checkWorkHours() {
  const now = new Date();
  const hours = now.getUTCHours();
  const minutes = now.getUTCMinutes();
  const currentTime = hours * 60 + minutes;
  const WORK_START = 4 * 60;
  const WORK_END = 20 * 60;
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

function scheduleRandomEvent() {
  setTimeout(() => {
    const event = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    activeEvent = event;
    for (let id in players) {
      const p = players[id];
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if ((balance > 0 || safeNumber(p.demoBalance) > 0) && (Date.now() - p.lastPassiveTime < 86400000)) {
        bot.sendMessage(id, formatMessage(
          '🎉 СОБЫТИЕ АКТИВИРОВАНО!',
          `${event.name}\n${event.desc}\n⏳ Длится ${event.duration / 60000} минут!`
        )).catch(() => {});
      }
    }
    eventTimer = setTimeout(() => {
      activeEvent = null;
      for (let id in players) {
        const p = players[id];
        const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
        if ((balance > 0 || safeNumber(p.demoBalance) > 0) && (Date.now() - p.lastPassiveTime < 86400000)) {
          bot.sendMessage(id, formatMessage('СОБЫТИЕ ЗАВЕРШЕНО', `"${event.name}" завершено!`)).catch(() => {});
        }
      }
      scheduleRandomEvent();
    }, event.duration);
    saveData();
  }, 3600000 + Math.random() * 7200000);
}

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

// ==================== ТУРНИРЫ ====================
function startTournament() {
  tournaments.active = true;
  tournaments.players = [];
  tournaments.prizePool = 0;
  tournaments.endTime = Date.now() + TOURNAMENT_CONFIG.duration;
  tournaments.results = [];
  saveData();
  for (let id in players) {
    bot.sendMessage(id, formatMessage(
      '⚔️ ТУРНИР НАЧАЛСЯ!',
      `💰 Вход: ${TOURNAMENT_CONFIG.entryFee} дуб.\n🏆 Призовой фонд: ${tournaments.prizePool} дуб.\n⏳ Длится: 7 дней\n\nУчаствуй! Нажми "✅ Участвовать"`
    )).catch(() => {});
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
      bot.sendMessage(winnerId, formatMessage('🏆 ПОБЕДА В ТУРНИРЕ!', `Ты получил ${prize} дуб.`));
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
        bot.sendMessage(pid, formatMessage('🎉 ТОП-10 ТУРНИРА', `Ты занял ${i+1} место! Получил ${prize} дуб.`));
      }
    }
  }
  saveData();
  setTimeout(() => { startTournament(); }, 7 * 86400000);
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

// ==================== ДЖЕКПОТ (РАНДОМНЫЙ % ОТ СТАВКИ) ====================
function getJackpotTarget() {
  return Math.floor(Math.random() * 100) + 1;
}

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

function checkJackpot(id, betAmount) {
  const p = getPlayer(id);
  if (!p) return 0;

  const percent = 0.5 + Math.random() * 4.5;
  const increment = Math.floor(betAmount * percent / 100);
  if (increment < 1) return 0;

  bank.jackpot = safeNumber(bank.jackpot) + increment;
  jackpotCounter++;

  const target = getJackpotTarget();
  const bar = getJackpotBar();
  const msg = `🎯 Джекпот +${increment} дуб. (${percent.toFixed(1)}% от ставки)\n` +
    `📊 Прогресс: ${jackpotCounter}/${target} точек\n` +
    `🟩 ${bar}\n` +
    `💰 Джекпот: ${bank.jackpot} дуб.`;

  for (let pid in players) {
    bot.sendMessage(pid, formatMessage('ДЖЕКПОТ ОБНОВЛЁН', msg)).catch(() => {});
  }
  saveData();

  if (Math.random() < 0.01) {
    const winAmount = bank.jackpot;
    bank.jackpot = 0;
    const totalWin = betAmount + winAmount;
    p.balance = safeNumber(p.balance) + totalWin;
    addHistory(id, `🎰 ДЖЕКПОТ! +${winAmount} дуб. (всего: ${totalWin})`);
    bot.sendMessage(id, formatMessage('🎰 ДЖЕКПОТ ВЫИГРАН!', `💰 +${winAmount} дуб.\n🎉 Поздравляем!`));
    return totalWin;
  }
  return 0;
}

function checkJackpotBonus(id, betAmount, isWin) {
  const p = getPlayer(id);
  if (!p) return;

  if (betAmount >= 1000) {
    checkJackpot(id, betAmount);
    bot.sendMessage(id, formatMessage('ДЖЕКПОТ', '🎯 Бонусная точка джекпота за крупную ставку!'));
  }

  if (isWin && p.wins >= 5 && p.wins % 5 === 0) {
    checkJackpot(id, betAmount);
    bot.sendMessage(id, formatMessage('ДЖЕКПОТ', '🔥 Бонусная точка джекпота за серию побед!'));
  }
}

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
      bot.sendMessage(id, formatMessage('НОВЫЙ РАУНД', `Банк: ${safeNumber(bank.pot)} | Джекпот: ${safeNumber(bank.jackpot)}`)).catch(() => {});
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
        bot.sendMessage(id, formatMessage('РАУНД ЗАВЕРШЁН', `${jackpotPart} ушло в джекпот (теперь ${safeNumber(bank.jackpot)})\nНовый раунд через 30 сек.`)).catch(() => {});
      }
    }
    saveData();
    setTimeout(() => { bank.roundActive = false; startRound(); }, 30000);
  }, 600000);
}

// ==================== КЛАВИАТУРЫ ====================
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

function gameModeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🎲 Классика', callback_data: 'mode_classic' }, { text: '⚔️ Дуэль', callback_data: 'mode_duel' }],
      [{ text: '👑 VIP', callback_data: 'mode_vip' }, { text: '🎴 Блэкджек', callback_data: 'mode_blackjack' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  };
}

function inputBetKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Назад', callback_data: 'menu_play' }]
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

function profileKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Статистика', callback_data: 'profile_stats' }],
      [{ text: '📜 История', callback_data: 'profile_history' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  };
}

function rankKeyboard() {
  const keyboard = [];
  for (let i = 0; i < RANKS.length; i++) {
    if (i > 0) {
      keyboard.push([{ text: `${RANKS[i].emoji} ${RANKS[i].name} (${RANKS[i].costDublons} дуб.)`, callback_data: `rank_${i}` }]);
    }
  }
  keyboard.push([{ text: '🔙 Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: keyboard };
}

function collectKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '💰 Забрать доход', callback_data: 'collect_take' }],
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  };
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

function fleetKeyboard() {
  const keyboard = [];
  for (let i = 0; i < SHIPS.length; i++) {
    const ship = SHIPS[i];
    keyboard.push([{ text: `${ship.emoji} ${ship.name} (${ship.cost} дуб.)`, callback_data: `fleet_buy_${ship.id}` }]);
  }
  keyboard.push([{ text: '🔙 Назад', callback_data: 'menu_main' }]);
  return { inline_keyboard: keyboard };
}

function resultKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🎲 Играть ещё', callback_data: 'mode_classic' }],
      [{ text: '🏴‍☠️ Главное меню', callback_data: 'menu_main' }]
    ]
  };
}

function backKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔙 Назад', callback_data: 'menu_main' }]
    ]
  };
}

// ==================== ДУЭЛИ ====================
function processDuel(challengerId, opponentId, amount) {
  const challenger = getPlayer(challengerId);
  const opponent = getPlayer(opponentId);

  let round = 0;
  let winnerId = null;
  let roundResults = [];

  const challengerBet = amount;
  const opponentBet = amount;

  while (round < CONFIG.MAX_DUEL_ROUNDS && !winnerId) {
    round++;

    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum1 = d1 + d2;

    const d3 = Math.floor(Math.random() * 6) + 1;
    const d4 = Math.floor(Math.random() * 6) + 1;
    const sum2 = d3 + d4;

    bot.sendMessage(challengerId, formatMessage('ДУЭЛЬ РАУНД ' + round, `${d1}+${d2}=${sum1}`));
    bot.sendMessage(opponentId, formatMessage('ДУЭЛЬ РАУНД ' + round, `${d3}+${d4}=${sum2}`));

    roundResults.push({ round, challengerSum: sum1, opponentSum: sum2 });

    if (sum1 > sum2) {
      winnerId = challengerId;
    } else if (sum2 > sum1) {
      winnerId = opponentId;
    } else if (round === CONFIG.MAX_DUEL_ROUNDS) {
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
      bot.sendMessage(challengerId, formatMessage('ДУЭЛЬ', '🤝 Ничья после 5 раундов! Ставки возвращены.'));
      bot.sendMessage(opponentId, formatMessage('ДУЭЛЬ', '🤝 Ничья после 5 раундов! Ставки возвращены.'));
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

    checkAchievements(winnerId);

    let resultMsg = `⚔️ ДУЭЛЬ ЗАВЕРШЕНА!\n\n`;
    roundResults.forEach(r => {
      resultMsg += `Раунд ${r.round}: ${r.challengerSum} vs ${r.opponentSum}\n`;
    });
    resultMsg += `\n🏆 Победитель: @${winner.username || winnerId}`;
    resultMsg += `\n💰 Выигрыш: ${winAmount} дуб.`;

    bot.sendMessage(challengerId, formatMessage('ДУЭЛЬ ЗАВЕРШЕНА', resultMsg), { reply_markup: resultKeyboard() });
    bot.sendMessage(opponentId, formatMessage('ДУЭЛЬ ЗАВЕРШЕНА', resultMsg), { reply_markup: resultKeyboard() });
  }

  saveData();
}

function createDuelChallenge(id, amount) {
  const p = getPlayer(id);
  if (!p) return false;

  if (duelChallenges[id]) {
    return false;
  }

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

// ==================== ОБРАБОТЧИК /START ====================
bot.onText(/\/start/, async (msg) => {
  try {
    const id = msg.chat.id;
    if (isBanned(id)) {
      const info = getBanInfo(id);
      const timeLeft = Math.ceil((info.until - Date.now()) / 60000);
      bot.sendMessage(id, formatMessage('БЛОКИРОВКА', `⛔ Ты заблокирован!\nПричина: ${info.reason || 'Нарушение правил'}\nОсталось: ${timeLeft} мин.`));
      return;
    }
    const p = getPlayer(id);
    if (!p) return;
    p.username = msg.from.username || 'noname';
    collectPassiveIncome(id);
    if (p.activeDuelChallenges && p.activeDuelChallenges.length > 0) {
      for (let challenge of p.activeDuelChallenges) {
        const challenger = getPlayer(challenge.from);
        if (challenger) {
          bot.sendMessage(id, formatMessage('АКТИВНЫЙ ВЫЗОВ', `⚔️ У тебя есть активный вызов от @${challenger.username || challenge.from} на ${challenge.amount} дуб.`));
        }
      }
    }
    const lastActivity = p.lastActivity || 0;
    if (Date.now() - lastActivity > 600000) {
      bot.sendMessage(id, formatMessage('ДОБРО ПОЖАЛОВАТЬ', '🏴‍☠️ Добро пожаловать обратно!'));
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
          bot.sendMessage(refId, formatMessage('РЕФЕРАЛ', `🎁 Твой друг @${p.username || id} зарегистрировался! +30 дуб.`));
          bot.sendMessage(id, formatMessage('БОНУС', `🎁 Приветственный бонус +15 дуб. от @${players[refId].username || refId}!`));
        }
      }
    }
    addHistory(id, 'Зарегистрировался');
    addBalanceHistory(id, 10, 'Начальный баланс');
    saveData();
    const rank = RANKS[p.rank];
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    const target = getJackpotTarget();
    const bar = getJackpotBar();

    bot.sendMessage(id,
      formatMessage(
        '🏴‍☠️ ЧЁРНАЯ КОСТЬ',
        `💰 Баланс: ${balance} дуб.\n` +
        `🏴‍☠️ Ранг: ${rank.emoji} ${rank.name} (+${rank.bonus}% к выигрышу)\n` +
        `📊 Доля: ${p.share}% банка\n` +
        `🎰 Джекпот: ${safeNumber(bank.jackpot)} дуб.\n` +
        `🏦 Банк: ${safeNumber(bank.pot)} дуб.\n` +
        `🎯 Прогресс джекпота: ${jackpotCounter}/${target}\n` +
        `🟩 ${bar}\n` +
        `💨 Пассивный доход: ${rank.passive} дуб./час`
      ),
      {
        reply_markup: mainInlineKeyboard()
      }
    );
  } catch (error) {
    console.error('❌ Ошибка в /start:', error.message);
    console.error(error.stack);
    try {
      await bot.sendMessage(msg.chat.id, formatMessage('ОШИБКА', '⚠️ Произошла ошибка при запуске. Пожалуйста, попробуй позже.'));
    } catch (e) {}
  }
});

// ==================== КОМАНДА /HISTORY ====================
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
  bot.sendMessage(id, formatMessage('ИСТОРИЯ', text), { reply_markup: backKeyboard() });
});

// ==================== КОМАНДА /ADMIN ====================
bot.onText(/\/admin/, (msg) => {
  if (msg.chat.id !== ADMIN_ID) return;
  bot.sendMessage(msg.chat.id, formatMessage('👑 АДМИН-ПАНЕЛЬ', 'Выбери действие:'), {
    reply_markup: adminInlineKeyboard()
  });
});

// ==================== КОМАНДА /RESETDEMO ====================
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
  bot.sendMessage(id, formatMessage('ДЕМО СБРОШЕН', '🔄 Демо-баланс сброшен до 50. Можно играть заново.'), { reply_markup: mainInlineKeyboard() });
});

// ==================== ОСНОВНОЙ ОБРАБОТЧИК CALLBACK_QUERY ====================
bot.on('callback_query', async (query) => {
  const id = query.from.id;
  const data = query.data;

  bot.answerCallbackQuery(query.id).catch(() => {});
  console.log('📥 CALLBACK:', data, 'от', id);

  if (!global.callbackCooldown) global.callbackCooldown = {};
  const currentTime = Date.now();
  const cooldownKey = `${id}_${data}`;
  if (global.callbackCooldown[cooldownKey] && currentTime - global.callbackCooldown[cooldownKey] < 500) {
    console.log(`⏳ Дублирование ${data} от ${id} игнорировано`);
    return;
  }
  global.callbackCooldown[cooldownKey] = currentTime;

  if (isBanned(id)) {
    const info = getBanInfo(id);
    const timeLeft = Math.ceil((info.until - Date.now()) / 60000);
    bot.sendMessage(id, formatMessage('БЛОКИРОВКА', `⛔ Ты заблокирован!\nПричина: ${info.reason || 'Нарушение правил'}\nОсталось: ${timeLeft} мин.`));
    return;
  }

  const p = getPlayer(id);
  if (!p) return;

  if (isMaintenanceActive() && id !== ADMIN_ID) {
    const timeLeft = Math.max(0, Math.ceil((maintenanceEndTime - Date.now()) / 60000));
    bot.sendMessage(id, formatMessage(
      'ТЕХНИЧЕСКИЕ РАБОТЫ',
      `${maintenanceMessage}\n⏳ Осталось примерно: ${timeLeft} минут`
    ));
    return;
  }

  if (data === 'menu_main') {
    collectPassiveIncome(id);
    const rank = RANKS[p.rank];
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    const target = getJackpotTarget();
    const bar = getJackpotBar();

    bot.sendMessage(id,
      formatMessage(
        '🏴‍☠️ ЧЁРНАЯ КОСТЬ',
        `💰 Баланс: ${balance} дуб.\n` +
        `🏴‍☠️ Ранг: ${rank.emoji} ${rank.name}\n` +
        `📊 Доля: ${p.share}%\n` +
        `🎰 Джекпот: ${safeNumber(bank.jackpot)}\n` +
        `🎯 ${jackpotCounter}/${target}\n` +
        `🟩 ${bar}`
      ),
      {
        reply_markup: mainInlineKeyboard()
      }
    );
    return;
  }

  if (data === 'menu_play') {
    p.currentMode = null;
    bot.sendMessage(id, formatMessage(
      '🎮 ВЫБЕРИ РЕЖИМ ИГРЫ',
      '🎲 Классика — игра против банка\n⚔️ Дуэль — против другого игрока\n👑 VIP — против админа (только за деньги)\n🎴 Блэкджек — карточная игра'
    ), {
      reply_markup: gameModeKeyboard()
    });
    return;
  }

  if (data === 'mode_classic') {
    p.currentMode = 'classic';
    collectPassiveIncome(id);
    bot.sendMessage(id, formatMessage('🎲 КЛАССИКА', 'Введи сумму ставки:'), {
      reply_markup: inputBetKeyboard()
    });
    return;
  }

  if (data === 'mode_duel') {
    p.currentMode = 'duel';
    collectPassiveIncome(id);
    bot.sendMessage(id, formatMessage('⚔️ ДУЭЛЬ', `Введи сумму ставки (мин ${MIN_DUEL_MONEY}):`), {
      reply_markup: inputBetKeyboard()
    });
    return;
  }

  if (data === 'mode_vip') {
    if (p.demoMode) {
      bot.sendMessage(id, formatMessage('VIP', '❌ VIP-игра недоступна в демо-режиме.'), { reply_markup: backKeyboard() });
      return;
    }
    p.currentMode = 'vip';
    collectPassiveIncome(id);
    bot.sendMessage(id, formatMessage('👑 VIP-ИГРА', `Введи сумму ставки (от ${MIN_VIP_BET} до ${MAX_VIP_BET}):`), {
      reply_markup: inputBetKeyboard()
    });
    return;
  }

  if (data === 'mode_blackjack') {
    if (blackjackGames[id]) {
      bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', '❌ У тебя уже есть активная игра в блэкджек!'));
      return;
    }
    p.currentMode = 'blackjack';
    collectPassiveIncome(id);
    const minBet = BLACKJACK_CONFIG.minBet;
    const maxBet = BLACKJACK_CONFIG.maxBet;
    bot.sendMessage(id, formatMessage('🎴 БЛЭКДЖЕК', `Введи сумму ставки (от ${minBet} до ${maxBet}):`), {
      reply_markup: inputBetKeyboard()
    });
    return;
  }

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
      `🏆 Достижений: ${p.achievements?.length || 0}/${ACHIEVEMENTS.length}\n` +
      `📈 Бонус пассивного дохода: ${p.passiveBonus || 0}%`;

    if (p.demoMode) msg += `\n🎮 ДЕМО-РЕЖИМ`;

    bot.sendMessage(id, formatMessage('ПРОФИЛЬ', msg), {
      reply_markup: profileKeyboard()
    });
    return;
  }

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
      `🔗 Рефералов: ${p.refs?.length || 0}\n` +
      `📈 Бонус пассивного дохода: ${p.passiveBonus || 0}%`;

    bot.sendMessage(id, formatMessage('СТАТИСТИКА', msg), { reply_markup: backKeyboard() });
    return;
  }

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
    bot.sendMessage(id, formatMessage('ИСТОРИЯ', msg), { reply_markup: backKeyboard() });
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
    msg += `📤 Текущий ранг: ${RANKS[p.rank].emoji} ${RANKS[p.rank].name}\n\n`;
    msg += `Выбери ранг для покупки:`;
    bot.sendMessage(id, formatMessage('РАНГИ', msg), {
      reply_markup: rankKeyboard()
    });
    return;
  }

  if (data.startsWith('rank_')) {
    const rankIdx = parseInt(data.split('_')[1]);
    const r = RANKS[rankIdx];
    if (rankIdx <= p.rank) {
      bot.sendMessage(id, formatMessage('РАНГ', '❌ У тебя уже есть этот ранг или выше.'), { reply_markup: backKeyboard() });
      return;
    }
    if (rankIdx > p.rank + 1) {
      bot.sendMessage(id, formatMessage('РАНГ', `❌ Сначала купи предыдущий ранг: ${RANKS[rankIdx-1].emoji} ${RANKS[rankIdx-1].name}`), { reply_markup: backKeyboard() });
      return;
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < r.costDublons) {
      bot.sendMessage(id, formatMessage('РАНГ', `❌ Не хватает. Нужно ${r.costDublons} дуб.`), { reply_markup: backKeyboard() });
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
    bot.sendMessage(id, formatMessage('✅ ПОЗДРАВЛЯЮ!', `Ты получил ранг ${r.emoji} ${r.name}!`), {
      reply_markup: mainInlineKeyboard()
    });
    return;
  }

  if (data === 'menu_bank') {
    const totalShares = Object.values(players).reduce((sum, p) => sum + (p.share || 0), 0);
    const target = getJackpotTarget();
    const bar = getJackpotBar();

    bot.sendMessage(id,
      formatMessage(
        '💰 БАНК ПИРАТОВ',
        `🏦 Банк: ${safeNumber(bank.pot)} дуб.\n` +
        `🎰 Джекпот: ${safeNumber(bank.jackpot)} дуб.\n` +
        `📊 Всего ставок: ${safeNumber(bank.totalStakes)} дуб.\n` +
        `📈 Общая доля игроков: ${totalShares}%\n` +
        `🎯 Прогресс джекпота: ${jackpotCounter}/${target}\n` +
        `🟩 ${bar}`
      ),
      {
        reply_markup: backKeyboard()
      }
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
    sorted.forEach(([pid, data], i) => {
      const rank = RANKS[data.rank]?.emoji || '🪵';
      const adminMark = parseInt(pid) === ADMIN_ID ? ' 👑' : '';
      const balance = data.demoMode ? safeNumber(data.demoBalance) : safeNumber(data.balance);
      msgText += `${i+1}. ${rank} ${data.username || pid.substr(-4)}${adminMark} — ${balance} дуб.\n`;
    });
    bot.sendMessage(id, formatMessage('ТОП ИГРОКОВ', msgText), { reply_markup: backKeyboard() });
    return;
  }

  if (data === 'menu_income') {
    collectPassiveIncome(id);
    const passivePerHour = RANKS[p.rank].passive;
    const now = Date.now();
    const elapsedMs = now - p.lastPassiveTime;
    const nextHourMs = 3600000 - (elapsedMs % 3600000);
    const nextHourMinutes = Math.ceil(nextHourMs / 60000);
    const shareIncome = Math.floor(safeNumber(bank.totalStakes) * (p.share / 100));
    const bonusPercent = p.passiveBonus || 0;

    let msg = `🌊 ПАССИВНЫЙ ДОХОД\n\n` +
      `🏴‍☠️ От ранга: ${passivePerHour} дуб./час\n` +
      `📈 Бонус достижений: +${bonusPercent}%\n` +
      `📊 От доли: ${shareIncome} дуб./день\n` +
      `⏳ Следующий доход через: ${nextHourMinutes} мин.\n` +
      `📦 Накоплено: ${safeNumber(p.passiveCollected)} дуб.\n` +
      `${safeNumber(p.passiveCollected) > 0 ? '✅ Готово к сбору!' : '⏳ Пока нет дохода'}`;

    bot.sendMessage(id, formatMessage('ПАССИВНЫЙ ДОХОД', msg), {
      reply_markup: collectKeyboard()
    });
    return;
  }

  if (data === 'collect_take') {
    collectPassiveIncome(id);
    if (safeNumber(p.passiveCollected) <= 0) {
      bot.sendMessage(id, formatMessage('ДОХОД', '❌ Нет дохода для сбора.'), { reply_markup: backKeyboard() });
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
    bot.sendMessage(id, formatMessage('ДОХОД СОБРАН', `💰 Ты собрал доход! Баланс: ${balance} дуб.`), {
      reply_markup: mainInlineKeyboard()
    });
    return;
  }

  if (data === 'menu_withdraw' || data === '💸 Вывод') {
    if (p.demoMode) {
      bot.sendMessage(id, formatMessage('ВЫВОД', '❌ В демо-режиме вывод недоступен.'), { reply_markup: backKeyboard() });
      return;
    }
    if (safeNumber(bank.pot) < MIN_BANK) {
      bot.sendMessage(id, formatMessage('ВЫВОД', `❌ Банк меньше ${MIN_BANK} дуб. Вывод временно недоступен.`), { reply_markup: backKeyboard() });
      return;
    }
    const hasPurchased = safeNumber(p.totalEarned) > 0;
    if (!hasPurchased && p.rank < 2) {
      bot.sendMessage(id, formatMessage('ВЫВОД', '❌ Вывод доступен только после покупки дублонов (от 500 дуб.) или достижения ранга Капитан.'), { reply_markup: backKeyboard() });
      return;
    }
    const maxWithdraw = Math.floor(Math.min(safeNumber(p.balance) * MAX_WITHDRAW_PERCENT, MAX_WITHDRAW_DAILY));
    if (maxWithdraw < MIN_WITHDRAW) {
      bot.sendMessage(id, formatMessage('ВЫВОД', `❌ Минимальный вывод ${MIN_WITHDRAW} дуб. Доступно: ${maxWithdraw} дуб.`), { reply_markup: backKeyboard() });
      return;
    }
    bot.sendMessage(id,
      formatMessage(
        '💸 ВЫВОД',
        `💰 Баланс: ${safeNumber(p.balance)} дуб.\n` +
        `📊 Доступно сегодня: ${maxWithdraw} дуб.\n` +
        `📉 Комиссия: 10%\n` +
        `📌 Мин: ${MIN_WITHDRAW}, Макс: ${maxWithdraw}`
      ),
      {
        reply_markup: withdrawInlineKeyboard()
      }
    );
    return;
  }

  if (data.startsWith('withdraw_')) {
    const amount = parseInt(data.split('_')[1]);
    if (isNaN(amount)) return bot.sendMessage(id, formatMessage('ВЫВОД', '❌ Ошибка суммы.'));
    if (p.demoMode) return bot.sendMessage(id, formatMessage('ВЫВОД', '❌ В демо-режиме вывод недоступен.'));
    if (safeNumber(p.balance) < amount) return bot.sendMessage(id, formatMessage('ВЫВОД', `❌ Не хватает. У тебя ${safeNumber(p.balance)} дуб.`));
    const maxWithdraw = Math.floor(Math.min(safeNumber(p.balance) * MAX_WITHDRAW_PERCENT, MAX_WITHDRAW_DAILY));
    if (amount > maxWithdraw) return bot.sendMessage(id, formatMessage('ВЫВОД', `❌ Можно вывести не более ${maxWithdraw} дуб.`));
    if (amount < MIN_WITHDRAW) return bot.sendMessage(id, formatMessage('ВЫВОД', `❌ Минимальный вывод ${MIN_WITHDRAW} дуб.`));

    const withdrawFee = Math.floor(amount * 0.1);
    const finalAmount = amount - withdrawFee;
    if (finalAmount < 1) return bot.sendMessage(id, formatMessage('ВЫВОД', '❌ Сумма слишком мала после комиссии.'));

    const today = new Date().toDateString();
    if (p.withdrawDate !== today) { p.withdrawToday = 0; p.withdrawDate = today; }
    if ((p.withdrawToday || 0) + amount > MAX_WITHDRAW_DAILY) {
      return bot.sendMessage(id, formatMessage('ВЫВОД', `❌ Лимит ${MAX_WITHDRAW_DAILY} дуб./сутки. Осталось: ${MAX_WITHDRAW_DAILY - (p.withdrawToday || 0)}`));
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
    bot.sendMessage(id, formatMessage('ВЫВОД', `✅ Запрос на ${finalAmount} дуб. принят (комиссия ${withdrawFee} дуб.).\nОжидай подтверждения.`), { reply_markup: backKeyboard() });
    bot.sendMessage(ADMIN_ID, formatMessage('📤 ВЫВОД', `@${p.username || id} — ${finalAmount} дуб. (комиссия ${withdrawFee}).\nОчередь: ${withdrawQueue.length}`));
    return;
  }

  if (data === 'menu_demo') {
    p.demoMode = !p.demoMode;
    if (p.demoMode) {
      if (p.demoDate !== new Date().toDateString()) {
        p.demoRollsToday = 0;
        p.demoDate = new Date().toDateString();
      }
      saveData();
      bot.sendMessage(id,
        formatMessage('🎮 ДЕМО-РЕЖИМ ВКЛЮЧЁН', `Баланс: ${safeNumber(p.demoBalance)} (осталось ${20 - (p.demoRollsToday || 0)} бросков)`),
        {
          reply_markup: mainInlineKeyboard()
        }
      );
    } else {
      saveData();
      bot.sendMessage(id, formatMessage('🎮 ДЕМО-РЕЖИМ ВЫКЛЮЧЁН', ''), {
        reply_markup: mainInlineKeyboard()
      });
    }
    return;
  }

  if (data === 'menu_ref') {
    const botInfo = await bot.getMe();
    const link = `https://t.me/${botInfo.username}?start=ref_${id}`;
    bot.sendMessage(id,
      formatMessage(
        '🔗 ТВОЯ РЕФ-ССЫЛКА',
        `${link}\n\n🎁 За каждого друга: ты +30 дуб., друг +15 дуб.\n👥 Приведено: ${p.refs?.length || 0}`
      ),
      {
        reply_markup: backKeyboard()
      }
    );
    return;
  }

  if (data === 'menu_help') {
    bot.sendMessage(id,
      formatMessage(
        '🏴‍☠️ ДОБРО ПОЖАЛОВАТЬ В ЧЁРНУЮ КОСТЬ!',
        'Это пиратская игра на дублоны. Зарабатывай, повышай ранг, покупай долю в банке и выводи деньги!\n\n📖 КАК ИГРАТЬ:\n1. Нажми «🎰 Играть» и выбери режим\n2. Введи сумму ставки\n3. Жди результат\n\n🏴‍☠️ КАК ЗАРАБОТАТЬ:\n• Повышай ранг → пассивный доход\n• Покупай долю → доход от всех ставок\n• Забирай ежедневный бонус\n• Приводи друзей → +30 дуб.\n• Участвуй в турнирах\n\n❓ Вопросы: @magistryu'
      ),
      {
        reply_markup: backKeyboard()
      }
    );
    return;
  }

  if (data === 'daily_bonus') {
    const today = new Date().toDateString();
    if (p.lastDailyDate === today) {
      const now = Date.now();
      const left = 24 - Math.floor((now - new Date(today).getTime()) / 3600000);
      bot.sendMessage(id, formatMessage('ЕЖЕДНЕВНЫЙ БОНУС', `⏳ Бонус уже получен. Следующий через ${left} ч.`), { reply_markup: backKeyboard() });
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
    bot.sendMessage(id, formatMessage('🎁 ЕЖЕДНЕВНЫЙ БОНУС', `+${bonus} дуб.!\n🔥 Серия: ${streak} дней!\n💰 Баланс: ${balance}`), { reply_markup: mainInlineKeyboard() });
    return;
  }

  // ==================== БЛЭКДЖЕК ====================
  if (data === 'bj_hit' || data === 'bj_stand' || data === 'bj_double' || data === 'bj_split') {
    const game = blackjackGames[id];
    if (!game || game.status === 'finished') {
      bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', '❌ Игра не активна.'));
      return;
    }

    if (data === 'bj_split' && game.splitAvailable) {
      if (game.playerHand.length !== 2 || game.playerHand[0].rank !== game.playerHand[1].rank) {
        bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', '❌ Сплит недоступен.'));
        return;
      }

      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < game.bet) {
        bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', `❌ Не хватает. Нужно ${game.bet} дуб.`));
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
        bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', '❌ Недостаточно карт для сплита!'));
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
        formatMessage(
          '✂️ СПЛИТ!',
          `Рука 1: ${formatHand(hand)} (${value} очков)\n💰 Ставка: ${game.bet} дуб. (каждая рука)\n\nХоди рукой 1:`
        ),
        {
          reply_markup: blackjackKeyboard()
        }
      );
      return;
    }

    if (data === 'bj_hit') {
      const deck = game.deck;
      if (!deck || deck.length === 0) {
        bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', '❌ Колода пуста!'));
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
        formatMessage(
          '🎴 ВЗЯЛ!',
          `Твоя рука: ${formatHand(game.playerHand)} (${value} очков)\n💰 Ставка: ${game.bet} дуб.`
        ),
        {
          reply_markup: blackjackKeyboard()
        }
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
        bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', `❌ Не хватает. Нужно ${game.bet} дуб.`));
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
        bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', '❌ Колода пуста!'));
        return;
      }
      game.playerHand.push(deck.pop());
      finishBlackjack(id);
      return;
    }
  }

  if (data === 'bj_quit') {
    delete blackjackGames[id];
    bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', '❌ Игра завершена.'), {
      reply_markup: mainInlineKeyboard()
    });
    return;
  }

  // ==================== ТУРНИРЫ ====================
  if (data === 'menu_tournament') {
    bot.sendMessage(id, formatMessage('⚔️ ТУРНИРЫ', 'Выбери действие:'), {
      reply_markup: tournamentKeyboard()
    });
    return;
  }

  if (data === 'tournament_info') {
    if (!tournaments.active) {
      bot.sendMessage(id, formatMessage('ТУРНИР', '⏳ Турнир не активен. Ожидайте начала.'), { reply_markup: backKeyboard() });
      return;
    }
    const timeLeft = Math.max(0, tournaments.endTime - Date.now());
    const hours = Math.floor(timeLeft / 3600000);
    const minutes = Math.floor((timeLeft % 3600000) / 60000);
    bot.sendMessage(id,
      formatMessage(
        '⚔️ ИНФО О ТУРНИРЕ',
        `📊 Участников: ${tournaments.players.length}\n💰 Призовой фонд: ${tournaments.prizePool} дуб.\n⏳ До конца: ${hours}ч ${minutes}м\n🏆 Победитель получит 50% призового фонда!\n💰 Вход: ${TOURNAMENT_CONFIG.entryFee} дуб.`
      ),
      {
        reply_markup: tournamentKeyboard()
      }
    );
    return;
  }

  if (data === 'tournament_join') {
    if (!tournaments.active) {
      bot.sendMessage(id, formatMessage('ТУРНИР', '⏳ Турнир не активен.'), { reply_markup: backKeyboard() });
      return;
    }
    if (tournaments.players.includes(id)) {
      bot.sendMessage(id, formatMessage('ТУРНИР', '❌ Ты уже участвуешь в турнире.'), { reply_markup: backKeyboard() });
      return;
    }
    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < TOURNAMENT_CONFIG.entryFee) {
      bot.sendMessage(id, formatMessage('ТУРНИР', `❌ Не хватает. Нужно ${TOURNAMENT_CONFIG.entryFee} дуб.`), { reply_markup: backKeyboard() });
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
    bot.sendMessage(id, formatMessage('ТУРНИР', '✅ Ты зарегистрирован в турнире!'), { reply_markup: tournamentKeyboard() });
    return;
  }

  if (data === 'tournament_leaderboard') {
    if (tournaments.results.length === 0) {
      bot.sendMessage(id, formatMessage('ТУРНИР', '📋 Пока нет результатов.'), { reply_markup: backKeyboard() });
      return;
    }
    let msg = '🏆 ТАБЛИЦА ЛИДЕРОВ ТУРНИРА:\n\n';
    tournaments.results.slice(0, 10).forEach((pid, i) => {
      const player = players[pid];
      const balance = player?.demoMode ? safeNumber(player.demoBalance) : safeNumber(player?.balance) || 0;
      const name = player?.username || pid.toString().substr(-4);
      msg += `${i+1}. ${name} — ${balance} дуб.\n`;
    });
    bot.sendMessage(id, formatMessage('ТАБЛИЦА ЛИДЕРОВ', msg), {
      reply_markup: tournamentKeyboard()
    });
    return;
  }

  // ==================== ДУЭЛИ ====================
  if (data === 'duel_cancel') {
    if (duelChallenges[id]) {
      delete duelChallenges[id];
      if (p.activeDuelChallenges) {
        p.activeDuelChallenges = p.activeDuelChallenges.filter(c => c.from !== id);
      }
      saveData();
      bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ Вызов отменён.'), { reply_markup: mainInlineKeyboard() });
    } else {
      bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ У тебя нет активных вызовов.'), { reply_markup: backKeyboard() });
    }
    return;
  }

  if (data === 'duel_decline') {
    bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ Ты отказался от дуэли.'), { reply_markup: mainInlineKeyboard() });
    return;
  }

  if (data.startsWith('duel_accept_')) {
    const parts = data.split('_');
    const challengerId = parseInt(parts[2]);
    const amount = parseInt(parts[3]);

    if (isNaN(challengerId) || isNaN(amount)) {
      bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ Ошибка данных.'));
      return;
    }

    if (!duelChallenges[challengerId] || duelChallenges[challengerId].amount !== amount) {
      bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ Вызов уже неактивен или изменён.'));
      return;
    }

    if (challengerId === id) {
      bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ Нельзя принять свой вызов.'));
      return;
    }

    const challenger = players[challengerId];
    if (!challenger) {
      bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ Игрок не найден.'));
      delete duelChallenges[challengerId];
      return;
    }

    const challengerBalance = challenger.demoMode ? safeNumber(challenger.demoBalance) : safeNumber(challenger.balance);
    const playerBalance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);

    if (playerBalance < amount) {
      bot.sendMessage(id, formatMessage('ДУЭЛЬ', `❌ Не хватает. У тебя ${playerBalance} дуб.`));
      return;
    }

    if (challengerBalance < amount) {
      bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ У соперника не хватает средств.'));
      delete duelChallenges[challengerId];
      challenger.bet = 0;
      saveData();
      return;
    }

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

    bot.sendMessage(id, formatMessage('ДУЭЛЬ', '⚔️ ТЫ ПРИНЯЛ ВЫЗОВ!'));
    bot.sendMessage(challengerId, formatMessage('ДУЭЛЬ', `⚔️ @${p.username || id} принял твой вызов!`));

    processDuel(challengerId, id, amount);
    return;
  }

  // ==================== АДМИН-ПАНЕЛЬ ====================
  if (data === 'admin_dashboard') {
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

    bot.sendMessage(id, formatMessage('ДАШБОРД', msg), { reply_markup: backKeyboard() });
    return;
  }

  if (data === 'admin_help') {
    bot.sendMessage(id, formatMessage(
      '❓ АДМИН-ПАНЕЛЬ',
      '📊 Дашборд — общая статистика\n🏆 Ранги — редактирование рангов\n🛑 Блокировка — бан игроков\n💰 Банк — управление банком/джекпотом\n📢 Уведомления — рассылка\n📈 Статистика — монетизация\n🧹 Очистка — удаление неактивных\n🛠️ Техработы — обслуживание\n📋 Список игроков — все ID\n📊 Игрок — статистика игрока\n\n📌 Для ввода данных используй обычный текст.'
    ), { reply_markup: backKeyboard() });
    return;
  }

  if (data === 'admin_players') {
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
    bot.sendMessage(id, formatMessage('СПИСОК ИГРОКОВ', msg), { reply_markup: backKeyboard() });
    return;
  }

  if (data === 'admin_player_stats') {
    bot.sendMessage(id, formatMessage('СТАТИСТИКА ИГРОКА', '📊 Введи ID игрока:'), { reply_markup: backKeyboard() });
    adminState[id] = { action: 'player_stats' };
    return;
  }

  if (data === 'admin_block') {
    bot.sendMessage(id, formatMessage(
      '🛑 БЛОКИРОВКА',
      'Формат: ID время причина\nВремя: 1ч, 24ч, 7д\nПример: 123456789 24ч Спам\n\nДля разблокировки: разбан ID'
    ), { reply_markup: backKeyboard() });
    adminState[id] = { action: 'block' };
    return;
  }

  if (data === 'admin_bank') {
    bot.sendMessage(id, formatMessage(
      '💰 УПРАВЛЕНИЕ БАНКОМ',
      `💰 Банк: ${safeNumber(bank.pot)}\n🎰 Джекпот: ${safeNumber(bank.jackpot)}\n📊 Комиссия: ${safeNumber(bank.commission)}\n\nКоманды:\nпополнить банк СУММА\nсбросить джекпот\nмин банк СУММА\nистория банка`
    ), { reply_markup: backKeyboard() });
    adminState[id] = { action: 'bank' };
    return;
  }

  if (data === 'admin_notify') {
    bot.sendMessage(id, formatMessage(
      '📢 УВЕДОМЛЕНИЯ',
      'Формат: уведомление ТЕКСТ\nПример: уведомление Завтра в 20:00 турнир!\n\nШаблоны:\nтурнир — анонс турнира\nджекпот — анонс джекпота\nобновление — анонс обновления'
    ), { reply_markup: backKeyboard() });
    adminState[id] = { action: 'notify' };
    return;
  }

  if (data === 'admin_stats') {
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
      `📊 ВСЕГО:\n💵 Пополнений: ${totalDeposits} дуб.\n💸 Выводов: ${totalWithdrawals} дуб.\n📈 Комиссия: ${safeNumber(bank.commission)} дуб.\n\n` +
      `📊 СЕГОДНЯ:\n💵 Пополнений: ${todayDeposits} дуб.\n💸 Выводов: ${todayWithdrawals} дуб.\n\n🏆 ТОП-5 ПО ПОПОЛНЕНИЯМ:\n`;

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

    bot.sendMessage(id, formatMessage('СТАТИСТИКА', msg), { reply_markup: backKeyboard() });
    return;
  }

  if (data === 'admin_cleanup') {
    bot.sendMessage(id, formatMessage(
      '🧹 ОЧИСТКА ДАННЫХ',
      'Команды:\nочистить историю — удалить историю всех игроков\nудалить нулевых — удалить игроков с балансом 0\nархивировать — архивировать неактивных (>30 дней)'
    ), { reply_markup: backKeyboard() });
    adminState[id] = { action: 'cleanup' };
    return;
  }

  if (data === 'admin_maintenance') {
    bot.sendMessage(id, formatMessage(
      '🛠️ ТЕХНИЧЕСКИЕ РАБОТЫ',
      `⏳ Статус: ${maintenanceMode ? 'АКТИВНЫ' : 'НЕ АКТИВНЫ'}\n${maintenanceMode ? `⏳ До конца: ${Math.max(0, Math.ceil((maintenanceEndTime - Date.now()) / 60000))} мин.` : ''}\n\nКоманды:\nвключить работы ЧАСЫ СООБЩЕНИЕ\nвыключить работы`
    ), { reply_markup: backKeyboard() });
    adminState[id] = { action: 'maintenance' };
    return;
  }

  if (data === 'admin_ranks') {
    let msg = '🏆 РЕДАКТОР РАНГОВ\n\n';
    for (let i = 0; i < RANKS.length; i++) {
      const r = RANKS[i];
      msg += `${i}. ${r.emoji} ${r.name}: ${r.costDublons} дуб., бонус ${r.bonus}%, пассив ${r.passive}/час\n`;
    }
    msg += `\nФормат: ранг ИНДЕКС цена бонус пассив\nПример: ранг 2 500 15 8`;
    bot.sendMessage(id, formatMessage('РЕДАКТОР РАНГОВ', msg), { reply_markup: backKeyboard() });
    adminState[id] = { action: 'edit_ranks' };
    return;
  }

  // ==================== ПИРАТСКИЙ ФЛОТ ====================
  if (data === 'menu_fleet') {
    const p = getPlayer(id);
    let msg = '🚢 ПИРАТСКИЙ ФЛОТ\n\n';
    if (!p.fleet || p.fleet.ships.length === 0) {
      msg += 'У тебя пока нет кораблей. Купи первый!\n\n';
    } else {
      msg += `🛳️ Кораблей: ${p.fleet.ships.length}\n`;
      msg += `💰 Доход: ${p.fleet.totalIncome || 0} дуб./час\n\n`;
      p.fleet.ships.forEach(s => {
        const ship = SHIPS.find(sh => sh.id === s.id);
        if (ship) {
          msg += `${ship.emoji} ${ship.name} (ур.${s.level}) — ${getShipIncome({...ship, level: s.level})} дуб./час\n`;
        }
      });
    }
    bot.sendMessage(id, formatMessage('ПИРАТСКИЙ ФЛОТ', msg), {
      reply_markup: fleetKeyboard()
    });
    return;
  }

  if (data.startsWith('fleet_buy_')) {
    const shipId = parseInt(data.split('_')[2]);
    if (isNaN(shipId)) {
      bot.sendMessage(id, formatMessage('ФЛОТ', '❌ Ошибка ID корабля.'));
      return;
    }

    const ship = SHIPS.find(s => s.id === shipId);
    if (!ship) {
      bot.sendMessage(id, formatMessage('ФЛОТ', '❌ Корабль не найден.'));
      return;
    }

    if (!p.fleet) {
      p.fleet = { ships: [], totalIncome: 0, lastCollected: Date.now() };
    }

    if (p.fleet.ships.some(s => s.id === shipId)) {
      bot.sendMessage(id, formatMessage('ФЛОТ', `❌ Корабль "${ship.name}" уже куплен!`));
      return;
    }

    const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    if (balance < ship.cost) {
      bot.sendMessage(id, formatMessage('ФЛОТ', `❌ Не хватает дублонов! Нужно ${ship.cost}, у тебя ${balance}.`));
      return;
    }

    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) - ship.cost;
    } else {
      p.balance = safeNumber(p.balance) - ship.cost;
    }

    p.fleet.ships.push({ id: shipId, level: 0 });
    p.fleet.totalIncome = calculateTotalIncome(p);

    addHistory(id, `🚢 Купил корабль "${ship.name}" за ${ship.cost} дуб.`);
    addBalanceHistory(id, -ship.cost, `Покупка корабля ${ship.name}`);
    saveData();

    bot.sendMessage(id,
      formatMessage(
        '✅ ПОЗДРАВЛЯЮ!',
        `Ты купил корабль "${ship.name}"!\n\n💰 Стоимость: ${ship.cost} дуб.\n💨 Доход: ${ship.income} дуб./час\n📊 Твой баланс: ${balance - ship.cost} дуб.\n\n⏳ Доход будет начисляться каждый час. Не забывай собирать!`
      ),
      mainInlineKeyboard()
    );
    return;
  }

  // ==================== БРОСОК В КЛАССИКЕ ====================
  if (data.startsWith('roll_classic_')) {
    const amount = parseInt(data.split('_')[2]);
    if (isNaN(amount)) {
      bot.sendMessage(id, formatMessage('КЛАССИКА', '❌ Ошибка суммы.'));
      return;
    }

    if (!p.tempBet || p.tempBet !== amount) {
      bot.sendMessage(id, formatMessage('КЛАССИКА', '❌ Ставка не найдена. Начни заново.'));
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

    bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
    await sleep(CONFIG.ANIMATION_DELAY);

    let winAmount = 0;
    let isWin = false;
    let isPoint = false;

    if (playerDice === playerDice2) {
      isPoint = true;
      p.point = playerSum;
      p.pointBet = amount;
      p.pointMultiplier = 1;

      saveData();

      bot.sendMessage(id, formatMessage(
        '🎯 ТОЧКА!',
        `${playerDice}+${playerDice2}=${playerSum} очков!\n\n💰 Ставка: ${amount} дуб.\n🎯 Множитель: x1\n\nВыбери действие:`
      ), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💵 Удвоить (x2)', callback_data: `point_double_${amount}` }],
            [{ text: '💰 Забрать', callback_data: `point_take_${amount}` }],
            [{ text: '🔙 В меню', callback_data: 'menu_main' }]
          ]
        }
      });
      return;
    }

    if (playerSum > bankSum) {
      winAmount = amount * 2;
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
    } else if (playerSum < bankSum) {
      winAmount = 0;
      p.losses++;
      addHistory(id, `Классика: поражение -${amount} (${playerSum} vs ${bankSum})`);
      addBalanceHistory(id, -amount, 'Классика поражение');
    } else {
      if (p.demoMode) {
        p.demoBalance = safeNumber(p.demoBalance) + amount;
      } else {
        p.balance = safeNumber(p.balance) + amount;
      }
      winAmount = amount;
      addHistory(id, `Классика: ничья (${playerSum} vs ${bankSum})`);
      bot.sendMessage(id, formatMessage('КЛАССИКА', '🤝 Ничья! Возврат ставки.'));
    }

    p.games++;
    const balanceAfter = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
    checkJackpotBonus(id, amount, isWin);
    saveData();

    const target = getJackpotTarget();
    const bar = getJackpotBar();

    const resultMsg = `🎲 РЕЗУЛЬТАТ:\n\n` +
      `Ты: ${playerDice}+${playerDice2}=${playerSum}\n` +
      `Банк: ${bankDice}+${bankDice2}=${bankSum}\n\n` +
      `${playerSum > bankSum ? '✅ Ты выиграл!' : playerSum < bankSum ? '❌ Ты проиграл!' : '🤝 Ничья!'}\n` +
      `${winAmount > 0 ? `💰 +${winAmount}` : ''} дуб.\n` +
      `📊 Баланс: ${balanceAfter} дуб.\n\n` +
      `🎯 Джекпот: ${bank.jackpot} дуб.\n` +
      `📊 ${jackpotCounter}/${target}\n` +
      `🟩 ${bar}`;

    bot.sendMessage(id, formatMessage('КЛАССИКА РЕЗУЛЬТАТ', resultMsg), {
      reply_markup: resultKeyboard()
    });

    p.currentMode = null;
    delete p.tempBet;
    saveData();
    return;
  }

  // ==================== ТОЧКА: ЗАБРАТЬ ====================
  if (data.startsWith('point_take_')) {
    const amount = parseInt(data.split('_')[2]);
    if (isNaN(amount)) {
      bot.sendMessage(id, formatMessage('ТОЧКА', '❌ Ошибка суммы.'));
      return;
    }

    if (!p.point || !p.pointBet || p.pointBet !== amount) {
      bot.sendMessage(id, formatMessage('ТОЧКА', '❌ Точка не найдена. Начни игру заново.'));
      return;
    }

    const winAmount = amount * p.pointMultiplier * CONFIG.POINT_MULTIPLIER;

    if (p.demoMode) {
      p.demoBalance = safeNumber(p.demoBalance) + winAmount;
    } else {
      p.balance = safeNumber(p.balance) + winAmount;
    }
    p.wins++;
    p.totalEarned = safeNumber(p.totalEarned) + winAmount;
    addHistory(id, `Точка: забрал +${winAmount} (x${p.pointMultiplier})`);
    addBalanceHistory(id, winAmount, 'Точка: забрал');

    checkAchievements(id);

    const balanceAfter = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);

    bot.sendMessage(id, formatMessage(
      '💰 ТЫ ЗАБРАЛ!',
      `🎯 Точка: ${p.point} очков\n💰 Выигрыш: ${winAmount} дуб. (x${p.pointMultiplier})\n📊 Баланс: ${balanceAfter} дуб.`
    ), {
      reply_markup: resultKeyboard()
    });

    p.currentMode = null;
    delete p.point;
    delete p.pointBet;
    delete p.pointMultiplier;
    saveData();
    return;
  }

  // ==================== ТОЧКА: УДВОИТЬ ====================
  if (data.startsWith('point_double_')) {
    const amount = parseInt(data.split('_')[2]);
    if (isNaN(amount)) {
      bot.sendMessage(id, formatMessage('ТОЧКА', '❌ Ошибка суммы.'));
      return;
    }

    if (!p.point || !p.pointBet || p.pointBet !== amount) {
      bot.sendMessage(id, formatMessage('ТОЧКА', '❌ Точка не найдена. Начни игру заново.'));
      return;
    }

    p.pointMultiplier = (p.pointMultiplier || 1) + 1;

    const playerDice = Math.floor(Math.random() * 6) + 1;
    const playerDice2 = Math.floor(Math.random() * 6) + 1;
    const playerSum = playerDice + playerDice2;

    bot.sendDice(id, { emoji: '🎲' }).catch(() => {});
    await sleep(CONFIG.ANIMATION_DELAY);

    if (playerDice === playerDice2) {
      p.point = playerSum;
      saveData();

      bot.sendMessage(id, formatMessage(
        '🎯 НОВАЯ ТОЧКА!',
        `${playerDice}+${playerDice2}=${playerSum} очков!\n\n💰 Ставка: ${amount} дуб.\n🎯 Множитель: x${p.pointMultiplier}\n\nВыбери действие:`
      ), {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💵 Удвоить (x' + (p.pointMultiplier + 1) + ')', callback_data: `point_double_${amount}` }],
            [{ text: '💰 Забрать', callback_data: `point_take_${amount}` }],
            [{ text: '🔙 В меню', callback_data: 'menu_main' }]
          ]
        }
      });
      return;
    } else {
      addHistory(id, `Точка: удвоение провалилось (${playerDice}+${playerDice2}=${playerSum})`);
      addBalanceHistory(id, -amount * p.pointMultiplier, 'Точка: удвоение провал');

      bot.sendMessage(id, formatMessage(
        '💀 УДВОЕНИЕ ПРОВАЛИЛОСЬ!',
        `🎲 Выпало: ${playerDice}+${playerDice2}=${playerSum}\n💸 Ты теряешь ${amount * p.pointMultiplier} дуб.`
      ), {
        reply_markup: resultKeyboard()
      });

      p.currentMode = null;
      delete p.point;
      delete p.pointBet;
      delete p.pointMultiplier;
      saveData();
      return;
    }
  }
});

// ==================== ОБРАБОТЧИК ТЕКСТОВЫХ СООБЩЕНИЙ ====================
bot.on('message', async (msg) => {
  // ⚡ Игнорируем стикеры, чтобы не спамить меню
  if (msg.sticker) {
    return;
  }

  const id = msg.chat.id;
  const text = msg.text || '';

  if (text.startsWith('/')) return;

  const p = getPlayer(id);
  if (!p) return;

  if (p.balance < 0) p.balance = 0;
  if (p.demoBalance < 0) p.demoBalance = 0;

  if (isBanned(id)) {
    const info = getBanInfo(id);
    const timeLeft = Math.ceil((info.until - Date.now()) / 60000);
    bot.sendMessage(id, formatMessage('БЛОКИРОВКА', `⛔ Ты заблокирован!\nПричина: ${info.reason || 'Нарушение правил'}\nОсталось: ${timeLeft} мин.`));
    return;
  }

  if (isMaintenanceActive() && id !== ADMIN_ID) {
    const timeLeft = Math.max(0, Math.ceil((maintenanceEndTime - Date.now()) / 60000));
    bot.sendMessage(id, formatMessage(
      'ТЕХНИЧЕСКИЕ РАБОТЫ',
      `${maintenanceMessage}\n⏳ Осталось примерно: ${timeLeft} минут`
    ));
    return;
  }

  // ==================== АДМИН-КОМАНДЫ ====================
  if (id === ADMIN_ID) {
    if (text.startsWith('уведомление ')) {
      const message = text.replace('уведомление ', '');
      let sent = 0;
      for (let pid in players) {
        try {
          await bot.sendMessage(pid, formatMessage('📢 УВЕДОМЛЕНИЕ ОТ АДМИНА', message));
          sent++;
          await sleep(100);
        } catch (e) {}
      }
      bot.sendMessage(id, formatMessage('УВЕДОМЛЕНИЕ', `✅ Уведомление отправлено ${sent} игрокам.`));
      delete adminState?.[id];
      return;
    }

    if (text.startsWith('пополнить банк ')) {
      const amount = parseInt(text.split(' ')[2]);
      if (isNaN(amount)) return bot.sendMessage(id, formatMessage('БАНК', '❌ Неверная сумма.'));
      bank.pot = safeNumber(bank.pot) + amount;
      saveData();
      bot.sendMessage(id, formatMessage('БАНК', `✅ Банк пополнен на ${amount} дуб. Теперь: ${safeNumber(bank.pot)}`));
      delete adminState?.[id];
      return;
    }

    if (text === 'сбросить джекпот') {
      bank.jackpot = 0;
      jackpotCounter = 0;
      saveData();
      bot.sendMessage(id, formatMessage('БАНК', '✅ Джекпот сброшен.'));
      delete adminState?.[id];
      return;
    }

    if (text.startsWith('ранг ')) {
      const parts = text.split(' ');
      if (parts.length < 5) return bot.sendMessage(id, formatMessage('РАНГИ', '❌ Формат: ранг ИНДЕКС цена бонус пассив'));
      const idx = parseInt(parts[1]);
      const cost = parseInt(parts[2]);
      const bonus = parseInt(parts[3]);
      const passive = parseInt(parts[4]);
      if (isNaN(idx) || isNaN(cost) || isNaN(bonus) || isNaN(passive)) {
        return bot.sendMessage(id, formatMessage('РАНГИ', '❌ Неверные числа.'));
      }
      if (idx < 0 || idx >= RANKS.length) return bot.sendMessage(id, formatMessage('РАНГИ', '❌ Неверный индекс.'));
      RANKS[idx].costDublons = cost;
      RANKS[idx].bonus = bonus;
      RANKS[idx].passive = passive;
      saveData();
      bot.sendMessage(id, formatMessage('РАНГИ', `✅ Ранг ${RANKS[idx].name} обновлён: цена ${cost}, бонус ${bonus}%, пассив ${passive}/час`));
      delete adminState?.[id];
      return;
    }

    if (text.startsWith('разбан ')) {
      const targetId = parseInt(text.split(' ')[1]);
      if (isNaN(targetId)) return bot.sendMessage(id, formatMessage('БАН', '❌ Неверный ID.'));
      if (bans[targetId]) {
        delete bans[targetId];
        bot.sendMessage(id, formatMessage('БАН', `✅ Игрок ${targetId} разблокирован.`));
        bot.sendMessage(targetId, formatMessage('БАН', '👑 Ты разблокирован!'));
      } else {
        bot.sendMessage(id, formatMessage('БАН', '❌ Игрок не заблокирован.'));
      }
      delete adminState?.[id];
      return;
    }

    if (text.startsWith('включить работы ')) {
      const parts = text.split(' ');
      const hours = parseInt(parts[2]);
      const message = parts.slice(3).join(' ');
      if (isNaN(hours) || hours < 1) return bot.sendMessage(id, formatMessage('ТЕХРАБОТЫ', '❌ Укажи часы.'));
      enableMaintenance(message || 'Технические работы', hours);
      bot.sendMessage(id, formatMessage('ТЕХРАБОТЫ', `✅ Техработы включены на ${hours} час(ов).`));
      delete adminState?.[id];
      return;
    }

    if (text === 'выключить работы') {
      maintenanceMode = false;
      maintenanceMessage = '';
      maintenanceEndTime = 0;
      bot.sendMessage(id, formatMessage('ТЕХРАБОТЫ', '✅ Техработы выключены.'));
      delete adminState?.[id];
      return;
    }
  }

  const amount = parseInt(text);

  if (!isNaN(amount) && amount >= 1) {
    if (blackjackGames[id] && blackjackGames[id].status !== 'finished' && blackjackGames[id].status !== 'waiting') {
      bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', '❌ Сначала заверши текущую игру в блэкджек!'));
      return;
    }

    if (!p.currentMode) {
      bot.sendMessage(id, formatMessage('ИГРА', '❌ Сначала выбери режим игры! Нажми "🎰 Играть"'), { reply_markup: backKeyboard() });
      return;
    }

    if (!bank.roundActive) {
      bot.sendMessage(id, formatMessage('ИГРА', '⏳ Раунд не активен, подожди...'), { reply_markup: backKeyboard() });
      return;
    }

    checkActivityBonus(p, id);

    if (p.currentMode === 'classic') {
      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, formatMessage('КЛАССИКА', `❌ Не хватает. У тебя ${balance} дуб.`), { reply_markup: backKeyboard() });
        return;
      }

      if (p.demoMode) {
        if (p.demoRollsToday >= 20) {
          bot.sendMessage(id, formatMessage('КЛАССИКА', '❌ Лимит демо-бросков (20) исчерпан! Включи основной режим.'), { reply_markup: backKeyboard() });
          return;
        }
        p.demoRollsToday++;
      }

      p.tempBet = amount;

      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 Бросок', callback_data: `roll_classic_${amount}` }],
            [{ text: '🔙 Назад', callback_data: 'menu_main' }]
          ]
        }
      };
      bot.sendMessage(id, formatMessage('🎲 КЛАССИКА', `Ставка ${amount} дуб. принята. Нажми «Бросок», чтобы начать.`), keyboard);
      return;
    }

    if (p.currentMode === 'duel') {
      if (amount < MIN_DUEL_MONEY || amount > MAX_DUEL_MONEY) {
        bot.sendMessage(id, formatMessage('ДУЭЛЬ', `❌ Ставка от ${MIN_DUEL_MONEY} до ${MAX_DUEL_MONEY} дуб.`), { reply_markup: backKeyboard() });
        return;
      }

      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, formatMessage('ДУЭЛЬ', `❌ Не хватает. У тебя ${balance} дуб.`), { reply_markup: backKeyboard() });
        return;
      }

      if (duelChallenges[id]) {
        bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ У тебя уже есть активный вызов. Отмени его или дождись ответа.'), {
          reply_markup: duelCancelKeyboard()
        });
        return;
      }

      const success = createDuelChallenge(id, amount);
      if (!success) {
        bot.sendMessage(id, formatMessage('ДУЭЛЬ', '❌ Не удалось создать вызов.'), { reply_markup: backKeyboard() });
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
            formatMessage(
              '⚔️ НОВЫЙ ВЫЗОВ НА ДУЭЛЬ!',
              `Игрок: @${username}\nСтавка: ${amount} дуб.\nТвой баланс: ${targetBalance} дуб.\n\nХочешь принять вызов?`
            ),
            {
              reply_markup: duelAcceptKeyboard(amount, id)
            }
          );
          sentCount++;
        }
      }

      bot.sendMessage(id, formatMessage('ДУЭЛЬ', `⚔️ Вызов отправлен ${sentCount} игрокам. Ожидай ответа...`), {
        reply_markup: duelCancelKeyboard()
      });
      return;
    }

    if (p.currentMode === 'vip') {
      if (p.demoMode) {
        bot.sendMessage(id, formatMessage('VIP', '❌ VIP-игра недоступна в демо-режиме.'), { reply_markup: backKeyboard() });
        return;
      }

      if (amount < MIN_VIP_BET || amount > MAX_VIP_BET) {
        bot.sendMessage(id, formatMessage('VIP', `❌ Ставка от ${MIN_VIP_BET} до ${MAX_VIP_BET} дуб.`), { reply_markup: backKeyboard() });
        return;
      }

      const balance = safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, formatMessage('VIP', `❌ Не хватает. У тебя ${balance} дуб.`), { reply_markup: backKeyboard() });
        return;
      }

      p.balance = safeNumber(p.balance) - amount;

      const playerDice = Math.floor(Math.random() * 6) + 1;
      const playerDice2 = Math.floor(Math.random() * 6) + 1;
      const playerSum = playerDice + playerDice2;

      const adminDice = Math.floor(Math.random() * 6) + 1;
      const adminDice2 = Math.floor(Math.random() * 6) + 1;
      const adminSum = adminDice + adminDice2;

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
        bot.sendMessage(id, formatMessage('VIP', '🤝 Ничья! Возврат ставки.'));
      }

      p.games++;
      const balanceAfter = safeNumber(p.balance);

      const resultMsg = `👑 VIP РЕЗУЛЬТАТ:\n\n` +
        `Ты: ${playerDice}+${playerDice2}=${playerSum}\n` +
        `Админ: ${adminDice}+${adminDice2}=${adminSum}\n\n` +
        `${playerSum > adminSum ? '✅ Ты выиграл!' : playerSum < adminSum ? '❌ Ты проиграл!' : '🤝 Ничья!'}\n` +
        `${winAmount > 0 ? `💰 +${winAmount}` : ''} дуб.\n` +
        `📊 Баланс: ${balanceAfter} дуб.`;

      bot.sendMessage(id, formatMessage('VIP РЕЗУЛЬТАТ', resultMsg), {
       reply_markup: resultKeyboard()
     });

     p.currentMode = null;
     delete p.tempBet;
     saveData();
     return;
    }

    if (p.currentMode === 'blackjack') {
      if (amount < BLACKJACK_CONFIG.minBet || amount > BLACKJACK_CONFIG.maxBet) {
        bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', `❌ Ставка от ${BLACKJACK_CONFIG.minBet} до ${BLACKJACK_CONFIG.maxBet} дуб.`), { reply_markup: backKeyboard() });
        return;
      }

      const balance = p.demoMode ? safeNumber(p.demoBalance) : safeNumber(p.balance);
      if (balance < amount) {
        bot.sendMessage(id, formatMessage('БЛЭКДЖЕК', `❌ Не хватает. У тебя ${balance} дуб.`), { reply_markup: backKeyboard() });
        return;
      }

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

      bot.sendMessage(id, formatMessage('БЛЭКДЖЕК НАЧАЛО', startMsg), {
        reply_markup: blackjackKeyboard()
      });
      startBlackjackTimeout(id);
      saveData();
      return;
    }
  }

  if (!text.startsWith('/')) {
    bot.sendMessage(id, formatMessage('🏴‍☠️ ЧЁРНАЯ КОСТЬ', 'Главное меню:'), {
      reply_markup: mainInlineKeyboard()
    });
  }
});

// ==================== ОБРАБОТЧИК ЗАВЕРШЕНИЯ БЛЭКДЖЕКА ====================
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

  bot.sendMessage(playerId, formatMessage('БЛЭКДЖЕК РЕЗУЛЬТАТ', msg), blackjackResultKeyboard());
  delete blackjackGames[playerId];
}

function startBlackjackTimeout(playerId) {
  setTimeout(() => {
    if (blackjackGames[playerId] && blackjackGames[playerId].status === 'playing') {
      bot.sendMessage(playerId, formatMessage('БЛЭКДЖЕК', '⏳ Время вышло! Игра завершена.'));
      finishBlackjack(playerId);
    }
  }, CONFIG.BLACKJACK_TIMEOUT || 60000);
}

// ==================== ЛИМИТ СТАВОК ====================
const MAX_LIMIT_UPGRADES = 50;
const LIMIT_UPGRADE_COST = 5000;
const MAX_CLASSIC_BET = 10000;

const CONFIG = {
  ANIMATION_DELAY: 500,
  MAX_DUEL_ROUNDS: 5,
  POINT_MULTIPLIER: 2,
  BLACKJACK_TIMEOUT: 60000,
};

// ==================== ВРЕМЕННЫЙ ОБРАБОТЧИК ДЛЯ СБОРА ID СТИКЕРОВ ====================
bot.on('sticker', (msg) => {
  const id = msg.chat.id;
  const fileId = msg.sticker.file_id;
  bot.sendMessage(id, formatMessage(
    '📦 ID СТИКЕРА',
    `\`${fileId}\``,
    'Скопируй этот ID и сохрани его в блокнот. Затем удали этот обработчик.'
  ), { parse_mode: 'Markdown' });
});

// ==================== KEEP-ALIVE ВЕБ-СЕРВЕР ====================
const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
  res.send('🏴‍☠️ Бот работает');
});

app.listen(PORT, () => {
  console.log(`🌐 Keep-alive сервер запущен на порту ${PORT}`);
});

// ==================== ЗАПУСК БОТА ====================
bot.startPolling({
  interval: 300,
  autoStart: true,
  params: {
    timeout: 10
  }
}).catch(err => {
  console.log('⚠️ Ошибка запуска polling:', err.message);
});

// ==================== ОБРАБОТКА ОШИБОК ====================
process.on('uncaughtException', (err) => {
  console.error('❌ Необработанная ошибка:', err);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Необработанный rejection:', reason);
});

// ==================== ЗАПУСК ВСЕХ СИСТЕМ ====================
loadData();

if (safeNumber(bank.pot) < 1000 && safeNumber(bank.commission) > 0) {
  const refill = Math.min(safeNumber(bank.commission), 500);
  bank.pot = safeNumber(bank.pot) + refill;
  bank.commission = safeNumber(bank.commission) - refill;
  console.log(`🔄 Банк пополнен на ${refill} из комиссии.`);
  saveData();
}

startRound();
scheduleTournament();
setTimeout(scheduleRandomEvent, 60000);
setInterval(autoCleanup, 6 * 3600000);

checkWorkHours();
setInterval(checkWorkHours, 300000);

bot.setMyCommands([
  { command: 'menu', description: 'Главное меню' },
  { command: 'start', description: 'Запустить бота' },
  { command: 'history', description: 'История операций' },
  { command: 'resetdemo', description: 'Сброс демо-баланса' },
]);

bot.onText(/\/menu/, (msg) => {
  const id = msg.chat.id;
  const p = getPlayer(id);
  if (!p) return;
  bot.sendMessage(id, formatMessage('🏴‍☠️ ЧЁРНАЯ КОСТЬ', 'Главное меню'), {
    reply_markup: mainInlineKeyboard()
  });
});

console.log('🏴‍☠️ ЧЁРНАЯ КОСТЬ v9.0 ЗАПУЩЕНА');
console.log(`👥 Игроков: ${Object.keys(players).length}`);
console.log(`💰 Банк: ${safeNumber(bank.pot)}, Джекпот: ${safeNumber(bank.jackpot)}`);
console.log('✅ ВРЕМЕННЫЙ ОБРАБОТЧИК СТИКЕРОВ АКТИВЕН');
console.log('📦 Отправь стикер боту, чтобы получить его ID');

saveData();
