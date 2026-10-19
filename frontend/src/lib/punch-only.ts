// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT

/**
 * Someone whose only job on the appliance is to punch: not a SuperAdmin,
 * no admin or supervisor role anywhere, and an employee record somewhere.
 * They have no dashboard — `/` sends them to My time.
 */
export function isPunchOnlyUser(user: {
  roleGlobal: string;
  memberships: Array<{ role: string; isEmployee: boolean }>;
}): boolean {
  return (
    user.roleGlobal !== 'super_admin' &&
    user.memberships.some((m) => m.isEmployee) &&
    user.memberships.every((m) => m.role === 'employee')
  );
}
