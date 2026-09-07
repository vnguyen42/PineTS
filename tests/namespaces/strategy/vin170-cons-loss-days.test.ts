import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
// Seven native BCH240 captures: oracle-archives/vin170-20260907.
const bars = [[1584144000000, 177.46, 180.4, 170.47, 178.44], [1584158400000, 178.4, 179.55, 171.71, 175.2], [1584172800000, 175.2, 176.29, 163.94, 172.12], [1584187200000, 172.03, 172.24, 166.39, 169.41], [1584201600000, 169.35, 173.56, 168.21, 171.23], [1584216000000, 171.32, 172.16, 164.0, 167.2], [1584230400000, 167.08, 170.0, 165.44, 166.88], [1584244800000, 166.96, 172.3, 166.96, 169.21], [1584259200000, 169.22, 179.0, 167.75, 174.86], [1584273600000, 174.85, 179.81, 170.07, 172.71], [1584288000000, 172.71, 176.56, 171.28, 174.93], [1584302400000, 174.95, 190.69, 170.94, 178.2], [1584316800000, 178.2, 184.41, 174.4, 179.61], [1584331200000, 179.63, 179.95, 158.0, 159.31], [1584345600000, 159.16, 164.84, 147.14, 150.85], [1584360000000, 150.85, 174.0, 150.04, 172.56], [1584374400000, 172.52, 176.0, 165.37, 168.46], [1584388800000, 168.39, 172.77, 162.67, 172.41], [1584403200000, 172.45, 184.64, 168.73, 180.1], [1584417600000, 179.97, 186.78, 176.31, 182.17], [1584432000000, 182.17, 187.59, 177.13, 180.81], [1584446400000, 180.88, 184.37, 172.67, 183.31], [1584460800000, 183.53, 186.9, 181.97, 184.54]];
function provider() {
 return { configure() {}, getQtyStep() { return .0001; },
  async getMarketData() { return bars.map(([time,open,high,low,close])=>({openTime:time,closeTime:time+14_400_000-1,open,high,low,close,volume:1})); },
  async getSymbolInfo() { return {prefix:'BINANCE',ticker:'BCHUSDT',tickerid:'BINANCE:BCHUSDT',type:'crypto',currency:'USDT',basecurrency:'BCH',mintick:.1,pointvalue:1,mincontract:.0001,session:'24x7',timezone:'Etc/UTC'}; },
 };
}
const cases = [
  {
    "name": "carried-pending",
    "source": "//@version=5\nstrategy(\"VIN170 carried position and pending order\", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)\nstrategy.risk.max_cons_loss_days(2)\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0)\n    strategy.entry(\"loss-one\", strategy.short, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0)\n    strategy.close_all(\"close-one\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.entry(\"loss-two\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    strategy.close_all(\"close-two\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 16, 0)\n    strategy.entry(\"carried\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 20, 0)\n    strategy.entry(\"pending-170\", strategy.long, qty=1, limit=170)\nif time == timestamp(\"UTC\", 2020, 3, 17, 0, 0)\n    strategy.entry(\"next-day-attempt\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"final\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\n",
    "trades": [
      [
        1584259200000,
        169.2,
        1584273600000,
        174.8,
        1.0
      ],
      [
        1584331200000,
        179.6,
        1584345600000,
        159.2,
        1.0
      ],
      [
        1584388800000,
        168.4,
        1584403200000,
        172.4,
        1.0
      ],
      [
        1584403200000,
        170.0,
        null,
        null,
        1.0
      ]
    ],
    "plots": {
      "Position": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0,
        1.0
      ],
      "Equity": [
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        994.3,
        994.4,
        994.4,
        994.4,
        994.4,
        974.0999999999999,
        974.0,
        974.0,
        974.0,
        978.0,
        988.1,
        990.2,
        988.8,
        991.3,
        992.5
      ],
      "Net profit": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        -22.0,
        -22.0,
        -22.0,
        -22.0,
        -22.0
      ]
    }
  },
  {
    "name": "carried-profit-offset",
    "source": "//@version=5\nstrategy(\"VIN170 floating gain versus realized day loss\", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)\nstrategy.risk.max_cons_loss_days(2)\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0)\n    strategy.entry(\"loss-one\", strategy.short, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0)\n    strategy.close_all(\"close-one\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.entry(\"loss-two\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    strategy.close_all(\"close-two\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 16, 0)\n    strategy.entry(\"carried\", strategy.long, qty=10)\nif time == timestamp(\"UTC\", 2020, 3, 16, 20, 0)\n    strategy.entry(\"pending-170\", strategy.long, qty=1, limit=170)\nif time == timestamp(\"UTC\", 2020, 3, 17, 0, 0)\n    strategy.entry(\"next-day-attempt\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"final\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\n",
    "trades": [
      [
        1584259200000,
        169.2,
        1584273600000,
        174.8,
        1.0
      ],
      [
        1584331200000,
        179.6,
        1584345600000,
        159.2,
        1.0
      ],
      [
        1584388800000,
        168.4,
        1584432000000,
        182.2,
        10.0
      ],
      [
        1584403200000,
        170.0,
        1584432000000,
        182.2,
        1.0
      ],
      [
        1584417600000,
        180.0,
        1584432000000,
        182.2,
        1.0
      ]
    ],
    "plots": {
      "Position": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        10.0,
        11.0,
        12.0,
        0.0,
        0.0,
        0.0
      ],
      "Equity": [
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        994.3,
        994.4,
        994.4,
        994.4,
        994.4,
        974.0999999999999,
        974.0,
        974.0,
        974.0,
        1014.0,
        1101.1000000000004,
        1126.4,
        1126.4,
        1126.4,
        1126.4
      ],
      "Net profit": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        126.40000000000015,
        126.40000000000015,
        126.40000000000015
      ]
    }
  },
  {
    "name": "distinct-days",
    "source": "//@version=5\nstrategy(\"VIN170 two losses distinct days\", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)\nstrategy.risk.max_cons_loss_days(2)\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0)\n    strategy.entry(\"loss-one\", strategy.short, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0)\n    strategy.close_all(\"close-one\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.entry(\"loss-two\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    strategy.close_all(\"close-two\")\nif time == timestamp(\"UTC\", 2020, 3, 17, 0, 0)\n    strategy.entry(\"next-day-attempt\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"final\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\n",
    "trades": [
      [
        1584259200000,
        169.2,
        1584273600000,
        174.8,
        1.0
      ],
      [
        1584331200000,
        179.6,
        1584345600000,
        159.2,
        1.0
      ]
    ],
    "plots": {
      "Position": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
      ],
      "Equity": [
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        994.3,
        994.4,
        994.4,
        994.4,
        994.4,
        974.0999999999999,
        974.0,
        974.0,
        974.0,
        974.0,
        974.0,
        974.0,
        974.0,
        974.0,
        974.0
      ],
      "Net profit": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        -26.0,
        -26.0
      ]
    }
  },
  {
    "name": "empty-day-between-losses",
    "source": "//@version=5\nstrategy(\"VIN170 empty day between losing days\", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)\nstrategy.risk.max_cons_loss_days(2)\n// BCHUSDT 240, UTC. Orders fill at the following open.\n// March 14: long 178.4 -> 175.2, loss 3.2. Flat all March 15.\n// March 16: long 179.6 -> 159.2, loss 20.4.\n// Observe whether the empty calendar day breaks the losing-day sequence.\nif time == timestamp(\"UTC\", 2020, 3, 14, 0, 0)\n    strategy.entry(\"loss-before-empty-day\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 14, 4, 0)\n    strategy.close_all(\"close-first-loss\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.entry(\"loss-after-empty-day\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    strategy.close_all(\"close-second-loss\")\nif time == timestamp(\"UTC\", 2020, 3, 17, 0, 0)\n    strategy.entry(\"march17-admission-test\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"final\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\n",
    "trades": [
      [
        1584158400000,
        178.4,
        1584172800000,
        175.2,
        1.0
      ],
      [
        1584331200000,
        179.6,
        1584345600000,
        159.2,
        1.0
      ],
      [
        1584417600000,
        180.0,
        1584432000000,
        182.2,
        1.0
      ]
    ],
    "plots": {
      "Position": [
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0
      ],
      "Equity": [
        1000.0,
        996.8,
        996.8,
        996.8,
        996.8,
        996.8,
        996.8,
        996.8,
        996.8,
        996.8,
        996.8,
        996.8,
        996.8,
        976.5,
        976.4,
        976.4,
        976.4,
        976.4,
        976.4,
        978.6,
        978.6,
        978.6,
        978.6
      ],
      "Net profit": [
        0.0,
        0.0,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -3.1999999999999886,
        -23.599999999999994,
        -23.599999999999994,
        -23.599999999999994,
        -23.599999999999994,
        -23.599999999999994,
        -23.599999999999994,
        -21.399999999999977,
        -21.399999999999977,
        -21.399999999999977
      ]
    }
  },
  {
    "name": "same-day",
    "source": "//@version=5\nstrategy(\"VIN170 two losses same day\", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)\nstrategy.risk.max_cons_loss_days(2)\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.entry(\"loss-one\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    strategy.close_all(\"close-one\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 8, 0)\n    strategy.entry(\"loss-two\", strategy.short, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 12, 0)\n    strategy.close_all(\"close-two\")\nif time == timestamp(\"UTC\", 2020, 3, 17, 0, 0)\n    strategy.entry(\"next-day-attempt\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"final\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\n",
    "trades": [
      [
        1584331200000,
        179.6,
        1584345600000,
        159.2,
        1.0
      ],
      [
        1584360000000,
        150.8,
        1584374400000,
        172.5,
        1.0
      ],
      [
        1584417600000,
        180.0,
        1584432000000,
        182.2,
        1.0
      ]
    ],
    "plots": {
      "Position": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        -1.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0
      ],
      "Equity": [
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        979.7,
        979.6,
        957.8,
        957.9,
        957.9,
        957.9,
        960.1,
        960.1,
        960.1,
        960.1
      ],
      "Net profit": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -20.400000000000006,
        -20.400000000000006,
        -42.099999999999994,
        -42.099999999999994,
        -42.099999999999994,
        -42.099999999999994,
        -39.89999999999998,
        -39.89999999999998,
        -39.89999999999998
      ]
    }
  },
  {
    "name": "win-between-losses-negative-day",
    "source": "//@version=5\nstrategy(\"VIN170 winning trade inside losing day\", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)\nstrategy.risk.max_cons_loss_days(2)\n// BCHUSDT 240, UTC. No overlapping positions, no commission.\n// March 15: short 169.2 -> 174.8, loss 5.6.\n// Planned March 16 closes: short4 178.2 -> 179.6 (-5.6),\n// short1 159.2 -> 150.8 (+8.4), long1 172.5 -> 168.4 (-4.1).\n// Day net is -1.3 despite the intervening win. Check all three fills first:\n// an earlier halt would instead identify when the daily limit takes effect.\n// If all three execute, March 17 distinguishes net losing days from a\n// streak reset by the individual winning trade. Neither result is assumed.\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0)\n    strategy.entry(\"previous-losing-day\", strategy.short, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0)\n    strategy.close_all(\"close-previous-day\")\nif time == timestamp(\"UTC\", 2020, 3, 15, 20, 0)\n    strategy.entry(\"march16-first-loss\", strategy.short, qty=4)\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.close_all(\"close-first-loss\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    strategy.entry(\"march16-intervening-win\", strategy.short, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 8, 0)\n    strategy.close_all(\"close-winning-trade\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 12, 0)\n    strategy.entry(\"march16-last-loss\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 16, 0)\n    strategy.close_all(\"close-last-loss\")\nif time == timestamp(\"UTC\", 2020, 3, 17, 0, 0)\n    strategy.entry(\"march17-admission-test\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"final\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\n",
    "trades": [
      [
        1584259200000,
        169.2,
        1584273600000,
        174.8,
        1.0
      ],
      [
        1584316800000,
        178.2,
        1584331200000,
        179.6,
        4.0
      ],
      [
        1584345600000,
        159.2,
        1584360000000,
        150.8,
        1.0
      ],
      [
        1584374400000,
        172.5,
        1584388800000,
        168.4,
        1.0
      ]
    ],
    "plots": {
      "Position": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -1.0,
        0.0,
        0.0,
        0.0,
        -4.0,
        0.0,
        -1.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
      ],
      "Equity": [
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        994.3,
        994.4,
        994.4,
        994.4,
        988.8,
        988.8,
        997.1999999999999,
        997.2,
        993.2,
        993.1,
        993.1,
        993.1,
        993.1,
        993.1,
        993.1
      ],
      "Net profit": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -11.200000000000017,
        -11.200000000000017,
        -2.8000000000000114,
        -2.8000000000000114,
        -6.900000000000006,
        -6.900000000000006,
        -6.900000000000006,
        -6.900000000000006,
        -6.900000000000006,
        -6.900000000000006
      ]
    }
  },
  {
    "name": "win-between-losses-positive-day",
    "source": "//@version=5\nstrategy(\"VIN170 winning trade inside positive day\", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)\nstrategy.risk.max_cons_loss_days(2)\n// BCHUSDT 240, UTC. No overlapping positions, no commission.\n// March 15: short 169.2 -> 174.8, loss 5.6.\n// Planned March 16 closes: short3 178.2 -> 179.6 (-4.2),\n// short1 159.2 -> 150.8 (+8.4), long1 172.5 -> 168.4 (-4.1).\n// Day net is +0.1 despite the intervening win. Check all three fills first:\n// an earlier halt would instead identify when the daily limit takes effect.\n// If all three execute, March 17 distinguishes net losing days from a\n// streak reset by the individual winning trade. Neither result is assumed.\nif time == timestamp(\"UTC\", 2020, 3, 15, 4, 0)\n    strategy.entry(\"previous-losing-day\", strategy.short, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 15, 8, 0)\n    strategy.close_all(\"close-previous-day\")\nif time == timestamp(\"UTC\", 2020, 3, 15, 20, 0)\n    strategy.entry(\"march16-first-loss\", strategy.short, qty=3)\nif time == timestamp(\"UTC\", 2020, 3, 16, 0, 0)\n    strategy.close_all(\"close-first-loss\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 4, 0)\n    strategy.entry(\"march16-intervening-win\", strategy.short, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 8, 0)\n    strategy.close_all(\"close-winning-trade\")\nif time == timestamp(\"UTC\", 2020, 3, 16, 12, 0)\n    strategy.entry(\"march16-last-loss\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 16, 16, 0)\n    strategy.close_all(\"close-last-loss\")\nif time == timestamp(\"UTC\", 2020, 3, 17, 0, 0)\n    strategy.entry(\"march17-admission-test\", strategy.long, qty=1)\nif time == timestamp(\"UTC\", 2020, 3, 17, 4, 0)\n    strategy.close_all(\"final\")\nplot(strategy.position_size, \"Position\")\nplot(strategy.equity, \"Equity\")\nplot(strategy.netprofit, \"Net profit\")\n",
    "trades": [
      [
        1584259200000,
        169.2,
        1584273600000,
        174.8,
        1.0
      ],
      [
        1584316800000,
        178.2,
        1584331200000,
        179.6,
        3.0
      ],
      [
        1584345600000,
        159.2,
        1584360000000,
        150.8,
        1.0
      ],
      [
        1584374400000,
        172.5,
        1584388800000,
        168.4,
        1.0
      ],
      [
        1584417600000,
        180.0,
        1584432000000,
        182.2,
        1.0
      ]
    ],
    "plots": {
      "Position": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -1.0,
        0.0,
        0.0,
        0.0,
        -3.0,
        0.0,
        -1.0,
        0.0,
        1.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0
      ],
      "Equity": [
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        1000.0,
        994.3,
        994.4,
        994.4,
        994.4,
        990.1999999999999,
        990.2,
        998.6,
        998.6,
        994.6,
        994.5,
        994.5,
        996.7,
        996.7,
        996.7,
        996.7
      ],
      "Net profit": [
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -5.599999999999994,
        -9.800000000000011,
        -9.800000000000011,
        -1.4000000000000057,
        -1.4000000000000057,
        -5.5,
        -5.5,
        -5.5,
        -3.299999999999983,
        -3.299999999999983,
        -3.299999999999983
      ]
    }
  }
];
for (const c of cases) it(`VIN170 native ${c.name}`, async () => {
 const r = await new PineTS(provider() as any, 'BCHUSDT', '240').run(c.source);
 const closed=c.trades.filter(t=>t[2]!==null), open=c.trades.filter(t=>t[2]===null);
 expect(r.strategy!.closedtrades).toHaveLength(closed.length);
 expect(r.strategy!.opentrades).toHaveLength(open.length);
 for(const [actual,expected] of [[r.strategy!.closedtrades,closed],[r.strategy!.opentrades,open]] as const) expected.forEach((e,i)=>{
  const t=actual[i]; const values=[t.entry_time,t.entry_price,t.exit_time,t.exit_price,Math.abs(t.size)];
  e.forEach((v,j)=>{if(v!==null) expect(values[j]).toBeCloseTo(v,9)});
 });
 for(const [key,values] of Object.entries(c.plots)) values.forEach((v,i)=>expect(r.plots[key].data[i].value).toBeCloseTo(v,9));
});

it('VIN170 retains initial capital before first-bar POC fees', async () => {
 const firstDay = provider();
 const feed = {...firstDay, async getMarketData() { return (await firstDay.getMarketData()).slice(0, 1); }};
 const r = await new PineTS(feed as any, 'BCHUSDT', '240').run(`//@version=5
strategy("First-bar daily equity", initial_capital=1000, process_orders_on_close=true, commission_type=strategy.commission.cash_per_order, commission_value=30, margin_long=0, margin_short=0)
strategy.risk.max_cons_loss_days(1)
strategy.entry("L", strategy.long, qty=1)`);
 expect(r.strategy!._cons_loss_days!.startEquity).toBe(1000);
 expect(r.strategy!._cons_loss_days!.endEquity).toBeCloseTo(970, 9);
});

it("VIN170 native COF boundary recalculates after forced closure", async () => {
 const r = await new PineTS(provider() as any, "BCHUSDT", "240").run(`//@version=5
strategy("VIN170 COF day-boundary evaluations", overlay=true, initial_capital=1000, pyramiding=1, calc_on_order_fills=true, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)
strategy.risk.max_cons_loss_days(2)
// Stops preserve both losing days without a market close on an entry recalculation.
if time == timestamp("UTC", 2020, 3, 15, 4, 0)
    strategy.entry("loss-one", strategy.short, qty=1)
    strategy.exit("stop-one", from_entry="loss-one", stop=174.8)
if time == timestamp("UTC", 2020, 3, 16, 0, 0)
    strategy.entry("loss-two", strategy.long, qty=1)
    strategy.exit("stop-two", from_entry="loss-two", stop=159.2)
if time == timestamp("UTC", 2020, 3, 16, 16, 0)
    strategy.entry("carried", strategy.long, qty=1)
// No other order can fill on this bar; count every execution of its script.
varip int boundaryEvaluations = 0
if time == timestamp("UTC", 2020, 3, 17, 0, 0)
    boundaryEvaluations += 1
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")
plot(boundaryEvaluations, "Boundary evaluations")
`);
 const expected = {"Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0], "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 994.4, 994.4, 994.4, 994.4, 994.4, 974.0, 974.0, 974.0, 974.0, 978.0, 978.0, 978.0, 978.0, 978.0, 978.0], "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -5.599999999999994, -5.599999999999994, -5.599999999999994, -5.599999999999994, -5.599999999999994, -26.0, -26.0, -26.0, -26.0, -26.0, -22.0, -22.0, -22.0, -22.0, -22.0], "Boundary evaluations": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 2.0, 2.0, 2.0, 2.0, 2.0]};
 for (const [key, values] of Object.entries(expected)) values.forEach((v,i)=>expect(r.plots[key].data[i].value).toBeCloseTo(v,9));
 expect(r.strategy!.closedtrades).toHaveLength(3);
 expect(r.strategy!.opentrades).toHaveLength(0);
 expect(r.strategy!.netprofit).toBeCloseTo(-22,9);
});
