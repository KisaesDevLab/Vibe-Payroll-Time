# Payroll Relief export

Payroll Relief (Thomson Reuters CS Professional Suite) accepts a
per-employee hours CSV as part of its batch import. Vibe PT's
`payroll_relief` format emits one row per employee with regular and
overtime hours for the pay period.

## Columns

| Column              | Type | Source                                            |
| ------------------- | ---- | ------------------------------------------------- |
| EmployeeID          | str  | `employees.employee_number` (falls back to `id`)  |
| LastName            | str  | `employees.last_name`                             |
| FirstName           | str  | `employees.first_name`                            |
| RegularHours        | num  | `buildTimesheetSummary → regularSeconds / 3600`   |
| OvertimeHours       | num  | `buildTimesheetSummary → overtimeSeconds / 3600`  |
| PeriodStart         | date | `period_start` (YYYY-MM-DD)                       |
| PeriodEnd           | date | `period_end` (YYYY-MM-DD)                         |
| PTOHours            | num  | Paid PTO hours                                    |
| SickHours           | num  | Paid sick hours                                   |
| HolidayHours        | num  | Paid holiday hours                                |
| OtherPaidLeaveHours | num  | Paid "other" time off (bereavement, jury duty, …) |

The four time-off columns come after `PeriodEnd`, so a template mapped
to the first seven columns keeps working; map them to your earnings
codes to import time off. Unpaid leave is not exported. Time off never
counts toward `OvertimeHours`.

Employees with no worked hours and no paid time off are omitted.

## Verification

Before a firm switches a live client to this export, confirm that the
Payroll Relief "Employee Hours Import" template in their environment
expects exactly these column names in this order. A firm whose
earnings codes don't line up with the four time-off columns can use
`generic_csv` with the time-off columns it needs.
