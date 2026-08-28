# Candle economy

The candle chain turns a slow apiary by-product into a high-value Tier-4 household good:

`Apiary or backyard apiary -> beeswax -> Chandlery + firewood -> candles -> Household wares stall -> Tier-4 Luxury`

Candles are counted as trade-sized lots, like the other physical commodities. They are an alternative source of the existing `Luxury` need rather than a new household-need row.

## Beeswax supply

The staffed forest Apiary remains primarily a honey producer. Workers accumulate whole-unit hive yield from March through August, then extract it into physical honey from September through November. Every third complete honey batch extracted in Autumn makes one unit of beeswax. The wax cadence is recorded separately from both the work cycle and the unextracted hive ledger. If the Apiary's 12-unit wax shelf is full, the due wax batch waits; honey extraction is not blocked and the progress is not lost. Any hive yield still unharvested when December begins is lost.

The backyard apiary also remains primarily a household honey source. A successful whole-unit honey harvest may collect one unit of wax when its secondary 90-day clock is due during March-November. Its household wax shelf holds eight units. A full shelf leaves the secondary clock due instead of cancelling the wax or blocking honey. Collected wax uses the existing road-linked Storehouse goods-depot route.

This makes wax deliberately scarcer than honey. Large apiaries provide the reliable industrial feedstock, while backyard hives add occasional small lots without requiring an assigned labor slot.

## Chandlery balance

The Chandlery is the dedicated processor because candle dipping, hot-wax handling, wick preparation, drying racks, and fire safety form a distinct workshop job.

| Property | Balance |
| --- | ---: |
| Construction | 34 timber, 16 stone, 1 ironwork |
| Labor | Up to 2 chandlers |
| Cycle | 1,050 simulation seconds |
| Recipe | 2 beeswax + 1 firewood -> 6 candle lots |
| Input storage | 48 beeswax, 16 firewood |
| Output storage | 72 candles |
| Local cart lot | 12 units |

Production follows the standard staffed processor rules: no assigned chandler means no conversion, all inputs must be available before a cycle commits, and the complete six-unit output batch must fit. The output-target policy can limit how full the candle shelf becomes.

## Physical routing and household service

Apiaries offer wax to a staffed Chandlery first, then to an accepting Village Storehouse or Trading Post. Storehouse and imported wax can be staged back to a working Chandlery. A Chandlery dispatches finished candles to a Village Storehouse and then a Trading Post, subject to ordinary cart and storage constraints.

Wax and candles use stable commodity IDs 64 and 65. Because the original storage-acceptance field is a 64-bit persisted mask, these goods use the companion high mask. The Village Storehouse lists both under its market-wares acceptance group.

At the Marketplace, candles are displayed and staffed through the existing `Pottery` table, whose player-facing label is **Household wares**. That reuses one goods-stall worker and avoids adding another stall slot. The service remains semantically `Luxury`: only Tier-4 households demand it, and a candle delivery fills their Luxury stock rather than their Pottery stock.

When a Marketplace can supply more than one Luxury commodity, withdrawal order is:

1. Candles
2. Wine
3. Honey

This protects flexible honey for food and mead and wine for other beverage uses. Existing upgraded flower gardens continue to satisfy Luxury through their household path.

## Local devotional contracts

Staffed chapels and monasteries maintain their own small physical candle cupboards. They buy only from a staffed, road-linked Trading Post; Marketplace Household wares stock is never claimed by an institution. This creates a legible routing choice:

- Storehouse -> Marketplace stock serves Tier-4 Luxury.
- Trading Post stock can satisfy local devotional contracts or leave on a regional export caravan.

Each local contract exchanges four candle lots for five gold. A Trading Post worker carries the candles to the institution, the full lot must still fit and be affordable when the cart arrives, and the same cart returns with the payment. A damaged or partial load is not purchased. Returned payment enters the existing local-purchase accounting path: economic-activity tax becomes a protected civic receipt and the balance becomes protected local producer income.

The local rate is deliberately below export parity: eight locally contracted candles yield ten gross gold, while eight exported candles yield fourteen. The non-cash return is devotional service:

- A chapel holds up to eight lots, reorders at four, protects its 120-gold charity threshold, and burns one lot each Sunday. A supplied liturgy adds five percentage points to parish attendance and therefore modestly strengthens the tithe-supported parish economy.
- A monastery holds up to sixteen lots, targets twelve, protects forty private gold for ordinary services, and burns one lot every three days. Supplied offices multiply hospitality gift prestige by 1.10, helping retained pilgrimage offerings fund services, charity, and estate upkeep.

Unstaffed or fire-disabled institutions neither consume nor order candles. Road failure, occupied carts, empty Trading Posts, full cupboards, or insufficient unreserved institutional gold leave demand unmet without minting stock or payment.

## Regional trade

Both stages can be traded through the physical market-accessible inventory system.

| Offer | Lot | Gold |
| --- | ---: | ---: |
| Import beeswax | 8 | 24 cost |
| Export beeswax | 8 | 15 yield |
| Import candles | 8 | 34 cost |
| Export candles | 8 | 14 yield |

The import premium prevents a buy-and-sell profit loop. Even importing wax, buying a full firewood lot, processing it, and exporting the resulting candles leaves only a moderate value-added margin after four workshop cycles. Marketplace, Trading Post, and Village Storehouse candle capacities allow imported or locally made lots to remain physical until household distribution serves them.

## Possible future wax and candle sinks

The devotional contract above implements routine liturgical use. Remaining design directions are:

- **Candlemas surge:** The existing routine reserve could support a larger one-day draw for the calendar observance once protected holidays have a dedicated pre-feast provisioning phase.
- **Wax seals:** Town Halls, monasteries, or Trading Posts could consume tiny wax lots for sealed records, charters, and high-value contracts.
- **Decorative lighting:** Taverns, workshops, watch posts, or prosperous homes could spend candles on visible lamps and window glow. This must remain cosmetic so enabling the optional day/night presentation never changes production or safety.
- **Waterproofing and maintenance:** Wax could support treated thread, leather dressing, bowstrings, wooden vessels, or weatherproof cloth as a modest workshop-efficiency input.
- **Lost-wax casting:** A future bellfounder, bronze workshop, or religious-metalwork chain could consume wax models for intricate cast parts.

Keeping the remaining ideas as later sinks preserves the central choice: homes consume candles for comfort, local religious houses buy them for a smaller cash return plus faith benefits, and regional merchants pay the strongest pure-cash rate.
