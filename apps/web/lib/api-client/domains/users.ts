// api.users.*: owner Lane B. One method per endpoint in contracts/api/users.ts (13 §4).
import { usersEndpoints } from '@relay/contracts/api/users';
import { usersFixtures } from '@relay/contracts/fixtures/users';
import { teamAdminEndpoints as t } from '@relay/contracts/api/team-admin';
import { teamAdminFixtures as tf } from '@relay/contracts/fixtures/team-admin';
import { call, type CallInput, type CallOptions } from '../http';

export const users = {
  me: (opts?: CallOptions) => call('users', usersEndpoints.me, {}, () => usersFixtures.me(), opts),
  mySessions: (opts?: CallOptions) =>
    call('users', usersEndpoints.mySessions, {}, () => usersFixtures.mySessions(), opts),
  revokeMySession: (id: string, opts?: CallOptions) =>
    call(
      'users',
      usersEndpoints.revokeMySession,
      { params: { id } },
      () => usersFixtures.revokeMySession(),
      opts,
    ),
  list: (query: { cursor?: string; limit?: number } = {}, opts?: CallOptions) =>
    call('users', usersEndpoints.list, { query }, () => usersFixtures.list(), opts),
  get: (id: string, opts?: CallOptions) =>
    call('users', usersEndpoints.get, { params: { id } }, () => usersFixtures.get(), opts),
  // ── Team administration (T-103…T-105) ───────────────────────────────────
  invites: (opts?: CallOptions) => call('users', t.invites, {}, () => tf.invites(), opts),
  createInvite: (input: CallInput<typeof t.createInvite>, opts?: CallOptions) =>
    call('users', t.createInvite, input, () => tf.createInvite(), opts),
  revokeInvite: (input: CallInput<typeof t.revokeInvite>, opts?: CallOptions) =>
    call('users', t.revokeInvite, input, () => tf.revokeInvite(), opts),
  previewInvite: (input: CallInput<typeof t.previewInvite>, opts?: CallOptions) =>
    call('users', t.previewInvite, input, () => tf.previewInvite(), opts),
  acceptInvite: (input: CallInput<typeof t.acceptInvite>, opts?: CallOptions) =>
    call('users', t.acceptInvite, input, () => tf.acceptInvite(), opts),
  roles: (opts?: CallOptions) => call('users', t.roles, {}, () => tf.roles(), opts),
  createRole: (input: CallInput<typeof t.createRole>, opts?: CallOptions) =>
    call('users', t.createRole, input, () => tf.createRole(), opts),
  updateRole: (input: CallInput<typeof t.updateRole>, opts?: CallOptions) =>
    call('users', t.updateRole, input, () => tf.updateRole(), opts),
  deleteRole: (input: CallInput<typeof t.deleteRole>, opts?: CallOptions) =>
    call('users', t.deleteRole, input, () => tf.deleteRole(), opts),
  levelPermissions: (opts?: CallOptions) =>
    call('users', t.levelPermissions, {}, () => tf.levelPermissions(), opts),
  updateLevelPermissions: (input: CallInput<typeof t.updateLevelPermissions>, opts?: CallOptions) =>
    call('users', t.updateLevelPermissions, input, () => tf.updateLevelPermissions(), opts),
  overrides: (input: CallInput<typeof t.overrides>, opts?: CallOptions) =>
    call('users', t.overrides, input, () => tf.overrides(), opts),
  setOverrides: (input: CallInput<typeof t.setOverrides>, opts?: CallOptions) =>
    call('users', t.setOverrides, input, () => tf.setOverrides(), opts),
  update: (input: CallInput<typeof t.updateUser>, opts?: CallOptions) =>
    call('users', t.updateUser, input, () => tf.updateUser(), opts),
  deactivate: (input: CallInput<typeof t.deactivateUser>, opts?: CallOptions) =>
    call('users', t.deactivateUser, input, () => tf.deactivateUser(), opts),
  endSessions: (input: CallInput<typeof t.endUserSessions>, opts?: CallOptions) =>
    call('users', t.endUserSessions, input, () => tf.endUserSessions(), opts),
};
