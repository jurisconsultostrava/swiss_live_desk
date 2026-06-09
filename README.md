# Swiss Live Desk — NO POSTGRES SAFE BUILD

Tahle verze úplně zahazuje PostgreSQL.

## Railway
Pouze jedna služba `swiss_live_desk`.

Variables:

```env
NODE_ENV=production
DATA_DIR=/app/data
```

Smazat proměnné:

```env
DATABASE_URL
PGHOST
PGPASSWORD
PGUSER
PGDATABASE
PGPORT
```

## Health

```text
/api/health
```

má vrátit:

```json
{"ok":true,"db":true,"dbType":"embedded-json","postgres":false}
```

Data jsou v:

```text
/app/data/swiss-live-desk.json
```
