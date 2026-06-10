# Swiss Live Desk – CZ NO POSTGRES + Admin Console

Bez PostgreSQL. Data jsou v `DATA_DIR/swiss-live-desk.json`.

## Spuštění

```bash
npm install
npm start
```

## Railway Variables

```env
NODE_ENV=production
DATA_DIR=/app/data
GOLDAPI_KEY=...
GOLDAPI_PROVIDER=auto
ADMIN_TOKEN=volitelny-token
```

## Endpointy

- `/` obchodní tabule
- `/admin.html` admin konzole
- `/api/health`
- `/api/prices/latest`
- `/api/admin/overview`
- `/api/admin/users`
- `/api/admin/orders`
- `/api/admin/account-cards`
- `/api/admin/settings`
- `/api/admin/audit`

Pokud nastavíš `ADMIN_TOKEN`, admin konzole ho musí posílat v hlavičce `x-admin-token`. V UI je pole `ADMIN_TOKEN`.
