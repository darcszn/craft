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

    // ── Contract address validation ────────────────────────────────────────────

    it('accepts config without contract addresses', () => {
        const result = validateCustomizationConfig(valid);
        expect(result.valid).toBe(true);
    });

    it('accepts config with valid contract addresses', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: {
                ...valid.stellar,
                contractAddresses: {
                    usdcContract: 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST',
                    nativeTokenContract: 'CATPNZ2SJRSVZJBWXGFSMZQHQ47JM5PXNQRVJLGHGHVKPZ2OVH3FHXP',
                },
            },
        });
        expect(result.valid).toBe(true);
    });

    it('returns error for invalid contract address (wrong length)', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: {
                ...valid.stellar,
                contractAddresses: {
                    badContract: 'CBQWI64FZ2NKSJC7D45HJZ',
                },
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe('stellar.contractAddresses.badContract');
        expect(result.errors[0].code).toBe('CONTRACT_ADDRESS_INVALID_LENGTH');
    });

    it('returns error for invalid contract address (wrong prefix)', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: {
                ...valid.stellar,
                contractAddresses: {
                    badContract: 'GBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7FFWVGNQST',
                },
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('CONTRACT_ADDRESS_INVALID_PREFIX');
    });

    it('returns error for contract with invalid characters', () => {
        const result = validateCustomizationConfig({
            ...valid,
            stellar: {
                ...valid.stellar,
                contractAddresses: {
                    badContract: 'CBQWI64FZ2NKSJC7D45HJZVVMQZ3T7KHXOJSLZPZ5LHKQM7-FWVGNQST',
                },
            },
        });
        expect(result.valid).toBe(false);
        expect(result.errors[0].code).toBe('CONTRACT_ADDRESS_INVALID_CHARSET');
    });
});

