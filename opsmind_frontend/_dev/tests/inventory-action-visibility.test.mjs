import test from 'node:test';
import assert from 'node:assert/strict';
import AuthService from '../../services/authService.js';

const user = (role, id = `${role.toLowerCase()}-1`) => ({
  id,
  role,
  technicianLevel: role,
});

test('Junior sees safe Inventory actions but not direct CMDB/destructive mutations', () => {
  const junior = user('JUNIOR');
  assert.equal(AuthService.canInventoryAction('view_history', junior), true);
  assert.equal(AuthService.canInventoryAction('ai_readonly', junior), true);
  assert.equal(AuthService.canInventoryAction('routine_maintenance', junior), true);
  assert.equal(AuthService.canInventoryAction('component_edit', junior), false);
  assert.equal(AuthService.canInventoryAction('component_replace', junior), false);
  assert.equal(AuthService.canInventoryAction('relationship_change', junior), false);
  assert.equal(AuthService.canInventoryAction('asset_disposition', junior), false);
});

test('Admin receives destructive Inventory actions and unknown roles receive none', () => {
  assert.equal(AuthService.canInventoryAction('component_remove', user('ADMIN')), true);
  assert.equal(AuthService.canInventoryAction('component_retire', user('ADMIN')), true);
  assert.equal(AuthService.canInventoryAction('asset_delete', user('ADMIN')), true);
  assert.equal(AuthService.canInventoryAction('view', user('MYSTERY_ROLE')), false);
});

test('Senior sees assigned Senior approval controls but requester does not', () => {
  const approval = {
    id: 'apr-1',
    status: 'PENDING',
    approverRole: 'SENIOR',
    requestedByUserId: 'junior-1',
  };
  assert.equal(AuthService.canDecideInventoryApproval(approval, user('SENIOR', 'senior-1')), true);
  assert.equal(AuthService.canDecideInventoryApproval(approval, user('JUNIOR', 'junior-1')), false);
  assert.equal(AuthService.canDecideInventoryApproval({
    ...approval,
    requestedByUserId: 'senior-1',
  }, user('SENIOR', 'senior-1')), false);
});
