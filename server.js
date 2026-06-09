const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(__dirname,'public')));

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname,'data');
const DB_FILE = path.join(DATA_DIR,'swiss-live-desk.json');

const DEFAULT_PRICES={
  AU:{USD:4325.10,EUR:4018.80,CHF:3775.40,CZK:98120.00},
  AG:{USD:58.20,EUR:54.15,CHF:50.82,CZK:1320.00},
  PT:{USD:1680.00,EUR:1561.00,CHF:1467.50,CZK:38120.00},
  PD:{USD:1620.00,EUR:1505.30,CHF:1412.00,CZK:36780.00}
};
function now(){return new Date().toISOString()}
function ensure(){fs.mkdirSync(DATA_DIR,{recursive:true})}
function clone(x){return JSON.parse(JSON.stringify(x))}
function defaultDb(){
  const t=now();
  const db={
    meta:{dbType:'embedded-json',createdAt:t,updatedAt:t,file:DB_FILE,postgres:false},
    users:[{id:'demo',name:'Demo klient',email:'client@demo.local',role:'client',kyc:'ověřen',status:'aktivní'}],
    accountCards:[
      {id:'summary',userId:'demo',type:'summary',title:'Souhrn účtu',sortOrder:10,data:{valuationCzk:15504,cashCzk:41,totalCzk:15545}},
      {id:'gold',userId:'demo',type:'metal',title:'Zlato',sortOrder:20,data:{location:'Curych',quantityKg:0.141,valuationCzk:5888,action:'Chci prodat'}},
      {id:'silver',userId:'demo',type:'metal',title:'Stříbro',sortOrder:30,data:{location:'Curych',quantityKg:2.516,valuationCzk:1395,action:'Chci prodat'}},
      {id:'currency',userId:'demo',type:'currency',title:'Měnové zůstatky',sortOrder:40,data:{CZK:41,EUR:1,USD:1}},
      {id:'trading',userId:'demo',type:'settings',title:'Obchodní nastavení',sortOrder:50,data:{silverTrading:'povoleno',platinumTrading:'povoleno'}},
      {id:'security',userId:'demo',type:'settings',title:'Bezpečnostní nastavení',sortOrder:60,data:{twoFactor:'neaktivní',biometric:'neaktivní'}}
    ],
    orders:[{id:'O-DEMO-001',createdAt:t,userId:'demo',side:'BUY',status:'rozpracováno',marketKey:'AUXZU_CZK',market:'Zlato: Curych',currency:'CZK',quantity:1,unit:'oz',price:98488,total:98488}],
    latestPrices:{mode:'demo',timestamp:t,prices:clone(DEFAULT_PRICES)},
    priceHistory:[], spreadHistory:[], audit:[{time:t,event:'system.init',detail:'NO POSTGRES SAFE'}]
  };
  seedHistory(db); return db;
}
function seedHistory(db){
  if(db.priceHistory.length && db.spreadHistory.length) return;
  const metals=['AU','AG','PT','PD'], curs=['CZK','EUR','USD','CHF']; const n=Date.now();
  for(let i=44;i>=0;i--){
    const time=new Date(n-i*86400000).toISOString();
    for(const metal of metals) for(const currency of curs){const base=DEFAULT_PRICES[metal][currency]; if(!base) continue; const noise=Math.sin(i*.61+metal.charCodeAt(1))*.018; const drift=(44-i)*.0008; db.priceHistory.push({time,metal,currency,priceToz:+(base*(1+noise+drift)).toFixed(6)});}
    for(const [marketKey,metal,currency,baseSpread] of [['AUXZU_CZK','AU','CZK',.55],['AUXZU_EUR','AU','EUR',.55],['AUXZU_USD','AU','USD',.55],['AGXZU_CZK','AG','CZK',1.8],['AGXZU_EUR','AG','EUR',1.8],['PTXLN_EUR','PT','EUR',1.25],['PDXLN_EUR','PD','EUR',1.6]]){const wave=Math.sin(i*.43+marketKey.length)*.16; db.spreadHistory.push({time,marketKey,metal,currency,spreadPct:+Math.max(.05,baseSpread+wave).toFixed(4)});}
  }
}
function readDb(){ensure(); if(!fs.existsSync(DB_FILE)){const db=defaultDb(); writeDb(db); return db;} try{return JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}catch(e){const bad=DB_FILE+'.corrupt-'+Date.now(); try{fs.renameSync(DB_FILE,bad)}catch{} const db=defaultDb(); db.audit.unshift({time:now(),event:'db.recovered',detail:bad}); writeDb(db); return db;}}
function writeDb(db){ensure(); db.meta=db.meta||{}; db.meta.updatedAt=now(); db.meta.file=DB_FILE; const tmp=DB_FILE+'.tmp'; fs.writeFileSync(tmp,JSON.stringify(db,null,2)); fs.renameSync(tmp,DB_FILE)}
function withDb(fn){const db=readDb(); const out=fn(db); writeDb(db); return out}

app.get('/api/health',(req,res)=>{const db=readDb(); res.json({ok:true,db:true,dbType:'embedded-json',postgres:false,file:DB_FILE,time:now(),counts:{users:db.users.length,accountCards:db.accountCards.length,orders:db.orders.length,priceHistory:db.priceHistory.length,spreadHistory:db.spreadHistory.length}})});
app.get('/api/debug/db',(req,res)=>{const db=readDb(); res.json({ok:true,dbType:'embedded-json',file:DB_FILE,dataDir:DATA_DIR,exists:fs.existsSync(DB_FILE),meta:db.meta,counts:{users:db.users.length,cards:db.accountCards.length,orders:db.orders.length,prices:db.priceHistory.length,spreads:db.spreadHistory.length,audit:db.audit.length}})});
app.get('/api/prices/latest',async(req,res)=>{const db=readDb(); const key=process.env.GOLDAPI_KEY; if(!key) return res.json(db.latestPrices); try{const map={XAU:'AU',XAG:'AG',XPT:'PT',XPD:'PD'}; const currencies=['USD','EUR','CHF','CZK']; const prices=clone(db.latestPrices.prices||DEFAULT_PRICES); for(const [sym,metal] of Object.entries(map)){for(const cur of currencies){const r=await fetch(`https://www.goldapi.io/api/${sym}/${cur}`,{headers:{'x-access-token':key,'Content-Type':'application/json'}}); if(!r.ok) throw new Error(`${sym}/${cur}: HTTP ${r.status}`); const payload=await r.json(); const v=Number(payload.price); if(Number.isFinite(v)&&v>0) prices[metal][cur]=v;}} db.latestPrices={mode:'live',timestamp:now(),prices}; for(const metal of Object.keys(prices)) for(const currency of Object.keys(prices[metal])) db.priceHistory.push({time:db.latestPrices.timestamp,metal,currency,priceToz:prices[metal][currency]}); db.priceHistory=db.priceHistory.slice(-8000); writeDb(db); res.json(db.latestPrices)}catch(e){db.latestPrices.mode='demo'; db.latestPrices.timestamp=now(); db.latestPrices.warning=e.message; writeDb(db); res.json(db.latestPrices)}});
app.get('/api/prices/history',(req,res)=>{const db=readDb(); const metal=String(req.query.metal||'AU').toUpperCase(); const currency=String(req.query.currency||'CZK').toUpperCase(); const days=Number(req.query.days||30); const since=Date.now()-days*86400000; const rows=db.priceHistory.filter(r=>r.metal===metal&&r.currency===currency&&new Date(r.time).getTime()>=since).sort((a,b)=>new Date(a.time)-new Date(b.time)); res.json({ok:true,metal,currency,days,rows})});
app.get('/api/spreads/history',(req,res)=>{const db=readDb(); const marketKey=String(req.query.marketKey||'AUXZU_CZK'); const days=Number(req.query.days||30); const since=Date.now()-days*86400000; const rows=db.spreadHistory.filter(r=>r.marketKey===marketKey&&new Date(r.time).getTime()>=since).sort((a,b)=>new Date(a.time)-new Date(b.time)); res.json({ok:true,marketKey,days,rows})});
app.get('/api/accounts/:userId/cards',(req,res)=>{const db=readDb(); const userId=req.params.userId||'demo'; const cards=db.accountCards.filter(c=>c.userId===userId).sort((a,b)=>a.sortOrder-b.sortOrder); res.json({ok:true,userId,cards})});
app.get('/api/orders',(req,res)=>{res.json({ok:true,orders:readDb().orders})});
app.post('/api/orders',(req,res)=>{const body=req.body||{}; const order=withDb(db=>{const o={id:'O'+Date.now().toString().slice(-8),createdAt:now(),userId:body.userId||'demo',side:body.side||'BUY',status:body.status||'rozpracováno',marketKey:body.marketKey||null,market:body.market||null,currency:body.currency||'CZK',quantity:Number(body.quantity||0),unit:body.unit||'oz',price:Number(body.price||0),total:Number(body.total||0),raw:body}; db.orders.unshift(o); db.audit.unshift({time:now(),event:'order.created',detail:o.id}); return o}); res.status(201).json({ok:true,order})});
app.post('/api/admin/reset-db',(req,res)=>{const token=req.headers['x-admin-token']; if(process.env.ADMIN_TOKEN&&token!==process.env.ADMIN_TOKEN) return res.status(403).json({ok:false,error:'Forbidden'}); const db=defaultDb(); writeDb(db); res.json({ok:true,reset:true})});
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
const fs = require('fs');
const path = require('path');

// Cesta k souboru, kam ti aplikace ukládá lidi (případně uprav podle hlášky v logu)
const DATA_PATH = path.join(__dirname, 'app', 'data', 'swiss-live-desk.json');

app.get('/admin', (req, res) => {
    let users = [];
    
    // 1. Načteme data ze souboru
    try {
        if (fs.existsSync(DATA_PATH)) {
            const fileContent = fs.readFileSync(DATA_PATH, 'utf8');
            users = JSON.parse(fileContent);
        }
    } catch (error) {
        return res.send("Chyba při čtení databáze klientů: " + error.message);
    }

    // 2. Vygenerujeme přímočaré HTML řádky pro tabulku
    const rows = users.map(user => `
        <tr>
            <td style="font-weight:bold;">${user.name || user.regName || 'Nezadáno'}</td>
            <td>${user.email || user.regEmail || '-'}</td>
            <td>${user.country || user.regCountry || '-'}</td>
            <td><span style="background:#fff7df; padding:3px 8px; border-radius:4px; font-weight:bold;">${user.status || 'Čeká na schválení'}</span></td>
            <td>${user.regId1 ? `<a href="/uploads/${user.regId1}" target="_blank" style="color:#1e5b98; font-weight:bold;">Zobrazit OP ↗</a>` : 'Chybí'}</td>
            <td>${user.regId2 ? `<a href="/uploads/${user.regId2}" target="_blank" style="color:#1e5b98; font-weight:bold;">Zobrazit Doklad 2 ↗</a>` : 'Chybí'}</td>
        </tr>
    `).join('');

    // 3. Vyplivneme hotovou stránku do prohlížeče
    res.send(`
        <!DOCTYPE html>
        <html lang="cs">
        <head>
            <meta charset="UTF-8">
            <title>SAFE AML Kontrola Dokladů</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 30px; background: #edf1f5; color: #1d2935; }
                .container { max-width: 1100px; margin: 0 auto; background: white; padding: 24px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                h2 { color: #10253f; margin-top: 0; border-bottom: 2px solid #b78a33; padding-bottom: 10px; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th, td { padding: 12px; border: 1px solid #d7e0ea; text-align: left; }
                th { background: #10253f; color: white; font-size: 13px; text-transform: uppercase; }
                tr:hover { background: #f7f9fb; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>Interní AML Systém – Kontrola dálkové identifikace klientů</h2>
                <p>Zde vidíte data zapsaná do souboru <code>swiss-live-desk.json</code> pro ověření 2 dokladů a 1 Kč.</p>
                <table>
                    <thead>
                        <tr>
                            <th>Jméno / Firma</th>
                            <th>E-mail</th>
                            <th>Země</th>
                            <th>Status účtu</th>
                            <th>Hlavní doklad (OP)</th>
                            <th>Druhý doklad</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows || '<tr><td colspan="6" style="text-align:center; color:gray;">Zatím se nikdo nezaregistroval.</td></tr>'}
                    </tbody>
                </table>
            </div>
        </body>
        </html>
    `);
});
app.listen(PORT,()=>{const db=readDb(); console.log(`Swiss Live Desk NO POSTGRES SAFE BUILD listening on ${PORT}`); console.log(`DB file: ${DB_FILE}`); console.log('PostgreSQL: disabled'); console.log(`Users=${db.users.length}, cards=${db.accountCards.length}, orders=${db.orders.length}`);});
