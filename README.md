# Swiss Gold Market Board — Railway + GitHub

Plná verze pro nasazení na Railway z GitHub repozitáře.

## Obsah

- český frontend `public/index.html`
- animovaný market tape ticker
- graf spot ceny
- historie spreadu
- backend API v Expressu
- PostgreSQL model pro:
  - historii cen,
  - historii spreadů,
  - klientské účty,
  - klientské karty účtu,
  - kovové zůstatky,
  - peněžní zůstatky,
  - objednávky/pokyny,
  - audit log.

## Lokální spuštění

```bash
npm install
cp .env.example .env
npm run dev
```

Bez `DATABASE_URL` poběží API v omezeném režimu s demo daty. Pro plný model použij PostgreSQL.

## Railway deployment

1. Vytvoř GitHub repo a nahraj celý obsah tohoto balíčku.
2. V Railway založ nový projekt.
3. Vyber **Deploy from GitHub repo**.
4. Přidej PostgreSQL service.
5. Na web service nastav proměnné:

```text
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
GOLDAPI_KEY=...
ADMIN_TOKEN=...
```

Railway nastavuje `PORT` automaticky.

## API

### Ceny

```http
GET /api/prices/latest
GET /api/prices/history?metal=AU&currency=CZK&days=30
GET /api/spreads/history?marketKey=AUXZU_CZK&days=30
POST /api/admin/refresh-prices
```

### Klientský účet

```http
GET /api/accounts/demo/cards
```

### Pokyny

```http
GET /api/orders
POST /api/orders
PATCH /api/orders/:id/status
```

## Produkční poznámka

Tento backend je použitelný jako základ, ale pro ostrý provoz doplň:

- skutečné přihlášení,
- RBAC,
- AML/KYC workflow,
- server-side validaci zůstatků,
- blokaci prostředků/kovu při zadání pokynu,
- auditní stopu pro změny pricingu,
- rate limiting,
- zálohování databáze,
- testy.


## PostgreSQL — důležité

Tento repozitář **neobsahuje běžící PostgreSQL databázi**. Tu je potřeba přidat v Railway jako samostatnou službu:

```text
+ New → Database → PostgreSQL
```

Potom v API službě nastavte:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Schéma databáze je v:

```text
sql/schema.sql
```

Migrační skripty:

```bash
npm run db:migrate
npm run db:check
```

Podrobný postup je v `docs/POSTGRES_RAILWAY_SETUP_CZ.md`.

## Railway ENOTFOUND fix

Pokud log obsahuje:

```text
getaddrinfo ENOTFOUND postgres.railway.internal
```

nejrychlejší oprava v Railway API service → Variables:

```text
DATABASE_URL=${{Postgres.DATABASE_PUBLIC_URL}}
DB_REQUIRED=false
```

Pak redeploy.

Podrobný postup: `docs/RAILWAY_ENOTFOUND_FIX_CZ.md`.


## Retail terminologie

Viditelné texty frontendu používají retailově srozumitelné pojmy: `Výkupní cena (Poptávka)`, `Prodejní cena (Nabídka)`, `Chci koupit`, `Chci prodat`. Slovník je v `docs/TERMINOLOGIE_RETAIL_CZ.md`.
