import assert from 'node:assert/strict';
import test from 'node:test';

import { findOwnerEmail, getOwnerDisplay } from '../src/utils/workspaceOwner.js';

test('findOwnerEmail returns the real email of the Owner member', () => {
  assert.equal(findOwnerEmail([
    { role: 'Member', email: 'member@example.com' },
    { role: 'Owner', email: 'owner@example.com' },
  ]), 'owner@example.com');
});

test('getOwnerDisplay ignores legacy role placeholders from cached workspaces', () => {
  assert.equal(getOwnerDisplay({ ownerName: 'Владелец' }), '');
  assert.equal(getOwnerDisplay({ ownerName: 'Owner' }), '');
});

test('getOwnerDisplay prefers the resolved owner email', () => {
  assert.equal(getOwnerDisplay({
    ownerEmail: 'support@fintrackapp.vip',
    ownerName: 'Владелец',
  }), 'support@fintrackapp.vip');
});
