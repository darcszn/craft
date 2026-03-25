import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateCustomizationConfig } from './validate';

// ── Arbitraries ───────────────────────────────────────────────────────────────

// Valid hex color: #RGB or #RRGGBB
const hexColorArb = fc.oneof(
  fc.hexaString({ minLength: 3, maxLength: 3 }).map(s => `#${s}`),
  fc.hexaString({ minLength: 6, maxLength: 6 }).map(s => `#${s}`)
);

// Valid CustomizationConfig with non-duplicate colors
const validConfigArb = fc.record({
  branding: fc.record({
    appName: fc.string({ minLength: 1, maxLength: 60 }),
    primaryColor: hexColorArb,
    secondaryColor: hexColorArb,
    fontFamily: fc.string({ minLength: 1 }),
  }).filter(b => b.primaryColor !== b.secondaryColor),
  features: fc.record({
    enableCharts: fc.boolean(),
    enableTransactionHistory: fc.boolean(),
    enableAnalytics: fc.boolean(),
    enableNotifications: fc.boolean(),
  }),
  stellar: fc.record({
    network: fc.constantFrom('mainnet', 'testnet') as fc.Arbitrary<'mainnet' | 'testnet'>,
    horizonUrl: fc.constant('https://horizon.stellar.org'),
  }).map(s => ({
    ...s,
    horizonUrl: s.network === 'mainnet'
      ? 'https://horizon.stellar.org'
      : 'https://horizon-testnet.stellar.org',
  })),
});

// Config with an invalid hex primaryColor (not matching /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
const invalidHexConfigArb = fc.tuple(
  validConfigArb,
  fc.string().filter(s => !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s))
).map(([config, badColor]) => ({
  ...config,
  branding: { ...config.branding, primaryColor: badColor },
}));

// Config with an invalid appName (empty or > 60 chars)
const badAppNameArb = fc.tuple(
  validConfigArb,
  fc.oneof(
    fc.constant(''),
    fc.string({ minLength: 61 })
  )
).map(([config, badName]) => ({
  ...config,
  branding: { ...config.branding, appName: badName },
}));

// Config with mainnet network but testnet horizonUrl
const mismatchConfigArb = validConfigArb.map(config => ({
  ...config,
  stellar: {
    ...config.stellar,
    network: 'mainnet' as const,
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
}));

// ── Concrete fixture ──────────────────────────────────────────────────────────

const validConfig = {
  branding: {
    appName: 'My DEX',
    primaryColor: '#abc',
    secondaryColor: '#def',
    fontFamily: 'Inter',
  },
  features: {
    enableCharts: true,
    enableTransactionHistory: false,
    enableAnalytics: false,
    enableNotifications: false,
  },
  stellar: {
    network: 'mainnet' as const,
    horizonUrl: 'https://horizon.stellar.org',
  },
};

// ── Unit tests ────────────────────────────────────────────────────────────────

describe('validateCustomizationConfig', () => {
  it('returns { valid: true, errors: [] } for a complete valid config', () => {
    const result = validateCustomizationConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns { valid: false } with field "branding.appName" when appName is empty', () => {
    const result = validateCustomizationConfig({
      ...validConfig,
      branding: { ...validConfig.branding, appName: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'branding.appName')).toBe(true);
  });

  it('returns { valid: false, code: "INVALID_STRING" } for invalid hex primaryColor', () => {
    const result = validateCustomizationConfig({
      ...validConfig,
      branding: { ...validConfig.branding, primaryColor: 'not-a-hex' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_STRING')).toBe(true);
  });

  it('returns { valid: false, code: "HORIZON_NETWORK_MISMATCH" } for mainnet + testnet URL', () => {
    const result = validateCustomizationConfig({
      ...validConfig,
      stellar: { network: 'mainnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'HORIZON_NETWORK_MISMATCH')).toBe(true);
  });

  it('returns { valid: false, code: "HORIZON_NETWORK_MISMATCH" } for testnet + mainnet URL', () => {
    const result = validateCustomizationConfig({
      ...validConfig,
      stellar: { network: 'testnet', horizonUrl: 'https://horizon.stellar.org' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'HORIZON_NETWORK_MISMATCH')).toBe(true);
  });

  it('returns { valid: false, code: "DUPLICATE_COLORS" } when primaryColor equals secondaryColor', () => {
    const result = validateCustomizationConfig({
      ...validConfig,
      branding: { ...validConfig.branding, primaryColor: '#abc', secondaryColor: '#abc' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'DUPLICATE_COLORS')).toBe(true);
  });

  it('returns { valid: false } for null input', () => {
    const result = validateCustomizationConfig(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns { valid: false } for empty object', () => {
    const result = validateCustomizationConfig({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns { valid: false } for non-object primitives', () => {
    for (const input of [42, 'string', true, undefined]) {
      const result = validateCustomizationConfig(input);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  // Feature: customization-payload-tests, Property 1: Valid configs always pass validation
  it('Property 1: valid configs always pass validation', () => {
    // Validates: Requirements 4.1, 4.8, 8.4
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const result = validateCustomizationConfig(config);
        return result.valid === true && result.errors.length === 0;
      }),
      { numRuns: 25 }
    );
  });

  // Feature: customization-payload-tests, Property 2: Invalid hex colors always fail validation
  it('Property 2: invalid hex colors always fail validation', () => {
    // Validates: Requirements 4.3, 8.2
    fc.assert(
      fc.property(invalidHexConfigArb, (config) => {
        const result = validateCustomizationConfig(config);
        return result.valid === false;
      }),
      { numRuns: 25 }
    );
  });

  // Feature: customization-payload-tests, Property 3: appName length invariant
  it('Property 3: appName length invariant', () => {
    // Validates: Requirements 4.2, 8.1
    fc.assert(
      fc.property(badAppNameArb, (config) => {
        const result = validateCustomizationConfig(config);
        return (
          result.valid === false &&
          result.errors.some(e => e.field === 'branding.appName')
        );
      }),
      { numRuns: 25 }
    );
  });

  // Feature: customization-payload-tests, Property 4: Network/URL mismatch invariant
  it('Property 4: network/URL mismatch invariant', () => {
    // Validates: Requirements 4.4, 8.3
    fc.assert(
      fc.property(mismatchConfigArb, (config) => {
        const result = validateCustomizationConfig(config);
        const mismatchErrors = result.errors.filter(e => e.code === 'HORIZON_NETWORK_MISMATCH');
        return result.valid === false && mismatchErrors.length === 1;
      }),
      { numRuns: 25 }
    );
  });

  // Feature: customization-payload-tests, Property 5: Validation is deterministic (idempotence)
  it('Property 5: validation is deterministic', () => {
    // Validates: Requirements 8.5
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const result1 = validateCustomizationConfig(input);
        const result2 = validateCustomizationConfig(input);
        return (
          result1.valid === result2.valid &&
          JSON.stringify(result1.errors) === JSON.stringify(result2.errors)
        );
      }),
      { numRuns: 25 }
    );
  });
});

