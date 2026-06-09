# Architektura backendu

## Tabulky

- `app_users` — klienti, dealeři, admini
- `client_cash_balances` — peněžní zůstatky podle měny
- `client_metal_holdings` — kovové zůstatky podle kovu a lokace
- `account_cards` — definice karet klientského účtu
- `account_settings` — nastavení klienta
- `client_orders` — obchodní pokyny
- `metal_price_snapshots` — historie spotových cen
- `market_spread_snapshots` — historie spreadů podle trhu
- `audit_log` — auditní stopa

## Klientské karty

Karty v účtu klienta nejsou hardcoded ve frontendu. Backend vrací jejich pořadí, název a data z endpointu:

```http
GET /api/accounts/demo/cards
```

To umožní později přidat např. kartu „KYC“, „Smlouvy“, „Daňové výpisy“, „Fyzické dodání“, aniž by se měnil frontend.
