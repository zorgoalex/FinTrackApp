import assert from 'node:assert/strict';
import test from 'node:test';
import { getVerifiedTotpFactors, hasFreshTotpAal2, hasTotpAal2, normalizeTotpCode, totpQrCodeDataUrl } from '../src/utils/mfa.js';

test('fresh TOTP AAL2 requires a recent mfa/totp authentication method', () => {
  const now = 2_000_000_000;
  assert.equal(hasFreshTotpAal2({ currentLevel: 'aal1', currentAuthenticationMethods: [] }, now), false);
  assert.equal(hasFreshTotpAal2({ currentLevel: 'aal2', currentAuthenticationMethods: [{ method: 'mfa/totp', timestamp: now - 601 }] }, now), false);
  assert.equal(hasFreshTotpAal2({ currentLevel: 'aal2', currentAuthenticationMethods: [{ method: 'password', timestamp: now }] }, now), false);
  assert.equal(hasFreshTotpAal2({ currentLevel: 'aal2', currentAuthenticationMethods: [{ method: 'mfa/totp', timestamp: now - 600 }] }, now), true);
});

test('privileged access accepts TOTP AAL2 but rejects another AAL2 method', () => {
  assert.equal(hasTotpAal2({ currentLevel: 'aal2', currentAuthenticationMethods: [{ method: 'mfa/totp' }] }), true);
  assert.equal(hasTotpAal2({ currentLevel: 'aal2', currentAuthenticationMethods: [{ method: 'mfa/phone' }] }), false);
});

test('TOTP helpers keep only verified factors and normalize enrollment data', () => {
  const factors = [
    { id: 'verified', factor_type: 'totp', status: 'verified' },
    { id: 'pending', factor_type: 'totp', status: 'unverified' },
    { id: 'phone', factor_type: 'phone', status: 'verified' },
  ];
  assert.deepEqual(getVerifiedTotpFactors(factors).map((factor) => factor.id), ['verified']);
  assert.equal(normalizeTotpCode('12 3a4567'), '123456');
  assert.match(totpQrCodeDataUrl('<svg></svg>'), /^data:image\/svg\+xml;utf-8,/);
});
