import test from 'node:test';
import assert from 'node:assert/strict';

import { clamp, computeNutritionFromPer100g, roundTo, safeNumber } from './math.js';

test('safeNumber returns fallback for invalid input', () => {
  assert.equal(safeNumber('abc', 3), 3);
  assert.equal(safeNumber(undefined), 0);
  assert.equal(safeNumber('2.5'), 2.5);
});

test('roundTo rounds to requested decimals', () => {
  assert.equal(roundTo(1.234, 2), 1.23);
  assert.equal(roundTo(1.235, 2), 1.24);
});

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 4), 4);
  assert.equal(clamp(-2, 0, 4), 0);
  assert.equal(clamp(3, 0, 4), 3);
});

test('computeNutritionFromPer100g scales macros', () => {
  const out = computeNutritionFromPer100g({ kcal100g: 200, p100g: 10, c100g: 20, f100g: 5 }, 150);
  assert.deepEqual(out, { kcal: 300, p: 15, c: 30, f: 7.5 });
});
