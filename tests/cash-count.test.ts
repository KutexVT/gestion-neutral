import { test } from "node:test";
import assert from "node:assert/strict";
import { cashGroups, cashQuantity, cashTotal } from "../web/cash-count.js";
const all = cashGroups.flatMap(group => [...group.values]);
test("efectivo CRC: cantidades, mezcla de denominaciones y ceros", () => {
  assert.equal(cashTotal(all, {}), 0);
  assert.equal(cashTotal(all, { 500: "3" }), 1500);
  assert.equal(cashTotal(all, { 20000: "2", 1000: "1", 500: "3", 25: "4", 10: "2" }), 42620);
  assert.equal(cashTotal(all, Object.fromEntries(all.map(value => [value, "1000000"]))), 38685000000);
  assert.equal(cashQuantity("0003"), 3);
});
test("efectivo CRC: una cantidad inválida impide mostrar un total parcial", () => {
  for (const value of ["-1", "1.5", "1e3", "1000001", "10000000", "abc", "Infinity", " 3 "]) {
    assert.equal(cashQuantity(value), null, value);
    assert.equal(cashTotal(all, { 500: "3", 1000: value }), null, value);
  }
});
