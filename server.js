
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'swiss-live-desk.json');

const METAL_MAP = { XAU: 'AU', XAG: 'AG', XPT: 'PT', XPD: 'PD' };
const METAL_CODES = { AU: 'XAU', AG: 'XAG', PT: 'XPT', PD: 'XPD' };
const EMPTY_PRICES = {
  AU: { USD:null, EUR:null, CZK:null, CHF:null },
  AG: { USD:null, EUR:null, CZK:null, CHF:null },
  PT: { USD:null, EUR:null, CZK:null, CHF:null },
  PD: { USD:null, EUR:null, CZK:null, CHF:null }
};
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
const PREMIUM_BPS = { Praha:35, Curych:10, Londýn:15, Frankfurt:20 };

app.use(helmet({ contentSecurityPolicy:false }));
app.use(cors());
app.use(compression());
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname, 'public')));

function now(){ return new Date().toISOString(); }
function ensureDataFile(){
  fs.mkdirSync(DATA_DIR, { recursive:true });
  if(!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({latestPrices:null,priceHistory:[],spreadHistory:[],orders:[],users:[],accountCards:[],audit:[]}, null, 2));
}
function readDb(){ ensureDataFile(); return JSON.parse(fs.readFileSync(DB_FILE,'utf8')); }
function writeDb(db){ ensureDataFile(); fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
function listEnv(name, fallback){ return String(process.env[name] || fallback).split(',').map(x=>x.trim().toUpperCase()).filter(Boolean); }
function cacheFresh(db){
  const ttl = Number(process.env.PRICE_CACHE_TTL_MS || 300000);
  if(!db.latestPrices || !db.latestPrices.timestamp || !db.latestPrices.prices) return false;
  return (Date.now() - new Date(db.latestPrices.timestamp).getTime()) < ttl;
}
function timeoutSignal(ms){ const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),ms); return {signal:controller.signal, clear:()=>clearTimeout(timer)}; }
async function fetchJson(url, options={}, ms=12000){
  const t=timeoutSignal(ms);
  try{
    const response=await fetch(url,{...options, signal:t.signal});
    const raw=await response.text();
    let payload=null;
    try{ payload=raw?JSON.parse(raw):null; }catch{ payload={raw:raw.slice(0,500)}; }
    return {response,payload};
  } finally { t.clear(); }
}
async function fetchGoldApiNet(symbol,currency,key){
  const base=(process.env.GOLDAPI_NET_BASE_URL || 'https://app.goldapi.net').replace(/\/$/,'');
  const url=`${base}/price/${symbol}/${currency}?x-api-key=${encodeURIComponent(key)}`;
  const {response,payload}=await fetchJson(url,{headers:{Accept:'application/json'}});
  if(!response.ok) throw new Error(`goldapi.net ${symbol}/${currency}: HTTP ${response.status} ${payload?.error || payload?.message || payload?.raw || ''}`.trim());
  const price=Number(payload?.price ?? payload?.ask ?? payload?.bid);
  if(!Number.isFinite(price) || price<=0) throw new Error(`goldapi.net ${symbol}/${currency}: neplatná odpověď`);
  return {price, provider:'goldapi.net', payload};
}
async function fetchGoldApiIo(symbol,currency,key){
  const base=(process.env.GOLDAPI_IO_BASE_URL || 'https://www.goldapi.io').replace(/\/$/,'');
  const url=`${base}/api/${symbol}/${currency}`;
  const {response,payload}=await fetchJson(url,{headers:{'x-access-token':key, 'Content-Type':'application/json', Accept:'application/json'}});
  if(!response.ok) throw new Error(`goldapi.io ${symbol}/${currency}: HTTP ${response.status} ${payload?.error || payload?.message || payload?.raw || ''}`.trim());
  const price=Number(payload?.price ?? payload?.ask ?? payload?.bid);
  if(!Number.isFinite(price) || price<=0) throw new Error(`goldapi.io ${symbol}/${currency}: neplatná odpověď`);
  return {price, provider:'goldapi.io', payload};
}
async function fetchMetal(symbol,currency,key){
  const provider=String(process.env.GOLDAPI_PROVIDER || 'auto').toLowerCase();
  if(provider==='net') return fetchGoldApiNet(symbol,currency,key);
  if(provider==='io') return fetchGoldApiIo(symbol,currency,key);
  const errors=[];
  try { return await fetchGoldApiNet(symbol,currency,key); } catch(e){ errors.push(e.message); }
  try { return await fetchGoldApiIo(symbol,currency,key); } catch(e){ errors.push(e.message); }
  throw new Error(errors.join(' | '));
}
function calcSpreads(prices, timestamp){
  const rows=[];
  for(const m of MARKETS){
    for(const c of m.currencies){
      const spot=Number(prices?.[m.metal]?.[c]);
      if(!Number.isFinite(spot) || spot<=0) continue;
      const adjusted=spot*(1+(PREMIUM_BPS[m.location]||0)/10000);
      const spread=(SPREAD_BPS[m.metal]||100)/10000;
      const bid=adjusted*(1-spread/2);
      const offer=adjusted*(1+spread/2);
      rows.push({time:timestamp, marketKey:`${m.key}_${c}`, metal:m.metal, location:m.location, currency:c, spotToz:spot, bidToz:bid, offerToz:offer, spreadPct:((offer-bid)/bid)*100});
    }
  }
  return rows;
}
async function refreshPrices({force=false}={}){
  const db=readDb();
  if(!force && cacheFresh(db)) return {...db.latestPrices, source:'cache'};
  const key=process.env.GOLDAPI_KEY;
  if(!key) throw new Error('GOLDAPI_KEY není nastavený v Railway Variables.');
  const symbols=listEnv('GOLDAPI_METALS','XAU,XAG,XPT,XPD').filter(s=>METAL_MAP[s]);
  const currencies=listEnv('GOLDAPI_CURRENCIES','USD,EUR,CZK,CHF');
  const prices=JSON.parse(JSON.stringify(EMPTY_PRICES));
  const ok=[]; const errors=[];
  for(const symbol of symbols){
    const metal=METAL_MAP[symbol];
    for(const cur of currencies){
      try{
        const r=await fetchMetal(symbol,cur,key);
        prices[metal][cur]=r.price;
        ok.push(`${symbol}/${cur}:${r.provider}`);
      }catch(e){ errors.push(`${symbol}/${cur}: ${e.message}`); }
    }
  }
  if(!ok.length) throw new Error(errors.join(' || ') || 'GoldAPI nevrátilo žádnou platnou cenu.');
  const timestamp=now();
  db.latestPrices={mode:errors.length?'partial-live':'live', timestamp, prices, ok, warning:errors.length?errors.slice(0,20).join(' || '):null};
  for(const metal of Object.keys(prices)) for(const cur of Object.keys(prices[metal])){
    const price=Number(prices[metal][cur]);
    if(Number.isFinite(price) && price>0) db.priceHistory.push({time:timestamp, metal, currency:cur, priceToz:price});
  }
  db.spreadHistory.push(...calcSpreads(prices,timestamp));
  db.priceHistory=db.priceHistory.slice(-20000);
  db.spreadHistory=db.spreadHistory.slice(-20000);
  writeDb(db);
  return db.latestPrices;
}

app.get('/api/health',(req,res)=>{
  const db=readDb();
  res.json({ok:true, db:true, dbType:'embedded-json', postgres:false, hardcodedPrices:false, file:DB_FILE, latestMode:db.latestPrices?.mode || null, time:now()});
});
app.get('/api/debug/goldapi', async (req,res)=>{
  const key=process.env.GOLDAPI_KEY;
  const symbol=String(req.query.symbol || 'XAU').toUpperCase();
  const currency=String(req.query.currency || 'USD').toUpperCase();
  if(!key) return res.status(400).json({ok:false, hasKey:false, error:'GOLDAPI_KEY není nastavený.'});
  try{ const r=await fetchMetal(symbol,currency,key); res.json({ok:true, hasKey:true, provider:r.provider, symbol, currency, price:r.price, sampleFields:Object.keys(r.payload||{}).slice(0,20)}); }
  catch(e){ res.status(502).json({ok:false, hasKey:true, symbol, currency, error:e.message}); }
});
app.get('/api/prices/latest', async (req,res)=>{
  try{ res.json(await refreshPrices({force:req.query.force==='1'})); }
  catch(e){ res.status(502).json({mode:'error', timestamp:now(), prices:null, warning:e.message}); }
});
app.post('/api/admin/refresh-prices', async (req,res)=>{
  if(process.env.ADMIN_TOKEN && req.headers['x-admin-token']!==process.env.ADMIN_TOKEN) return res.status(403).json({ok:false,error:'Forbidden'});
  try{ res.json({ok:true, result:await refreshPrices({force:true})}); }
  catch(e){ res.status(502).json({ok:false,error:e.message}); }
});
app.get('/api/prices/history',(req,res)=>{
  const db=readDb();
  const metal=String(req.query.metal||'AU').toUpperCase();
  const currency=String(req.query.currency||'CZK').toUpperCase();
  const rows=db.priceHistory.filter(x=>x.metal===metal && x.currency===currency).slice(-500);
  res.json({metal,currency,rows});
});
app.get('/api/spreads/history',(req,res)=>{
  const db=readDb();
  const marketKey=String(req.query.marketKey||'AUXZU_CZK').toUpperCase();
  const rows=db.spreadHistory.filter(x=>String(x.marketKey).toUpperCase()===marketKey).slice(-500);
  res.json({marketKey,rows});
});
app.get('/api/accounts/demo/cards',(req,res)=>{
  const db=readDb();
  if(!db.accountCards?.length){
    db.accountCards=[
      {id:'summary',title:'Souhrn účtu',kind:'summary',order:1,enabled:true},
      {id:'cash',title:'Peněžní zůstatky',kind:'cash',order:2,enabled:true},
      {id:'metals',title:'Kovové zůstatky',kind:'metals',order:3,enabled:true},
      {id:'orders',title:'Pokyny a objednávky',kind:'orders',order:4,enabled:true}
    ]; writeDb(db);
  }
  res.json({cards:db.accountCards.filter(c=>c.enabled).sort((a,b)=>a.order-b.order)});
});


function ensureAdminData(db){
  db.users = Array.isArray(db.users) ? db.users : [];
  db.orders = Array.isArray(db.orders) ? db.orders : [];
  db.accountCards = Array.isArray(db.accountCards) ? db.accountCards : [];
  db.audit = Array.isArray(db.audit) ? db.audit : [];
  db.settings = db.settings && typeof db.settings === 'object' ? db.settings : {};
  if(!db.users.length){
    db.users.push(
      {id:'U1001', name:'Demo klient', email:'client@demo.local', role:'client', kyc:'verified', status:'active', cashCZK:750000, auG:120.5, agG:0, createdAt:now()},
      {id:'U1002', name:'Klient čeká na KYC', email:'kyc@demo.local', role:'client', kyc:'pending', status:'watch', cashCZK:150000, auG:0, agG:0, createdAt:now()},
      {id:'U1003', name:'Dealer', email:'dealer@demo.local', role:'dealer', kyc:'verified', status:'active', cashCZK:0, auG:0, agG:0, createdAt:now()}
    );
  }
  if(!db.accountCards.length){
    db.accountCards.push(
      {id:'summary',title:'Souhrn účtu',kind:'summary',order:1,enabled:true,description:'Celkový přehled klientského účtu'},
      {id:'cash',title:'Peněžní zůstatky',kind:'cash',order:2,enabled:true,description:'CZK / EUR / CHF / USD zůstatky'},
      {id:'metals',title:'Kovové zůstatky',kind:'metals',order:3,enabled:true,description:'Au / Ag / Pt / Pd v evidenci'},
      {id:'orders',title:'Pokyny a objednávky',kind:'orders',order:4,enabled:true,description:'Rozpracované, čekající a schválené pokyny'},
      {id:'kyc',title:'KYC / AML',kind:'compliance',order:5,enabled:true,description:'Ověření klienta a limity'}
    );
  }
  db.settings = {
    commissionReserveBps: 100,
    defaultSettlement: 'client-ledger',
    allowOrdersWithoutKyc: false,
    ...db.settings
  };
  return db;
}

function saveAudit(db, event, detail={}, actor='admin'){
  db.audit = Array.isArray(db.audit) ? db.audit : [];
  db.audit.unshift({id:'A'+Date.now().toString(36), time:now(), actor, event, detail});
  db.audit = db.audit.slice(0, 500);
}

function adminTokenOk(req){
  const token = process.env.ADMIN_TOKEN;
  if(!token) return true;
  return req.headers['x-admin-token'] === token || req.query.adminToken === token;
}
function requireAdmin(req,res,next){
  if(!adminTokenOk(req)) return res.status(403).json({ok:false,error:'Neplatný nebo chybějící ADMIN_TOKEN.'});
  next();
}
function publicAdminState(){
  const db=ensureAdminData(readDb());
  writeDb(db);
  return {
    usersCount: db.users.length,
    ordersCount: db.orders.length,
    pendingKyc: db.users.filter(u=>u.kyc==='pending').length,
    openOrders: db.orders.filter(o=>['rozpracováno','čeká','schváleno','draft','pending','approved'].includes(String(o.status||'').toLowerCase())).length,
    cardsCount: db.accountCards.length,
    auditCount: db.audit.length,
    latestPrices: db.latestPrices || null,
    settings: db.settings
  };
}

app.get('/api/admin/overview', requireAdmin, (req,res)=>res.json({ok:true, ...publicAdminState()}));
app.get('/api/admin/state', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); writeDb(db); res.json({ok:true, db}); });

app.get('/api/admin/users', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); writeDb(db); res.json({ok:true, users:db.users}); });
app.post('/api/admin/users', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb());
  const input=req.body||{};
  const user={
    id: input.id || ('U'+Date.now().toString(36).toUpperCase()),
    name: String(input.name||'Nový klient'),
    email: String(input.email||''),
    role: String(input.role||'client'),
    kyc: String(input.kyc||'pending'),
    status: String(input.status||'active'),
    cashCZK: Number(input.cashCZK||0),
    cashEUR: Number(input.cashEUR||0),
    cashCHF: Number(input.cashCHF||0),
    cashUSD: Number(input.cashUSD||0),
    auG: Number(input.auG||0), agG: Number(input.agG||0), ptG: Number(input.ptG||0), pdG: Number(input.pdG||0),
    createdAt: now(), updatedAt: now()
  };
  db.users.unshift(user); saveAudit(db,'user.create',{id:user.id,email:user.email}); writeDb(db); res.json({ok:true,user});
});
app.put('/api/admin/users/:id', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const user=db.users.find(u=>String(u.id)===String(req.params.id));
  if(!user) return res.status(404).json({ok:false,error:'Uživatel nenalezen.'});
  const allowed=['name','email','role','kyc','status','cashCZK','cashEUR','cashCHF','cashUSD','auG','agG','ptG','pdG'];
  for(const k of allowed) if(k in (req.body||{})) user[k]=['cashCZK','cashEUR','cashCHF','cashUSD','auG','agG','ptG','pdG'].includes(k)?Number(req.body[k]||0):req.body[k];
  user.updatedAt=now(); saveAudit(db,'user.update',{id:user.id}); writeDb(db); res.json({ok:true,user});
});
app.delete('/api/admin/users/:id', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const before=db.users.length; db.users=db.users.filter(u=>String(u.id)!==String(req.params.id));
  saveAudit(db,'user.delete',{id:req.params.id}); writeDb(db); res.json({ok:true,deleted:before-db.users.length});
});

app.get('/api/admin/orders', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); writeDb(db); res.json({ok:true, orders:db.orders}); });
app.post('/api/admin/orders', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const input=req.body||{};
  const order={
    id: input.id || ('O'+Date.now().toString(36).toUpperCase()),
    createdAt: now(), updatedAt: now(),
    userId: input.userId || '', userName: input.userName || '',
    side: input.side || 'BUY', marketKey: input.marketKey || '', market: input.market || '',
    metal: input.metal || '', currency: input.currency || 'CZK', quantity: Number(input.quantity||0),
    price: Number(input.price||0), total: Number(input.total||0), status: input.status || 'rozpracováno',
    note: input.note || ''
  };
  db.orders.unshift(order); saveAudit(db,'order.create',{id:order.id,status:order.status}); writeDb(db); res.json({ok:true,order});
});
app.patch('/api/admin/orders/:id/status', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const order=db.orders.find(o=>String(o.id)===String(req.params.id));
  if(!order) return res.status(404).json({ok:false,error:'Objednávka nenalezena.'});
  order.status=String(req.body?.status||order.status); order.updatedAt=now(); saveAudit(db,'order.status',{id:order.id,status:order.status}); writeDb(db); res.json({ok:true,order});
});
app.put('/api/admin/orders/:id', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const order=db.orders.find(o=>String(o.id)===String(req.params.id));
  if(!order) return res.status(404).json({ok:false,error:'Objednávka nenalezena.'});
  Object.assign(order, req.body||{}, {updatedAt:now()}); saveAudit(db,'order.update',{id:order.id}); writeDb(db); res.json({ok:true,order});
});
app.delete('/api/admin/orders/:id', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const before=db.orders.length; db.orders=db.orders.filter(o=>String(o.id)!==String(req.params.id));
  saveAudit(db,'order.delete',{id:req.params.id}); writeDb(db); res.json({ok:true,deleted:before-db.orders.length});
});

app.get('/api/admin/account-cards', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); writeDb(db); res.json({ok:true,cards:db.accountCards}); });
app.post('/api/admin/account-cards', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const input=req.body||{};
  const card={id:input.id||('card_'+Date.now().toString(36)),title:input.title||'Nová karta',kind:input.kind||'custom',order:Number(input.order||99),enabled:input.enabled!==false,description:input.description||''};
  db.accountCards.push(card); saveAudit(db,'card.create',{id:card.id}); writeDb(db); res.json({ok:true,card});
});
app.put('/api/admin/account-cards/:id', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const card=db.accountCards.find(c=>String(c.id)===String(req.params.id));
  if(!card) return res.status(404).json({ok:false,error:'Karta nenalezena.'});
  Object.assign(card, req.body||{}); card.order=Number(card.order||0); card.enabled=card.enabled!==false; saveAudit(db,'card.update',{id:card.id}); writeDb(db); res.json({ok:true,card});
});
app.delete('/api/admin/account-cards/:id', requireAdmin, (req,res)=>{
  const db=ensureAdminData(readDb()); const before=db.accountCards.length; db.accountCards=db.accountCards.filter(c=>String(c.id)!==String(req.params.id));
  saveAudit(db,'card.delete',{id:req.params.id}); writeDb(db); res.json({ok:true,deleted:before-db.accountCards.length});
});

app.get('/api/admin/settings', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); writeDb(db); res.json({ok:true,settings:db.settings}); });
app.put('/api/admin/settings', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); db.settings={...db.settings,...(req.body||{})}; saveAudit(db,'settings.update',db.settings); writeDb(db); res.json({ok:true,settings:db.settings}); });
app.get('/api/admin/audit', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); writeDb(db); res.json({ok:true,audit:db.audit}); });
app.delete('/api/admin/audit', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); db.audit=[]; writeDb(db); res.json({ok:true}); });
app.post('/api/admin/seed', requireAdmin, (req,res)=>{ const db=ensureAdminData(readDb()); saveAudit(db,'system.seed',{source:'admin'}); writeDb(db); res.json({ok:true, overview:publicAdminState()}); });


app.listen(PORT,()=>console.log(`Swiss Live Desk ADMIN CZ NO POSTGRES running on ${PORT}; data=${DB_FILE}; postgres=disabled; hardcodedPrices=false`));
