'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'facts.js')).href);

test('dagens fun fact skifter hver dag og gentages først når alle er brugt', async () => {
  const { FACTS, factOfTheDay } = await load();
  const seen = new Set();
  for (let i = 0; i < FACTS.length; i++) seen.add(factOfTheDay(new Date(2026, 0, 1 + i)));
  assert.equal(seen.size, FACTS.length);
  assert.notEqual(factOfTheDay(new Date(2026, 0, 1)), factOfTheDay(new Date(2026, 0, 2)));
});

test('samme dag giver samme fact, uanset klokkeslæt', async () => {
  const { factOfTheDay } = await load();
  assert.equal(factOfTheDay(new Date(2026, 9, 9, 7, 0)), factOfTheDay(new Date(2026, 9, 9, 23, 59)));
});
