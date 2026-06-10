# Railway chyba: `getaddrinfo ENOTFOUND postgres.railway.internal`

## Co chyba znamená

Aplikace se snaží připojit na interní Railway hostname:

```text
postgres.railway.internal
```

ale DNS jej v běžícím containeru neumí přeložit. Výsledek je pád při inicializaci schématu:

```text
Schema init failed Error: getaddrinfo ENOTFOUND postgres.railway.internal
```

## Nejrychlejší oprava

V Railway otevřete **API/Web service** → **Variables**.

Dočasně nastavte:

```text
DATABASE_URL=${{Postgres.DATABASE_PUBLIC_URL}}
DB_REQUIRED=false
```

Potom redeploy.

Poznámka: `DATABASE_PUBLIC_URL` používá veřejný TCP proxy přístup. Je vhodné pro okamžité zprovoznění. Po ověření lze přepnout zpět na private URL, pokud Postgres a API běží ve stejném Railway projektu a prostředí.

## Správné private nastavení

1. V Railway projektu musí být PostgreSQL služba.
2. API služba a PostgreSQL služba musí být ve stejném **project** a stejném **environment**.
3. V API službě nastavte:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Pokud se databázová služba jmenuje jinak než `Postgres`, použijte skutečný název služby:

```text
DATABASE_URL=${{NÁZEV_SLUŽBY.DATABASE_URL}}
```

## Častá chyba

Nedávejte ručně do API služby tvrdě zapsanou hodnotu:

```text
postgresql://...@postgres.railway.internal:5432/railway
```

Používejte Railway reference variable:

```text
${{Postgres.DATABASE_URL}}
```

nebo pro odblokování:

```text
${{Postgres.DATABASE_PUBLIC_URL}}
```

## Ověření

Po deployi otevřete:

```text
/api/health
```

Správně má vrátit například:

```json
{
  "ok": true,
  "dbConfigured": true,
  "dbReady": true,
  "dbError": null
}
```

Pokud `dbReady=false`, aplikace běží v degraded režimu a DB endpointy vrací demo/fallback data.
