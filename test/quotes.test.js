'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'public', 'quotes.js')).href);

test('dagens citat skifter hver dag og gentages først når alle er brugt', async () => {
  const { QUOTES, quoteOfTheDay } = await load();
  const seen = new Set();
  for (let i = 0; i < QUOTES.length; i++) seen.add(quoteOfTheDay(new Date(2026, 0, 1 + i)));
  assert.equal(seen.size, QUOTES.length);
  assert.notEqual(quoteOfTheDay(new Date(2026, 0, 1)), quoteOfTheDay(new Date(2026, 0, 2)));
});

test('samme dag giver samme citat, uanset klokkeslæt', async () => {
  const { quoteOfTheDay } = await load();
  assert.equal(quoteOfTheDay(new Date(2026, 9, 9, 7, 0)), quoteOfTheDay(new Date(2026, 9, 9, 23, 59)));
});

test('alle citater har tekst og afsender', async () => {
  const { QUOTES } = await load();
  for (const q of QUOTES) {
    assert.ok(q.text.trim() && q.author.trim(), JSON.stringify(q));
  }
});
