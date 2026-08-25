---
layout: default
title: Strategy
parent: API Coverage
---

## Strategy

### Account Info

| Function                            | Status | Description              |
| ----------------------------------- | ------ | ------------------------ |
| `strategy.account_currency`         | ✅     | Account currency         |
| `strategy.equity`                   | ✅     | Account equity           |
| `strategy.grossloss`                | ✅     | Gross loss               |
| `strategy.grossloss_percent`        | ✅     | Gross loss percentage    |
| `strategy.grossprofit`              | ✅     | Gross profit             |
| `strategy.grossprofit_percent`      | ✅     | Gross profit percentage  |
| `strategy.initial_capital`          | ✅     | Initial capital          |
| `strategy.margin_liquidation_price` | ✅     | Margin liquidation price |
| `strategy.netprofit`                | ✅     | Net profit               |
| `strategy.netprofit_percent`        | ✅     | Net profit percentage    |

### Trade Statistics

| Function                             | Status | Description                   |
| ------------------------------------ | ------ | ----------------------------- |
| `strategy.avg_losing_trade`          | ✅     | Average losing trade          |
| `strategy.avg_losing_trade_percent`  | ✅     | Average losing trade percent  |
| `strategy.avg_trade`                 | ✅     | Average trade                 |
| `strategy.avg_trade_percent`         | ✅     | Average trade percent         |
| `strategy.avg_winning_trade`         | ✅     | Average winning trade         |
| `strategy.avg_winning_trade_percent` | ✅     | Average winning trade percent |
| `strategy.closedtrades`              | ✅     | Number of closed trades       |
| `strategy.eventrades`                | ✅     | Number of even trades         |
| `strategy.losstrades`                | ✅     | Number of losing trades       |
| `strategy.opentrades`                | ✅     | Number of open trades         |
| `strategy.wintrades`                 | ✅     | Number of winning trades      |

### Closed Trades

| Function                                       | Status | Description              |
| ---------------------------------------------- | ------ | ------------------------ |
| `strategy.closedtrades.first_index`            | ✅     | First closed trade index |
| `strategy.closedtrades.commission()`           | ✅     | Get commission           |
| `strategy.closedtrades.entry_bar_index()`      | ✅     | Get entry bar index      |
| `strategy.closedtrades.entry_comment()`        | ✅     | Get entry comment        |
| `strategy.closedtrades.entry_id()`             | ✅     | Get entry ID             |
| `strategy.closedtrades.entry_price()`          | ✅     | Get entry price          |
| `strategy.closedtrades.entry_time()`           | ✅     | Get entry time           |
| `strategy.closedtrades.exit_bar_index()`       | ✅     | Get exit bar index       |
| `strategy.closedtrades.exit_comment()`         | ✅     | Get exit comment         |
| `strategy.closedtrades.exit_id()`              | ✅     | Get exit ID              |
| `strategy.closedtrades.exit_price()`           | ✅     | Get exit price           |
| `strategy.closedtrades.exit_time()`            | ✅     | Get exit time            |
| `strategy.closedtrades.max_drawdown()`         | ✅     | Get max drawdown         |
| `strategy.closedtrades.max_drawdown_percent()` | ✅     | Get max drawdown percent |
| `strategy.closedtrades.max_runup()`            | ✅     | Get max runup            |
| `strategy.closedtrades.max_runup_percent()`    | ✅     | Get max runup percent    |
| `strategy.closedtrades.profit()`               | ✅     | Get profit               |
| `strategy.closedtrades.profit_percent()`       | ✅     | Get profit percent       |
| `strategy.closedtrades.size()`                 | ✅     | Get size                 |

### Drawdown & Runup

| Function                            | Status | Description                |
| ----------------------------------- | ------ | -------------------------- |
| `strategy.max_contracts_held_all`   | ✅     | Max contracts held (all)   |
| `strategy.max_contracts_held_long`  | ✅     | Max contracts held (long)  |
| `strategy.max_contracts_held_short` | ✅     | Max contracts held (short) |
| `strategy.max_drawdown`             | ✅     | Maximum drawdown           |
| `strategy.max_drawdown_percent`     | ✅     | Maximum drawdown percent   |
| `strategy.max_runup`                | ✅     | Maximum runup              |
| `strategy.max_runup_percent`        | ✅     | Maximum runup percent      |

### Position Info

| Function                       | Status | Description            |
| ------------------------------ | ------ | ---------------------- |
| `strategy.openprofit`          | ✅     | Open profit            |
| `strategy.openprofit_percent`  | ✅     | Open profit percent    |
| `strategy.position_avg_price`  | ✅     | Position average price |
| `strategy.position_entry_name` | ✅     | Position entry name    |
| `strategy.position_size`       | ✅     | Position size          |

### Open Trades

| Function                                     | Status | Description              |
| -------------------------------------------- | ------ | ------------------------ |
| `strategy.opentrades.capital_held`           | ✅     | Capital held             |
| `strategy.opentrades.commission()`           | ✅     | Get commission           |
| `strategy.opentrades.entry_bar_index()`      | ✅     | Get entry bar index      |
| `strategy.opentrades.entry_comment()`        | ✅     | Get entry comment        |
| `strategy.opentrades.entry_id()`             | ✅     | Get entry ID             |
| `strategy.opentrades.entry_price()`          | ✅     | Get entry price          |
| `strategy.opentrades.entry_time()`           | ✅     | Get entry time           |
| `strategy.opentrades.max_drawdown()`         | ✅     | Get max drawdown         |
| `strategy.opentrades.max_drawdown_percent()` | ✅     | Get max drawdown percent |
| `strategy.opentrades.max_runup()`            | ✅     | Get max runup            |
| `strategy.opentrades.max_runup_percent()`    | ✅     | Get max runup percent    |
| `strategy.opentrades.profit()`               | ✅     | Get profit               |
| `strategy.opentrades.profit_percent()`       | ✅     | Get profit percent       |
| `strategy.opentrades.size()`                 | ✅     | Get size                 |

### Constants

| Function                     | Status | Description                |
| ---------------------------- | ------ | -------------------------- |
| `strategy.cash`              | ✅     | Cash constant              |
| `strategy.fixed`             | ✅     | Fixed constant             |
| `strategy.long`              | ✅     | Long constant              |
| `strategy.percent_of_equity` | ✅     | Percent of equity constant |
| `strategy.short`             | ✅     | Short constant             |

### Commission

| Function                                | Status | Description        |
| --------------------------------------- | ------ | ------------------ |
| `strategy.commission.cash_per_contract` | ✅     | Cash per contract  |
| `strategy.commission.cash_per_order`    | ✅     | Cash per order     |
| `strategy.commission.percent`           | ✅     | Commission percent |

### Direction

| Function                   | Status | Description     |
| -------------------------- | ------ | --------------- |
| `strategy.direction.all`   | ✅     | All directions  |
| `strategy.direction.long`  | ✅     | Long direction  |
| `strategy.direction.short` | ✅     | Short direction |

### OCA

| Function              | Status | Description |
| --------------------- | ------ | ----------- |
| `strategy.oca.cancel` | ✅     | OCA cancel  |
| `strategy.oca.none`   | ✅     | OCA none    |
| `strategy.oca.reduce` | ✅     | OCA reduce  |

### Order Management

| Function                | Status | Description       |
| ----------------------- | ------ | ----------------- |
| `strategy.cancel()`     | ✅     | Cancel order      |
| `strategy.cancel_all()` | ✅     | Cancel all orders |

### Position Management

| Function               | Status | Description         |
| ---------------------- | ------ | ------------------- |
| `strategy.close()`     | ✅     | Close position      |
| `strategy.close_all()` | ✅     | Close all positions |
| `strategy.entry()`     | ✅     | Enter position      |
| `strategy.exit()`      | ✅     | Exit position       |
| `strategy.order()`     | ✅     | Place order         |

### Conversion

| Function                        | Status | Description            |
| ------------------------------- | ------ | ---------------------- |
| `strategy.convert_to_account()` | ✅     | Convert to account     |
| `strategy.convert_to_symbol()`  | ✅     | Convert to symbol      |
| `strategy.default_entry_qty()`  | ✅     | Default entry quantity |

### Risk Management

| Function                                     | Status | Description                |
| -------------------------------------------- | ------ | -------------------------- |
| `strategy.risk.allow_entry_in()`             | ✅     | Allow entry in             |
| `strategy.risk.max_cons_loss_days()`         | ✅     | Max consecutive loss days  |
| `strategy.risk.max_drawdown()`               | ✅     | Max drawdown               |
| `strategy.risk.max_intraday_filled_orders()` | ✅     | Max intraday filled orders |
| `strategy.risk.max_intraday_loss()`          | ✅     | Max intraday loss          |
| `strategy.risk.max_position_size()`          | ✅     | Max position size          |

### Notes

The entire `strategy.*` namespace is implemented and matches TV's surface 1:1. Of the 31 TV oracle scripts in `Automations/PineTS/pinescripts/strategy/`, 12 currently match TradingView to comparator-epsilon (precision 3, eps 0.001001). The remaining 18 produce valid output that diverges from TV in specific numeric fields — these are precision/semantics differences that need iterative refinement:

- **`strategy.margin_liquidation_price`** — PineTS uses a simple "equity hits zero" approximation; TV's broker liquidation formula differs in detail. Affects `account_props.pine`.
- **`strategy.convert_to_account` / `convert_to_symbol`** — conversion at the previous daily FX rate requires the host-provided `currencyRates` series (VIN-113); without it, same-currency = identity passthrough, cross-currency = `NaN`, and currency identity is string equality (TV may return `na` for `BTCUSDC`'s USDC vs USD). Affects `conversion.pine`.

- **OCA enforcement (cancel/reduce semantics)** — order objects carry `oca_name` / `oca_type` fields, but the engine does not yet auto-cancel or reduce siblings on fill. Deferred. Affects `oca_groups.pine`.
- **Commission rounding** — per-leg charges may differ from TV by sub-cent rounding in edge cases. Affects `commission_slippage.pine` and `commission_types.pine` in the second-decimal place.
- **Per-trade max_drawdown / max_runup** — PineTS tracks intra-bar high/low excursions, but TV's accounting includes the entry price's pre-fill open and exit-bar close in subtly different ways for trades that open and close in adjacent bars. Affects `closedtrades_full.pine`, `opentrades_full.pine`.

`oca_groups.pine` is the explicit Phase 7 deferral. All others are iteration items for follow-up work.
