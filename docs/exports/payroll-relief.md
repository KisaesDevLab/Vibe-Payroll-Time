# Payroll Relief export

Payroll Relief (Thomson Reuters CS Professional Suite) accepts a
per-employee hours CSV as part of its batch import. Vibe PT's
`payroll_relief` format emits one row per employee with regular and
overtime hours for the pay period.

## Columns

| Column        | Type | Source                                           |
| ------------- | ---- | ------------------------------------------------ |
| EmployeeID    | str  | `employees.employee_number` (falls back to `id`) |
| LastName      | str  | `employees.last_name`                            |
| FirstName     | str  | `employees.first_name`                           |
| RegularHours  | num  | `buildTimesheetSummary → regularSeconds / 3600`  |
| OvertimeHours | num  | `buildTimesheetSummary → overtimeSeconds / 3600` |
| PeriodStart   | date | `period_start` (YYYY-MM-DD)                      |
| PeriodEnd     | date | `period_end` (YYYY-MM-DD)                        |

Employees with zero work hours in the period are omitted.

## Verification

Before a firm switches a live client to this export, confirm that the
Payroll Relief "Employee Hours Import" template in their environment
expects exactly these column names in this order. Custom earnings
codes (vacation, sick, bereavement) are not emitted; a firm using
those should instead use `generic_csv` with a saved template matching
their template columns.
