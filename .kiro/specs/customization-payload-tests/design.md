# Design Document: customization-payload-tests

## Overview

This document describes the test design for the customization payload lifecycle in `apps/web`. The scope covers three Next.js route handlers and one pure utility function:

- `POST /api/drafts/[templateId]` and `GET /api/drafts/[templateId]` — save and load drafts by template
- `GET /api/drafts/deployment/[deploymentId]` — load a draft via deployment context
- `POST /api/customization/validate` — validate a payload without persisting it
- `normalizeDraftConfig` — pure function that fills missing fields with safe defaults

All tests are written in Vitest and co-located with the source files they test. The existing test files (`route.test.ts` files already present in the repo) already cover the core happy-path and rejection cases. This design documents the full intended test coverage, including the property-based tests for `normalizeDraftConfig`.

---

## Architecture

The system under test has three layers:

```
HTTP Layer (Next.js route handlers)
    │  uses withAuth() middleware for auth guard
    │  delegates to ↓
Service Layer (CustomizationDraftService)
    │  calls Supabase for persistence
    │  calls normalizeDraftConfig on read
    │
Validation Layer (validateCustomizationConfig)
    │  Zod schema parse → business rule checks
    │  returns { valid, errors[] }
```

Tests at the HTTP layer mock both `@/lib/supabase/server` and `@/services/customization-draft.service`. Tests at the service layer mock only `@/lib/supabase/server`. Tests for `normalizeDraftConfig` and `validateCustomizationConfig` are pure unit/property tests with no mocks.

---

## Components and Interfaces

### withAuth middleware

`@/lib/api/with-auth` wraps route handlers. It calls `createClient().auth.getUser()` and returns `401` if no user is found. All route tests must mock `@/lib/supabase/server` to control this behavior.

### validateCustomizationConfig

```ts
function validateCustomizationConfig(input: unknown): ValidationResult
// ValidationResult = { valid: boolean; errors: ValidationError[] }
// ValidationError  = { field: string; message: string; code: string }
```

Two-phase validation: Zod schema parse, then business rules (`HORIZON_NETWORK_MISMATCH`, `DUPLICATE_COLORS`).

### CustomizationDraftService

```ts
saveDraft(userId, templateId, config): Promise<CustomizationDraft>
getDraft(userId, templateId): Promise<CustomizationDraft | null>
getDraftByDeployment(userId, deploymentId): Promise<CustomizationDraft | null>
```

`saveDraft` throws `'Template not found'` for inactive/missing templates. `getDraftByDeployment` throws `'Forbidden'` when the deployment belongs to another user.

### normalizeDraftConfig

```ts
function normalizeDraftConfig(raw: unknown): CustomizationConfig
```

Pure function. Deep-merges `raw` over `DEFAULT_CONFIG`. Safe to call with `null`, `undefined`, or partial objects.

---

## Data Models

### CustomizationConfig

```ts
{
  branding: {
    appName: string;          // min 1, max 60
    logoUrl?: string;         // valid URL if present
    primaryColor: string;     // hex color (#rgb or #rrggbb)
    secondaryColor: string;   // hex color, must differ from primaryColor
    fontFamily: string;       // min 1
  };
  features: {
    enableCharts: boolean;
    enableTransactionHistory: boolean;
    enableAnalytics: boolean;
    enableNotifications: boolean;
  };
  stellar: {
    network: 'mainnet' | 'testnet';
    horizonUrl: string;       // valid URL; must match network
    sorobanRpcUrl?: string;   // valid URL if present
    assetPairs?: any[];
    contractAddresses?: Record<string, string>;
  };
}
```

### DEFAULT_CONFIG (used by normalizeDraftConfig)

```ts
{
  branding:  { appName: '', primaryColor: '#6366f1', secondaryColor: '#a5b4fc', fontFamily: 'Inter' },
  features:  { enableCharts: true, enableTransactionHistory: true, enableAnalytics: false, enableNotifications: false },
  stellar:   { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
}
```

### CustomizationDraft (DB row mapped)

```ts
{
  id: string;
  userId: string;
  templateId: string;
  customizationConfig: CustomizationConfig;
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Test File Structure

```
apps/web/src/
  app/api/
    customization/validate/
      route.ts
      route.test.ts                  ← validate route tests (Req 5, 6)
    drafts/
      [templateId]/
        route.ts
        route.test.ts                ← save/load by template (Req 1, 2, 3)
      deployment/[deploymentId]/
        route.ts
        route.test.ts                ← load by deployment (Req 4)
  lib/customization/
    validate.ts
    validate.test.ts                 ← unit tests for validateCustomizationConfig
    validate-network.property.test.ts ← existing PBT for network mapping
  services/
    customization-draft.service.ts
    customization-draft.service.test.ts  ← normalizeDraftConfig tests (Req 7)
    customization-draft.service.property.test.ts  ← PBT for normalization (Req 7.5)
```

---

## Mock Strategy

All route tests follow the same pattern already established in the codebase:

```ts
// 1. Mock Supabase (controls withAuth + any direct DB calls)
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser }, from: vi.fn() }),
}));

// 2. Mock the service (for route tests only)
const mockSaveDraft = vi.fn();
vi.mock('@/services/customization-draft.service', () => ({
  customizationDraftService: { saveDraft: mockSaveDraft, getDraft: vi.fn(), ... },
}));

// 3. Reset in beforeEach
beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: fakeUser }, error: null });
});
```

Service-layer tests (`customization-draft.service.test.ts`) mock only `@/lib/supabase/server` and test the real service logic. Pure function tests (`validate.test.ts`, `normalizeDraftConfig`) need no mocks.

---

## Shared Fixtures

Each test file defines its own local fixtures (consistent with the existing pattern). The canonical shapes are:

```ts
const fakeUser = { id: 'user-1', email: 'a@b.com' };

const validConfig = {
  branding: { appName: 'My DEX', primaryColor: '#000', secondaryColor: '#fff', fontFamily: 'Inter' },
  features: { enableCharts: true, enableTransactionHistory: false, enableAnalytics: false, enableNotifications: false },
  stellar: { network: 'testnet', horizonUrl: 'https://horizon-testnet.stellar.org' },
};

const fakeDraft = {
  id: 'draft-1',
  userId: 'user-1',
  templateId: 'tmpl-1',
  customizationConfig: validConfig,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
};
```

---

## Requirements-to-Tests Mapping

### Requirement 1 — Save Draft Happy Path → `drafts/[templateId]/route.test.ts`

| Criteria | Test case |
|---|---|
| 1.1 valid payload → 200 | `'saves and returns the draft on valid input'` |
| 1.2 response contains id and updatedAt | same test, asserts `body.id` and `body.updatedAt` |
| 1.3 saveDraft called with correct args | same test, `expect(mockSaveDraft).toHaveBeenCalledWith(userId, templateId, config)` |
| 1.4 upsert — saveDraft called once | `'overwrites an existing draft (upsert)'` |

### Requirement 2 — Save Draft Rejection → `drafts/[templateId]/route.test.ts`

| Criteria | Test case |
|---|---|
| 2.1 no auth → 401 | `'returns 401 when unauthenticated'` (POST describe) |
| 2.2 invalid JSON → 400 | `'returns 400 for invalid JSON'` |
| 2.3 invalid schema → 400 + details | `'returns 400 for invalid config shape'` |
| 2.4 template not found → 404 | `'returns 404 when template does not exist'` |
| 2.5 service throws → 500 | `'returns 500 on unexpected service error'` |

### Requirement 3 — Load Draft by Template → `drafts/[templateId]/route.test.ts`

| Criteria | Test case |
|---|---|
| 3.1 draft exists → 200 + id + templateId | `'returns the draft when it exists'` |
| 3.2 no draft → 404 | `'returns 404 when no draft exists'` |
| 3.3 no auth → 401 | `'returns 401 when unauthenticated'` (GET describe) |
| 3.4 service throws → 500 | `'returns 500 on service error'` |

### Requirement 4 — Load Draft by Deployment → `drafts/deployment/[deploymentId]/route.test.ts`

| Criteria | Test case |
|---|---|
| 4.1 draft exists, user owns deployment → 200 | `'returns the normalized draft on success'` |
| 4.2 no draft → 404 | `'returns 404 when no draft exists'` |
| 4.3 different user → 403 | `'returns 403 when deployment belongs to another user'` |
| 4.4 no auth → 401 | `'returns 401 when unauthenticated'` |
| 4.5 service throws → 500 | `'returns 500 on unexpected service error'` |

### Requirement 5 — Validate Acceptance → `customization/validate/route.test.ts`

| Criteria | Test case |
|---|---|
| 5.1 valid payload → 200 + `{ valid: true, errors: [] }` | `'returns 200 and valid:true for a correct config'` |
| 5.2 valid mainnet config → 200 | `'returns 200 for valid mainnet config'` |
| 5.3 optional logoUrl present → 200 | `'returns 200 when optional logoUrl is a valid URL'` |

### Requirement 6 — Validate Rejection → `customization/validate/route.test.ts`

| Criteria | Test case |
|---|---|
| 6.1 invalid JSON → 400 | `'returns 400 for invalid JSON'` |
| 6.2 empty appName → 422 + field | `'returns 422 and field errors for invalid config'` |
| 6.3 invalid hex color → 422 + field | `'returns 422 for invalid primaryColor'` |
| 6.4 mainnet + testnet URL → 422 + HORIZON_NETWORK_MISMATCH | `'returns 422 for business rule violation'` |
| 6.5 duplicate colors → 422 + DUPLICATE_COLORS | `'returns 422 for duplicate colors'` |
| 6.6 no auth → 401 | `'returns 401 when unauthenticated'` |

### Requirement 7 — Payload Normalization → `customization-draft.service.test.ts` + `.property.test.ts`

| Criteria | Test case |
|---|---|
| 7.1 missing branding → defaults filled | `'fills missing branding fields with defaults'` |
| 7.2 missing features → defaults filled | `'fills missing features with defaults'` |
| 7.3 missing stellar → testnet defaults | `'fills missing stellar with defaults'` |
| 7.4 null/undefined → full default config | `'handles null/undefined input gracefully'` |
| 7.5 round-trip property | Property 1 in `.property.test.ts` |

### Requirement 8 — Conventions

Enforced structurally: all test files use `vi`, `describe`, `it`, `expect`; mock `@/lib/supabase/server` via `vi.mock`; call `vi.clearAllMocks()` in `beforeEach`; construct requests with `NextRequest`; are co-located as `*.test.ts`.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Most acceptance criteria in this feature are concrete examples (specific inputs → specific outputs) rather than universal properties, because the requirements describe test cases rather than general system behaviors. Two criteria are genuinely universal and warrant property-based tests.

### Property 1: Normalization fills all missing sections with defaults

*For any* object that is missing one or more of the `branding`, `features`, or `stellar` sections (including `null` and `undefined`), calling `normalizeDraftConfig` must produce a `CustomizationConfig` where every field in the missing section equals the corresponding `DEFAULT_CONFIG` value.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

### Property 2: Normalization is idempotent on fully-populated configs

*For any* valid `CustomizationConfig` object where all required fields are present, `normalizeDraftConfig(config)` must return an object whose field values are identical to the input — i.e., `normalizeDraftConfig` is a no-op when no defaults need to be applied.

**Validates: Requirements 7.5**

---

## Error Handling

| Scenario | HTTP status | Response body |
|---|---|---|
| No authenticated user | 401 | `{ error: 'Unauthorized' }` (from withAuth) |
| Malformed JSON body | 400 | `{ error: 'Invalid JSON' }` |
| Schema validation failure (draft route) | 400 | `{ error: 'Invalid input', details: ValidationError[] }` |
| Schema/business rule failure (validate route) | 422 | `{ valid: false, errors: ValidationError[] }` |
| Template not found | 404 | `{ error: 'Template not found' }` |
| Draft not found | 404 | `{ error: 'Draft not found' }` |
| Deployment owned by another user | 403 | `{ error: 'Forbidden' }` |
| Unexpected service/DB error | 500 | `{ error: <message> }` |

Note: the draft route (`POST /api/drafts/[templateId]`) uses `400` for validation failures while the validate route (`POST /api/customization/validate`) uses `422`. This is intentional — the draft route treats validation as a bad request, while the validate route's entire purpose is to report structured validation results.

---

## Testing Strategy

### Unit Tests

Unit tests cover specific examples, edge cases, and error conditions. They are the primary vehicle for requirements 1–6 and 8. Each test constructs a concrete input, invokes the handler or function, and asserts on the output.

Key patterns:
- Route tests use `await import('./route')` inside each `it` block to pick up fresh module state after `vi.clearAllMocks()`
- Service mock return values are set per-test via `mockFn.mockResolvedValue(...)` or `mockFn.mockRejectedValue(...)`
- Auth is controlled by `mockGetUser.mockResolvedValue({ data: { user: null }, error: null })` for 401 cases

### Property-Based Tests

Property tests use `fast-check` (already a dependency, used in `validate-network.property.test.ts`) to verify universal properties across randomly generated inputs.

**File:** `apps/web/src/services/customization-draft.service.property.test.ts`

**Property 1 implementation** — generates partial configs (randomly omitting sections) and asserts defaults are filled:

```ts
// Feature: customization-payload-tests, Property 1: Normalization fills missing sections with defaults
fc.assert(
  fc.property(
    fc.record({
      branding: fc.option(fc.record({ appName: fc.string() }), { nil: undefined }),
      features: fc.option(fc.record({ enableCharts: fc.boolean() }), { nil: undefined }),
      stellar:  fc.option(fc.record({ network: fc.constantFrom('mainnet','testnet') }), { nil: undefined }),
    }),
    (partial) => {
      const result = normalizeDraftConfig(partial);
      if (!partial.branding) {
        expect(result.branding.primaryColor).toBe('#6366f1');
        expect(result.branding.fontFamily).toBe('Inter');
      }
      if (!partial.features) {
        expect(result.features.enableCharts).toBe(true);
      }
      if (!partial.stellar) {
        expect(result.stellar.network).toBe('testnet');
        expect(result.stellar.horizonUrl).toBe('https://horizon-testnet.stellar.org');
      }
    }
  ),
  { numRuns: 100 }
);
```

**Property 2 implementation** — generates fully-populated configs and asserts round-trip identity:

```ts
// Feature: customization-payload-tests, Property 2: Normalization is idempotent on fully-populated configs
fc.assert(
  fc.property(arbFullConfig, (config) => {
    const result = normalizeDraftConfig(config);
    expect(result.branding.appName).toBe(config.branding.appName);
    expect(result.branding.primaryColor).toBe(config.branding.primaryColor);
    expect(result.features.enableCharts).toBe(config.features.enableCharts);
    expect(result.stellar.network).toBe(config.stellar.network);
    expect(result.stellar.horizonUrl).toBe(config.stellar.horizonUrl);
  }),
  { numRuns: 100 }
);
```

**Configuration:**
- Minimum 100 iterations per property test (`numRuns: 100`)
- Each property test tagged with `// Feature: customization-payload-tests, Property N: <description>`
- Library: `fast-check` (`fc`) — already installed and used in the project
