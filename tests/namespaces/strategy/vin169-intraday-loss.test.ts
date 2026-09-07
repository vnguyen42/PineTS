import { expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
// VIN-169: native BCHUSDT 240, 2026-09-07; cash15/21/25 and percent1.5.
const bars = [[1584230400000, 167.08, 170.0, 165.44, 166.88], [1584244800000, 166.96, 172.3, 166.96, 169.21], [1584259200000, 169.22, 179.0, 167.75, 174.86], [1584273600000, 174.85, 179.81, 170.07, 172.71], [1584288000000, 172.71, 176.56, 171.28, 174.93], [1584302400000, 174.95, 190.69, 170.94, 178.2], [1584316800000, 178.2, 184.41, 174.4, 179.61], [1584331200000, 179.63, 179.95, 158.0, 159.31], [1584345600000, 159.16, 164.84, 147.14, 150.85], [1584360000000, 150.85, 174.0, 150.04, 172.56], [1584374400000, 172.52, 176.0, 165.37, 168.46], [1584388800000, 168.39, 172.77, 162.67, 172.41], [1584403200000, 172.45, 184.64, 168.73, 180.1], [1584417600000, 179.97, 186.78, 176.31, 182.17], [1584432000000, 182.17, 187.59, 177.13, 180.81], [1584446400000, 180.88, 184.37, 172.67, 183.31], [1584460800000, 183.53, 186.9, 181.97, 184.54]];
const cashSource = `//@version=5
strategy("VIN169 intraday cash witness", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(15, strategy.cash)
if time == timestamp("UTC", 2020, 3, 15, 20, 0)
    strategy.entry("first", strategy.long, qty=1)
    strategy.entry("pending-150", strategy.long, qty=1, limit=150)
if time == timestamp("UTC", 2020, 3, 16, 12, 0)
    strategy.entry("same-day-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 0, 0)
    strategy.entry("next-day-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")`;
const cases = [
 {name: "cash", source: cashSource, trades: [
  ["first", 1584316800000, 178.2, 1584331200000, 158.0, 1.0, -20.2, 0.0, "Close Position (Max intraday Loss)"],
  ["pending-150", 1584345600000, 150.0, 1584432000000, 182.2, 1.0, 32.2, 0.0, "final"],
  ["next-day-attempt", 1584417600000, 180.0, 1584432000000, 182.2, 1.0, 2.2, 0.0, "final"],
 ], plots: {
  "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 0.0, 0.0, 0.0],
  "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1001.4, 979.8, 980.5999999999999, 1002.4, 998.3, 1002.1999999999999, 1009.9, 1014.2, 1014.2, 1014.2, 1014.2],
  "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, 14.200000000000017, 14.200000000000017, 14.200000000000017],
 }},
 {name: "percent", source: cashSource.replace("VIN169 intraday cash witness", "VIN169 intraday percent witness").replace("strategy.risk.max_intraday_loss(15, strategy.cash)", "strategy.risk.max_intraday_loss(1.5, strategy.percent_of_equity)"), trades: [
  ["first", 1584316800000, 178.2, 1584331200000, 158.0, 1.0, -20.2, 0.0, "Close Position (Max intraday Loss)"],
  ["pending-150", 1584345600000, 150.0, 1584432000000, 182.2, 1.0, 32.2, 0.0, "final"],
  ["next-day-attempt", 1584417600000, 180.0, 1584432000000, 182.2, 1.0, 2.2, 0.0, "final"],
 ], plots: {
  "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 2.0, 0.0, 0.0, 0.0],
  "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1001.4, 979.8, 980.5999999999999, 1002.4, 998.3, 1002.1999999999999, 1009.9, 1014.2, 1014.2, 1014.2, 1014.2],
  "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, 14.200000000000017, 14.200000000000017, 14.200000000000017],
 }},
 {name: "peak-cash21", source: cashSource.replace("VIN169 intraday cash witness", "VIN169 intraday peak cash21 witness").replace("strategy.risk.max_intraday_loss(15, strategy.cash)", "strategy.risk.max_intraday_loss(21, strategy.cash)"), trades: [
  ["first", 1584316800000, 178.2, 1584345600000, 147.1, 1.0, -31.1, 0.0, "Close Position (Max intraday Loss)"],
  ["pending-150", 1584345600000, 150.0, 1584345600000, 147.1, 1.0, -2.9, 0.0, "Close Position (Max intraday Loss)"],
  ["next-day-attempt", 1584417600000, 180.0, 1584432000000, 182.2, 1.0, 2.2, 0.0, "final"],
 ], plots: {
  "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
  "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1001.4, 981.1, 966.0, 966.0, 966.0, 966.0, 966.0, 968.2, 968.2, 968.2, 968.2],
  "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -34.00000000000003, -34.00000000000003, -34.00000000000003, -34.00000000000003, -34.00000000000003, -34.00000000000003, -31.80000000000001, -31.80000000000001, -31.80000000000001],
 }},
 {name: "peak-cash25", source: cashSource.replace("VIN169 intraday cash witness", "VIN169 intraday peak cash25 witness").replace("strategy.risk.max_intraday_loss(15, strategy.cash)", "strategy.risk.max_intraday_loss(25, strategy.cash)"), trades: [
  ["first", 1584316800000, 178.2, 1584345600000, 147.1, 1.0, -31.1, 0.0, "Close Position (Max intraday Loss)"],
  ["pending-150", 1584345600000, 150.0, 1584345600000, 147.1, 1.0, -2.9, 0.0, "Close Position (Max intraday Loss)"],
  ["next-day-attempt", 1584417600000, 180.0, 1584432000000, 182.2, 1.0, 2.2, 0.0, "final"],
 ], plots: {
  "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
  "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1001.4, 981.1, 966.0, 966.0, 966.0, 966.0, 966.0, 968.2, 968.2, 968.2, 968.2],
  "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -34.00000000000003, -34.00000000000003, -34.00000000000003, -34.00000000000003, -34.00000000000003, -34.00000000000003, -31.80000000000001, -31.80000000000001, -31.80000000000001],
 }},
];
// Native percent2.1 has the same register/plots as cash21, also excluding a close-price peak.
cases.push({...cases.find(c => c.name === 'peak-cash21')!, name: 'peak-percent21',
 source: cashSource.replace('VIN169 intraday cash witness', 'VIN169 intraday peak percent21 witness')
  .replace('max_intraday_loss(15, strategy.cash)', 'max_intraday_loss(2.1, strategy.percent_of_equity)'),
});
// Public source 1785 passes named arguments in this order.
cases.push({...cases[0], name: 'cash-named', source: cashSource.replace(
 'max_intraday_loss(15, strategy.cash)', 'max_intraday_loss(type=strategy.cash, value=15)',
)});
cases.push({name: "cof-cash", source: `//@version=5
strategy("VIN169 intraday COF cash witness", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=true, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(15, strategy.cash)
if time == timestamp("UTC", 2020, 3, 15, 20, 0)
    strategy.entry("first", strategy.long, qty=1)
    strategy.entry("pending-150", strategy.long, qty=1, limit=150)
if time == timestamp("UTC", 2020, 3, 16, 12, 0)
    strategy.entry("same-day-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 0, 0)
    strategy.entry("next-day-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")`, trades: [
 ["first", 1584316800000, 178.2, 1584331200000, 158.0, 1.0, -20.2, 0.0, "Close Position (Max intraday Loss)"],
 ["pending-150", 1584345600000, 150.0, 1584417600000, 180.0, 1.0, 30.0, 0.0, "final"],
 ["next-day-attempt", 1584417600000, 180.0, 1584417600000, 180.0, 1.0, 0.0, 0.0, "final"],
 ], plots: {
 "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0],
 "Equity": [1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1001.4, 979.8, 980.5999999999999, 1002.4, 998.3, 1002.1999999999999, 1009.9, 1009.8, 1009.8, 1009.8, 1009.8],
 "Net profit": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, -20.200000000000017, 9.799999999999983, 9.799999999999983, 9.799999999999983, 9.799999999999983],
 }});
cases.push({name: "overnight", source: `//@version=5
strategy("VIN169 overnight day-equity witness", overlay=true, initial_capital=1000, pyramiding=1, calc_on_order_fills=false, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(15, strategy.cash)
// Realize a gain on March 15, then carry a separate long across midnight.
if time == timestamp("UTC", 2020, 3, 15, 0, 0)
    strategy.entry("realized-gain", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 15, 8, 0)
    strategy.close("realized-gain")
if time == timestamp("UTC", 2020, 3, 15, 12, 0)
    strategy.entry("overnight", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 17, 4, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")`, trades: [
 ["realized-gain", 1584244800000, 167.0, 1584273600000, 174.8, 1.0, 7.8, 0.0, "Close entry(s) order realized-gain"],
 ["overnight", 1584288000000, 172.7, 1584331200000, 158.0, 1.0, -14.7, 0.0, "Close Position (Max intraday Loss)"],
 ], plots: {
 "Position": [0.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
 "Equity": [1000.0, 1002.2, 1007.9, 1007.8, 1010.0, 1013.3, 1014.6999999999999, 993.1, 993.1, 993.1, 993.1, 993.1, 993.1, 993.1, 993.1, 993.1, 993.1],
 "Net profit": [0.0, 0.0, 0.0, 7.800000000000011, 7.800000000000011, 7.800000000000011, 7.800000000000011, -6.900000000000006, -6.900000000000006, -6.900000000000006, -6.900000000000006, -6.900000000000006, -6.900000000000006, -6.900000000000006, -6.900000000000006, -6.900000000000006, -6.900000000000006],
 }});
cases.push({name: "exit-fee-poc", source: `//@version=5
strategy("VIN169 POC exit fee witness", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=false, process_orders_on_close=true, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.cash_per_order, commission_value=30, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(50, strategy.cash)
if time == timestamp("UTC", 2020, 3, 15, 0, 0)
    strategy.entry("first", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 15, 4, 0)
    strategy.close_all("exit-fee")
if time == timestamp("UTC", 2020, 3, 15, 8, 0)
    strategy.entry("after-exit-attempt", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 15, 16, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")`, trades: [
 ["first", 1584230400000, 166.9, 1584244800000, 169.2, 1.0, -57.7, 60.0, "exit-fee"],
 ["after-exit-attempt", 1584259200000, 174.9, 1584273600000, 174.8, 1.0, -60.1, 60.0, "Close Position (Max intraday Loss)"],
 ], plots: {
 "Position": [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
 "Equity": [1000.0, 972.3, 942.3, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2, 882.2],
 "Net profit": [0.0, -30.0, -57.69999999999999, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998, -117.79999999999998],
 }});
cases.push({name: "exit-fee-cof", source: `//@version=5
strategy("VIN169 COF exit fee witness", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=true, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.cash_per_order, commission_value=30, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(50, strategy.cash)
varip bool retried = false
if time == timestamp("UTC", 2020, 3, 15, 0, 0)
    strategy.entry("first", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 15, 4, 0)
    if strategy.position_size > 0
        strategy.close_all("exit-fee")
    if strategy.closedtrades > 0 and strategy.position_size == 0 and not retried
        strategy.entry("after-exit-attempt", strategy.long, qty=1)
        retried := true
if time == timestamp("UTC", 2020, 3, 15, 16, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")`, trades: [
 ["first", 1584244800000, 167.0, 1584244800000, 167.0, 1.0, -60.0, 60.0, "exit-fee"],
 ["after-exit-attempt", 1584244800000, 167.0, 1584244800000, 172.3, 1.0, -54.7, 60.0, "Close Position (Max intraday Loss)"],
 ], plots: {
 "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
 "Equity": [1000.0, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3, 885.3],
 "Net profit": [0.0, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999, -114.69999999999999],
 }});
cases.push({name: "exit-fee-cof-distinct", source: `//@version=5
strategy("VIN169 COF distinct tick exit fee witness", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=true, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.cash_per_order, commission_value=30, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(50, strategy.cash)
varip bool retried = false
if time == timestamp("UTC", 2020, 3, 15, 4, 0)
    strategy.entry("first", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 15, 8, 0)
    if strategy.position_size > 0
        strategy.close_all("exit-fee")
    if strategy.closedtrades > 0 and strategy.position_size == 0 and not retried
        strategy.entry("after-exit-attempt", strategy.long, qty=1)
        retried := true
if time == timestamp("UTC", 2020, 3, 15, 16, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")`, trades: [
 ["first", 1584259200000, 169.2, 1584259200000, 169.2, 1.0, -60.0, 60.0, "exit-fee"],
 ["after-exit-attempt", 1584259200000, 167.8, 1584259200000, 179.0, 1.0, -48.8, 60.0, "Close Position (Max intraday Loss)"],
 ], plots: {
 "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
 "Equity": [1000.0, 1000.0, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2],
 "Net profit": [0.0, 0.0, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001],
 }});
cases.push({name: "exit-fee-cof-control", source: `//@version=5
strategy("VIN169 COF distinct tick control witness", overlay=true, initial_capital=1000, pyramiding=10, calc_on_order_fills=true, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.cash_per_order, commission_value=30, margin_long=0, margin_short=0)
strategy.risk.max_intraday_loss(500, strategy.cash)
varip bool retried = false
if time == timestamp("UTC", 2020, 3, 15, 4, 0)
    strategy.entry("first", strategy.long, qty=1)
if time == timestamp("UTC", 2020, 3, 15, 8, 0)
    if strategy.position_size > 0
        strategy.close_all("exit-fee")
    if strategy.closedtrades > 0 and strategy.position_size == 0 and not retried
        strategy.entry("after-exit-attempt", strategy.long, qty=1)
        retried := true
if time == timestamp("UTC", 2020, 3, 15, 16, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")`, trades: [
 ["first", 1584259200000, 169.2, 1584259200000, 169.2, 1.0, -60.0, 60.0, "exit-fee"],
 ["after-exit-attempt", 1584259200000, 167.8, 1584259200000, 179.0, 1.0, -48.8, 60.0, "exit-fee"],
 ], plots: {
 "Position": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
 "Equity": [1000.0, 1000.0, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2, 891.2],
 "Net profit": [0.0, 0.0, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001, -108.80000000000001],
 }});
function provider() {
 return { configure() {}, getQtyStep() { return .0001; },
  async getMarketData() { return bars.map(([time,open,high,low,close])=>({openTime:time,closeTime:time+14_400_000-1,open,high,low,close,volume:1})); },
  async getSymbolInfo() { return {prefix:'BINANCE',ticker:'BCHUSDT',tickerid:'BINANCE:BCHUSDT',type:'crypto',currency:'USDT',basecurrency:'BCH',mintick:.1,pointvalue:1,mincontract:.0001,session:'24x7',timezone:'Etc/UTC'}; },
 };
}
for (const c of cases) it(`VIN-169 matches native ${c.name} liquidation, surviving pending order and daily reset`, async () => {
 const r = await new PineTS(provider() as any, 'BCHUSDT', '240').run(c.source);
 const trades = r.strategy!.closedtrades;
 expect(trades).toHaveLength(c.trades.length);
 expect(r.strategy!.opentrades).toHaveLength(0);
 c.trades.forEach((expected,i)=>{
  const t=trades[i];
  // TV synthesizes this label for strategy.close(id) without a comment;
  // the engine preserves close_<id> rather than that UI-generated string.
  const label = t.exit_comment ?? (t.exit_id === `close_${t.entry_id}` ? `Close entry(s) order ${t.entry_id}` : undefined);
  const actual=[t.entry_id,t.entry_time,t.entry_price,t.exit_time,t.exit_price,t.size,t.profit,t.commission,label];
  expected.forEach((v,j)=>typeof v==='number' ? expect(actual[j]).toBeCloseTo(v,9) : expect(actual[j]).toBe(v));
 });
 for (const [channel,expected] of Object.entries(c.plots)) {
  const actual=r.plots[channel].data.map(p=>p.value);
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v,i)=>expect(actual[i]).toBeCloseTo(v,9));
 }
});

// Native stop-fill-close-control-tv: the stop crosses LOW -> HIGH before
// the HIGH endpoint, so the subsequent close fills at that endpoint.
it('VIN-169 preserves the endpoint drain after a conditional crossing', async () => {
 const r = await new PineTS(provider() as any, 'BCHUSDT', '240').run(`//@version=5
strategy("VIN169 conditional fill close control", overlay=true, initial_capital=1000, pyramiding=1, calc_on_order_fills=true, process_orders_on_close=false, default_qty_type=strategy.fixed, default_qty_value=1, commission_type=strategy.commission.percent, commission_value=0, margin_long=0, margin_short=0)
if time == timestamp("UTC", 2020, 3, 15, 4, 0)
    strategy.entry("first", strategy.long, qty=1, stop=170)
if time == timestamp("UTC", 2020, 3, 15, 8, 0) and strategy.position_size > 0
    strategy.close_all("after-stop")
if time == timestamp("UTC", 2020, 3, 15, 16, 0)
    strategy.close_all("final")
plot(strategy.position_size, "Position")
plot(strategy.equity, "Equity")
plot(strategy.netprofit, "Net profit")
`);
 expect(r.strategy!.opentrades).toHaveLength(0);
 expect(r.strategy!.closedtrades).toHaveLength(1);
 const t = r.strategy!.closedtrades[0];
 expect([t.entry_time, t.entry_price, t.exit_time, t.exit_price, t.size, t.profit])
  .toEqual([1584259200000, 170, 1584259200000, 179, 1, 9]);
 expect(t.exit_comment).toBe('after-stop');
});
