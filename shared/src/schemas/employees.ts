import { z } from 'zod';

export const employeeSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  userId: z.number().int().positive().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  employeeNumber: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  status: z.enum(['active', 'terminated']),
  hiredAt: z.string().nullable(),
  terminatedAt: z.string().datetime().nullable(),
  hasPin: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Employee = z.infer<typeof employeeSchema>;

export const createEmployeeRequestSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  employeeNumber: z.string().max(50).optional(),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(32).optional(),
  hiredAt: z.string().date().optional(),
  /** If true, generate a PIN on creation; the one-time plaintext comes back
   *  in the response so the admin can hand it to the employee. */
  generatePin: z.boolean().default(true),
  pinLength: z.number().int().min(4).max(6).default(6),
});
export type CreateEmployeeRequest = z.infer<typeof createEmployeeRequestSchema>;

export const updateEmployeeRequestSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  employeeNumber: z.string().max(50).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  hiredAt: z.string().date().nullable().optional(),
  status: z.enum(['active', 'terminated']).optional(),
});
export type UpdateEmployeeRequest = z.infer<typeof updateEmployeeRequestSchema>;

/** Create-with-PIN response exposes the plaintext PIN once. */
export const employeeWithPinResponseSchema = z.object({
  employee: employeeSchema,
  plaintextPin: z.string().optional(),
});
export type EmployeeWithPinResponse = z.infer<typeof employeeWithPinResponseSchema>;

export const csvImportRequestSchema = z.object({
  csv: z.string().min(1).max(1_000_000),
  generatePins: z.boolean().default(true),
  pinLength: z.number().int().min(4).max(6).default(6),
});
export type CsvImportRequest = z.infer<typeof csvImportRequestSchema>;

export const csvImportResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      row: z.number().int().positive(),
      message: z.string(),
    }),
  ),
  employees: z.array(
    z.object({
      employee: employeeSchema,
      plaintextPin: z.string().optional(),
    }),
  ),
});
export type CsvImportResponse = z.infer<typeof csvImportResponseSchema>;

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export const membershipSchema = z.object({
  id: z.number().int().positive(),
  userId: z.number().int().positive(),
  companyId: z.number().int().positive(),
  email: z.string().email(),
  role: z.enum(['company_admin', 'supervisor', 'employee']),
  createdAt: z.string().datetime(),
});
export type Membership = z.infer<typeof membershipSchema>;

export const inviteMembershipRequestSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(['company_admin', 'supervisor', 'employee']),
  /** If the email is new to the appliance, a user account is created with
   *  this initial password. The admin communicates it out-of-band. */
  initialPassword: z.string().min(12).max(256).optional(),
});
export type InviteMembershipRequest = z.infer<typeof inviteMembershipRequestSchema>;
