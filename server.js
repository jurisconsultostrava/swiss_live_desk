const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const GOLDAPI_KEY = process.env.GOLDAPI_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me';
const pool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : undefined }) : null;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEMO_PRICES = {
  AU: { USD: 4325.10, EUR: 4018.80, CHF: 3775.40, CZK: 98120.00 },
  AG: { USD: 58.20, EUR: 54.15, CHF: 50.82, CZK: 1320.00 },
  PT: { USD: 1680.00, EUR: 1561.00, CHF: 1467.50, CZK: 38120.00 },
  PD: { USD: 1620.00, EUR: 1505.30, CHF: 1412.00, CZK: 36780.00 }
};
const SYMBOLS = { AU: 'XAU', AG: 'XAG', PT: 'XPT', PD: 'XPD' };
const CURRENCIES = ['USD','EUR','CHF','CZK'];
const MARKETS = [
  { key:'AUXZU', metal:'AU', location:'Curych', currencies:['USD','EUR','CHF','CZK'] },
  { key:'AUXLN', metal:'AU', location:'Londýn', currencies:['USD','EUR','CHF'] },
  { key:'AUXPRG', metal:'AU', location:'Praha', currencies:['CZK','EUR'] },
  { key:'AUXDE', metal:'AU', location:'Frankfurt', currencies:['EUR','CHF'] },
  { key:'AGXZU', metal:'AG', location:'Curych', currencies:['USD','EUR','CHF'] },
  { key:'AGXPRG', metal:'AG', location:'Praha', currencies:['CZK','EUR'] },
  { key:'PTXLN', metal:'PT', location:'Londýn', currencies:['USD','EUR'] },
  { key:'PDXLN', metal:'PD', location:'Londýn', currencies:['USD','EUR'] }
];
const SPREAD_BPS = { AU:55, AG:180, PT:120, PD:160 };
const LOCATION_BPS = { Praha:35, Curych:10, Londýn:15, Frankfurt:20 };

function requireDb() {
  if (!pool) {
    const err = new Error('DATABASE_URL není nastaven. Na Railway přidejte PostgreSQL service.');
    err.status = 503;
    throw err;
  }
  return pool;
}

async function q(sql, params = []) {
  return requireDb().query(sql, params);
}

async function ensureSchema() {
  if (!pool) return;
  const schema = fs.readFileSync(path.join(__dirname, 'sql', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await seedDemoData();
}

async function seedDemoData() {
  if (!pool) return;
  const userRes = await pool.query(`
    insert into app_users(external_ref, email, username, full_name, role, kyc_status)
    values ('demo', 'client@demo.local', 'DEMOUSER', 'Demo klient', 'client', 'verified')
    on conflict (external_ref) do update set updated_at = now()
    returning id
  `);
  const userId = userRes.rows[0].id;
  await pool.query(`
    insert into account_settings(user_id, valuation_currency, timezone, language)
    values ($1,'CZK','Europe/Prague','cs')
    on conflict (user_id) do nothing
  `, [userId]);
  const cash = [['CZK',750000],['EUR',5000],['USD',1200],['CHF',800]];
  for (const [currency, amount] of cash) {
    await pool.query(`insert into client_cash_balances(user_id,currency,available) values($1,$2,$3) on conflict(user_id,currency) do nothing`, [userId,currency,amount]);
  }
  const holdings = [['AU','Curych',120.5],['AG','Curych',2500],['PT','Londýn',24.2],['PD','Londýn',10.1]];
  for (const [metal, location, grams] of holdings) {
    await pool.query(`insert into client_metal_holdings(user_id,metal,location,total_g) values($1,$2,$3,$4) on conflict(user_id,metal,location) do nothing`, [userId,metal,location,grams]);
  }
  const cards = [
    ['summary','summary','Souhrn účtu',10],
    ['bullion_au','holding','Zlato',20],
    ['bullion_ag','holding','Stříbro',30],
    ['bullion_pt','holding','Platina',40],
    ['bullion_pd','holding','Palladium',50],
    ['currency','cash','Měnové zůstatky',60],
    ['trading_options','settings','Obchodní možnosti',70],
    ['security_options','settings','Bezpečnostní nastavení',80],
    ['communication_preferences','settings','Komunikační preference',90],
    ['auto_invest','settings','Auto-Invest',100]
  ];
  for (const [key,type,title,sort] of cards) {
    await pool.query(`insert into account_cards(user_id,card_key,card_type,title_cs,sort_order) values($1,$2,$3,$4,$5) on conflict(user_id,card_key) do nothing`, [userId,key,type,title,sort]);
  }
}

async function fetchLivePrices() {
  if (!GOLDAPI_KEY) return { mode:'demo', prices:DEMO_PRICES, warning:'GOLDAPI_KEY chybí' };
  const prices = {};
  try {
    for (const [metal, symbol] of Object.entries(SYMBOLS)) {
      prices[metal] = {};
      for (const currency of CURRENCIES) {
        const res = await fetch(`https://www.goldapi.io/api/${symbol}/${currency}`, { headers: { 'x-access-token': GOLDAPI_KEY, 'Content-Type':'application/json' } });
        if (!res.ok) throw new Error(`${symbol}/${currency}: HTTP ${res.status}`);
        const data = await res.json();
        const value = Number(data.price);
        if (!Number.isFinite(value) || value <= 0) throw new Error(`${symbol}/${currency}: neplatná cena`);
        prices[metal][currency] = value;
      }
    }
    return { mode:'live', prices };
  } catch (error) {
    return { mode:'demo', prices:DEMO_PRICES, warning:error.message };
  }
}

function deterministicFactor(str) {
  let h = 0; for (let i=0;i<str.length;i++) h = (h * 31 + str.charCodeAt(i)) % 997;
  return (h % 50) / 100;
}

function buildMarketSnapshots(prices, capturedAt = new Date()) {
  const rows = [];
  for (const market of MARKETS) {
    for (const currency of market.currencies) {
      const spot = Number(prices[market.metal]?.[currency] || DEMO_PRICES[market.metal][currency]);
      const spread = (SPREAD_BPS[market.metal] || 100) / 10000;
      const loc = (LOCATION_BPS[market.location] || 0) / 10000;
      const adjusted = spot * (1 + loc);
      const bid = adjusted * (1 - spread / 2);
      const offer = adjusted * (1 + spread / 2);
      const liquidityBase = { AU:82, AG:2400, PT:52, PD:38 }[market.metal] || 100;
      const bidQty = liquidityBase * (0.5 + deterministicFactor(market.key + currency));
      const offerQty = liquidityBase * (0.44 + deterministicFactor(currency + market.key));
      rows.push({
        marketKey: `${market.key}_${currency}`,
        metal: market.metal,
        location: market.location,
        currency,
        spotToz: spot,
        bestBidToz: bid,
        bestOfferToz: offer,
        spreadAbs: offer - bid,
        spreadPct: ((offer - bid) / bid) * 100,
        bidQuantityToz: bidQty,
        offerQuantityToz: offerQty,
        capturedAt
      });
    }
  }
  return rows;
}

async function persistPrices(payload) {
  if (!pool) return;
  const capturedAt = new Date();
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const metal of Object.keys(payload.prices)) {
      for (const currency of Object.keys(payload.prices[metal])) {
        await client.query(`insert into metal_price_snapshots(metal,currency,price_toz,source,captured_at) values($1,$2,$3,$4,$5)`, [metal,currency,payload.prices[metal][currency],payload.mode,capturedAt]);
      }
    }
    for (const row of buildMarketSnapshots(payload.prices, capturedAt)) {
      await client.query(`insert into market_spread_snapshots(market_key,metal,location,currency,spot_toz,best_bid_toz,best_offer_toz,spread_abs,spread_pct,bid_quantity_toz,offer_quantity_toz,captured_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [row.marketKey,row.metal,row.location,row.currency,row.spotToz,row.bestBidToz,row.bestOfferToz,row.spreadAbs,row.spreadPct,row.bidQuantityToz,row.offerQuantityToz,row.capturedAt]);
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
}

function generateSyntheticPriceHistory(metal, currency, days = 30) {
  const base = DEMO_PRICES[metal]?.[currency] || 100;
  const out = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const ts = new Date(now - i * 86400000);
    const drift = (days - i) * 0.001;
    const noise = (Math.sin(i * 1.91 + base) * 0.018);
    out.push({ capturedAt: ts.toISOString(), priceToz: Number((base * (1 + drift + noise)).toFixed(6)), source:'synthetic' });
  }
  return out;
}

function generateSyntheticSpreadHistory(marketKey, days = 30) {
  const out = [];
  const now = Date.now();
  const base = marketKey.includes('AG') ? 1.8 : marketKey.includes('PT') || marketKey.includes('PD') ? 1.25 : 0.55;
  for (let i = days - 1; i >= 0; i--) {
    const ts = new Date(now - i * 86400000);
    const value = Math.max(0.05, base + Math.sin(i * 1.37 + marketKey.length) * 0.16);
    out.push({ capturedAt: ts.toISOString(), spreadPct: Number(value.toFixed(6)), source:'synthetic' });
  }
  return out;
}

app.get('/api/health', async (_req, res) => res.json({ ok:true, db:Boolean(pool), time:new Date().toISOString() }));

app.get('/api/prices/latest', async (_req, res, next) => {
  try {
    const payload = await fetchLivePrices();
    await persistPrices(payload);
    res.json({ mode: payload.mode, timestamp: new Date().toISOString(), prices: payload.prices, warning: payload.warning });
  } catch (error) { next(error); }
});

app.get('/api/prices/history', async (req, res, next) => {
  try {
    const metal = String(req.query.metal || 'AU').toUpperCase();
    const currency = String(req.query.currency || 'CZK').toUpperCase();
    const days = Math.min(Number(req.query.days || 30), 365);
    if (!pool) return res.json({ metal, currency, history: generateSyntheticPriceHistory(metal, currency, days), mode:'memory' });
    const result = await pool.query(`select captured_at as "capturedAt", price_toz as "priceToz", source from metal_price_snapshots where metal=$1 and currency=$2 and captured_at >= now() - ($3 || ' days')::interval order by captured_at asc`, [metal,currency,days]);
    if (result.rows.length > 2) return res.json({ metal, currency, history: result.rows, mode:'db' });
    return res.json({ metal, currency, history: generateSyntheticPriceHistory(metal, currency, days), mode:'synthetic' });
  } catch (error) { next(error); }
});

app.get('/api/spreads/history', async (req, res, next) => {
  try {
    const marketKey = String(req.query.marketKey || 'AUXZU_CZK');
    const days = Math.min(Number(req.query.days || 30), 365);
    if (!pool) return res.json({ marketKey, history: generateSyntheticSpreadHistory(marketKey, days), mode:'memory' });
    const result = await pool.query(`select captured_at as "capturedAt", spread_pct as "spreadPct", spread_abs as "spreadAbs", best_bid_toz as "bestBidToz", best_offer_toz as "bestOfferToz" from market_spread_snapshots where market_key=$1 and captured_at >= now() - ($2 || ' days')::interval order by captured_at asc`, [marketKey,days]);
    if (result.rows.length > 2) return res.json({ marketKey, history: result.rows, mode:'db' });
    return res.json({ marketKey, history: generateSyntheticSpreadHistory(marketKey, days), mode:'synthetic' });
  } catch (error) { next(error); }
});

app.get('/api/accounts/:externalRef/cards', async (req, res, next) => {
  try {
    const externalRef = req.params.externalRef === 'demo' ? 'demo' : req.params.externalRef;
    if (!pool) return res.json({ user:{ externalRef:'demo', fullName:'Demo klient' }, cards: demoAccountCards() });
    const userRes = await pool.query(`select * from app_users where external_ref=$1 limit 1`, [externalRef]);
    if (!userRes.rows.length) return res.status(404).json({ error:'Uživatel nenalezen' });
    const user = userRes.rows[0];
    const cardsRes = await pool.query(`select * from account_cards where user_id=$1 and is_enabled=true order by sort_order asc`, [user.id]);
    const holdings = (await pool.query(`select * from client_metal_holdings where user_id=$1 order by metal, location`, [user.id])).rows;
    const cash = (await pool.query(`select * from client_cash_balances where user_id=$1 order by currency`, [user.id])).rows;
    const settings = (await pool.query(`select * from account_settings where user_id=$1`, [user.id])).rows[0] || {};
    const latest = DEMO_PRICES;
    const cards = cardsRes.rows.map(card => buildAccountCard(card, holdings, cash, settings, latest));
    res.json({ user:{ id:user.id, externalRef:user.external_ref, fullName:user.full_name, email:user.email, kycStatus:user.kyc_status }, cards });
  } catch (error) { next(error); }
});

function demoAccountCards() {
  const holdings = [
    { metal:'AU', location:'Curych', total_g:120.5 },
    { metal:'AG', location:'Curych', total_g:2500 },
    { metal:'PT', location:'Londýn', total_g:24.2 },
    { metal:'PD', location:'Londýn', total_g:10.1 }
  ];
  const cash = [{currency:'CZK',available:750000},{currency:'EUR',available:5000},{currency:'USD',available:1200},{currency:'CHF',available:800}];
  const settings = { valuation_currency:'CZK', timezone:'Europe/Prague', language:'cs', two_factor_status:'not_active', order_alerts_email:true, statements_delivery:'online_and_email', trading_silver_enabled:true, trading_platinum_enabled:true, trading_palladium_enabled:true };
  return [
    { card_key:'summary', card_type:'summary', title_cs:'Souhrn účtu' },
    { card_key:'bullion_au', card_type:'holding', title_cs:'Zlato' },
    { card_key:'bullion_ag', card_type:'holding', title_cs:'Stříbro' },
    { card_key:'bullion_pt', card_type:'holding', title_cs:'Platina' },
    { card_key:'bullion_pd', card_type:'holding', title_cs:'Palladium' },
    { card_key:'currency', card_type:'cash', title_cs:'Měnové zůstatky' },
    { card_key:'trading_options', card_type:'settings', title_cs:'Obchodní možnosti' },
    { card_key:'security_options', card_type:'settings', title_cs:'Bezpečnostní nastavení' }
  ].map(c => buildAccountCard(c, holdings, cash, settings, DEMO_PRICES));
}

function formatNumber(n, decimals = 2) { return Number(n || 0).toLocaleString('cs-CZ', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); }
function metalName(m) { return { AU:'Zlato', AG:'Stříbro', PT:'Platina', PD:'Palladium' }[m] || m; }
function valuationCzk(holdings, prices) { return holdings.reduce((sum,h) => sum + (Number(h.total_g) / 31.1034768) * Number(prices[h.metal]?.CZK || 0), 0); }
function buildAccountCard(card, holdings, cash, settings, prices) {
  const title = card.title_cs || card.titleCs || 'Karta';
  if (card.card_type === 'summary') {
    return { key: card.card_key, title, rows:[
      { label:'Ocenění kovů', value: formatNumber(valuationCzk(holdings, prices), 0) + ' Kč' },
      { label:'Peněžní zůstatky', value: cash.map(c => `${formatNumber(c.available, c.currency === 'CZK' ? 0 : 2)} ${c.currency}`).join(' · ') },
      { label:'Valuační měna', value: settings.valuation_currency || 'CZK' }
    ]};
  }
  if (card.card_type === 'holding') {
    const metal = card.card_key?.split('_')[1]?.toUpperCase();
    const rows = holdings.filter(h => h.metal === metal).map(h => ({ label: `${metalName(h.metal)} · ${h.location}`, value: `${formatNumber(h.total_g, 3)} g` }));
    const total = holdings.filter(h => h.metal === metal).reduce((s,h) => s + Number(h.total_g), 0);
    rows.push({ label:'Celkem v úschově', value: `${formatNumber(total, 3)} g` });
    return { key: card.card_key, title, rows };
  }
  if (card.card_type === 'cash') {
    return { key: card.card_key, title, rows: cash.map(c => ({ label:c.currency, value: `${formatNumber(c.available, c.currency === 'CZK' ? 0 : 2)} ${c.currency}` })) };
  }
  return { key: card.card_key, title, rows:[
    { label:'Jazyk', value: settings.language || 'cs' },
    { label:'Časové pásmo', value: settings.timezone || 'Europe/Prague' },
    { label:'Stříbro', value: settings.trading_silver_enabled ? 'Povoleno' : 'Vypnuto' },
    { label:'Platina', value: settings.trading_platinum_enabled ? 'Povoleno' : 'Vypnuto' },
    { label:'2FA', value: settings.two_factor_status === 'active' ? 'Aktivní' : 'Neaktivní' },
    { label:'Výpisy', value: settings.statements_delivery === 'online_and_email' ? 'Online a e-mailem' : 'Online' }
  ]};
}

app.get('/api/orders', async (req, res, next) => {
  try {
    if (!pool) return res.json({ orders:[] });
    const status = req.query.status;
    const where = status ? 'where o.status=$1' : '';
    const params = status ? [status] : [];
    const result = await pool.query(`select o.*, u.full_name from client_orders o left join app_users u on u.id=o.user_id ${where} order by o.created_at desc limit 200`, params);
    res.json({ orders: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/orders', async (req, res, next) => {
  try {
    const body = req.body || {};
    const externalRef = body.userId || 'demo';
    const gross = Number(body.quantity || 0) * Number(body.limitPrice || 0);
    const fee = gross * 0.005;
    const total = body.side === 'BUY' ? gross + fee : gross - fee;
    if (!pool) return res.json({ order:{ id:'LOCAL-' + Date.now(), status:'pending', ...body, grossValue:gross, feeValue:fee, totalValue:total }, mode:'memory' });
    const userRes = await pool.query(`select id from app_users where external_ref=$1 limit 1`, [externalRef]);
    const userId = userRes.rows[0]?.id || null;
    const result = await pool.query(`insert into client_orders(user_id,side,market_key,metal,location,currency,quantity,unit,limit_price,order_type,status,gross_value,fee_value,total_value)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`, [userId, body.side || 'BUY', body.marketKey || '', body.metal || 'AU', body.location || null, body.currency || 'CZK', Number(body.quantity || 0), body.unit || 'TOZ', Number(body.limitPrice || 0), body.orderType || 'TIL_CANCEL', body.status || 'pending', gross, fee, total]);
    res.status(201).json({ order: result.rows[0], mode:'db' });
  } catch (error) { next(error); }
});

app.patch('/api/orders/:id/status', async (req, res, next) => {
  try {
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return res.status(401).json({ error:'Neoprávněný přístup' });
    const status = req.body.status;
    const result = await q(`update client_orders set status=$1, updated_at=now() where id=$2 returning *`, [status, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error:'Pokyn nenalezen' });
    res.json({ order: result.rows[0] });
  } catch (error) { next(error); }
});

app.post('/api/admin/refresh-prices', async (req, res, next) => {
  try {
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) return res.status(401).json({ error:'Neoprávněný přístup' });
    const payload = await fetchLivePrices();
    await persistPrices(payload);
    res.json({ ok:true, mode:payload.mode, timestamp:new Date().toISOString(), warning:payload.warning });
  } catch (error) { next(error); }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

ensureSchema().then(() => {
  app.listen(PORT, () => console.log(`Swiss Gold Market Board běží na portu ${PORT}`));
}).catch(err => {
  console.error('Schema init failed', err);
  process.exit(1);
});
