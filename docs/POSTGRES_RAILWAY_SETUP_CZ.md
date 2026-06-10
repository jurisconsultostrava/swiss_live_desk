# PostgreSQL na Railway — postup

Repo **neobsahuje běžící databázi**. Obsahuje pouze:

- `sql/schema.sql` — databázový model,
- `scripts/migrate.js` — migrace schématu do PostgreSQL,
- `server.js` — backend, který používá `DATABASE_URL`.

## 1. Přidání PostgreSQL služby v Railway

V Railway projektu:

1. kliknout na `+ New`,
2. vybrat `Database`,
3. vybrat `PostgreSQL`.

Tím vznikne samostatná PostgreSQL služba.

## 2. Nastavení DATABASE_URL

V API službě otevřít:

```text
Variables → Add Reference Variable
```

Nastavit:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Pokud se databázová služba nejmenuje `Postgres`, použijte skutečný název služby, například:

```text
DATABASE_URL=${{moje-db.DATABASE_URL}}
```

## 3. Migrace databáze

Backend při startu načte `sql/schema.sql` automaticky přes `ensureSchema()` v `server.js`.

Ručně lze migraci spustit:

```bash
npm run db:migrate
```

Kontrola tabulek:

```bash
npm run db:check
```

## 4. Lokální vývoj s Dockerem

```bash
docker compose up -d
export DATABASE_URL="postgresql://swiss_gold:swiss_gold_dev@localhost:5432/swiss_gold"
npm install
npm run db:migrate
npm run dev
```

## 5. Očekávané tabulky

- `app_users`
- `client_cash_balances`
- `client_metal_holdings`
- `account_cards`
- `account_settings`
- `client_orders`
- `metal_price_snapshots`
- `market_spread_snapshots`
- `audit_log`

## 6. Pokud vznikne `ENOTFOUND postgres.railway.internal`

Použijte dočasně veřejný DB URL reference:

```text
DATABASE_URL=${{Postgres.DATABASE_PUBLIC_URL}}
DB_REQUIRED=false
```

Tím se deployment odblokuje. Detailní postup je v:

```text
docs/RAILWAY_ENOTFOUND_FIX_CZ.md
```
