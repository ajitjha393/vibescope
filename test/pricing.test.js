import test from 'node:test'
import assert from 'node:assert/strict'
import { ratesFor, estimateCost } from '../src/pricing.js'

test('rates match by model-id substring, most specific first', () => {
  assert.equal(ratesFor('claude-opus-4-8').input, 5)
  assert.equal(ratesFor('claude-opus-4-8').output, 25)
  assert.equal(ratesFor('claude-fable-5').input, 10)
  assert.equal(ratesFor('claude-sonnet-5').input, 3)
  assert.equal(ratesFor('claude-haiku-4-5-20251001').input, 1)
  // unknown models fall back instead of throwing
  assert.equal(ratesFor('some-future-model').input, 5)
})

test('plain input/output tokens price at base rates', () => {
  assert.equal(estimateCost({ input_tokens: 1_000_000 }, 'claude-opus-4-8'), 5)
  assert.equal(estimateCost({ output_tokens: 1_000_000 }, 'claude-opus-4-8'), 25)
})

test('cache reads bill at 0.1x input', () => {
  assert.equal(estimateCost({ cache_read_input_tokens: 1_000_000 }, 'claude-opus-4-8'), 0.5)
})

test('cache writes split by TTL: 1.25x for 5m, 2x for 1h', () => {
  const fiveMin = estimateCost(
    { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 1_000_000, ephemeral_1h_input_tokens: 0 } },
    'claude-opus-4-8',
  )
  const oneHour = estimateCost(
    { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1_000_000 } },
    'claude-opus-4-8',
  )
  assert.equal(fiveMin, 6.25)
  assert.equal(oneHour, 10)
})

test('cache writes without a TTL breakdown assume 5m', () => {
  assert.equal(estimateCost({ cache_creation_input_tokens: 1_000_000 }, 'claude-opus-4-8'), 6.25)
})

test('missing usage costs nothing', () => {
  assert.equal(estimateCost(null, 'claude-opus-4-8'), 0)
})
