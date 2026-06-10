# Retail terminologie CZ

Cílem je, aby český retailový investor nemusel rozumět market-maker žargonu.

## Závazný slovník frontendu

| Interní / tržní pojem | Viditelný český text |
|---|---|
| Best bid | Výkupní cena (Poptávka) |
| Best offer | Prodejní cena (Nabídka) |
| Bid quantity | Množství ve výkupu |
| Offer quantity | Množství v nabídce |
| Buy | Chci koupit |
| Sell | Chci prodat |
| Draft | Rozpracováno |
| Amount | Částka |
| Payment reference | Platební reference |
| Order preview | Náhled pokynu |
| Market | Trh |
| Currency | Měna |
| Indicative liquidity | Orientační likvidita |

## Interní názvy mohou zůstat anglicky

V kódu, databázi a API mohou zůstat technické názvy `bid`, `offer`, `draft`, `market`, protože jsou běžné v tradingové doméně.
Ve frontendu pro klienta se ale nesmí zobrazovat jako hlavní text.

## UX pravidlo

Klient musí ihned pochopit dvě akce:

- `Chci koupit` = klient nakupuje za prodejní cenu / nabídku.
- `Chci prodat` = klient prodává za výkupní cenu / poptávku.
