# QuickBooks Online Payroll export

QBO Payroll imports time activity per (employee, service item, pay
date). Vibe PT emits one row per employee per job — if an employee
worked multiple jobs in the period, they get multiple rows.

## Columns

| Column        | Value                                            |
| ------------- | ------------------------------------------------ |
| EmployeeName  | `first_name + ' ' + last_name`                   |
| EmployeeEmail | `employees.email` (blank if not on file)         |
| ServiceItem   | `jobs.code` for the row's job (blank for "none") |
| RegularHours  | Pro-rated regular hours for this job             |
| OvertimeHours | Pro-rated overtime hours for this job            |
| PayDate       | Period end (YYYY-MM-DD)                          |
| Memo          | "Vibe PT pay period YYYY-MM-DD"                  |

## Pro-ration

Vibe PT attributes a worker's regular + overtime split at the
employee-period level, not per-job. When splitting hours across jobs
for QBO:

- Regular hours are allocated to each job proportionally to that
  job's share of work seconds.
- Overtime hours are allocated the same way.
- Rounding leftovers land on the last job to guarantee the total
  matches the employee's period total.

Firms that want QBO to track OT on specific jobs should fine-tune in
QBO after import.

## Verification

QBO Payroll's time-activity CSV template varies across editions
(Essentials, Plus, Advanced). Validate against the "Import
timesheets" template from the target firm's QBO before production
use.
