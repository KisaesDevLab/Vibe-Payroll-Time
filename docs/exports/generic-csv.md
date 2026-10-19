# Generic CSV export

For firms whose payroll destination isn't one of the three named
vendors, `generic_csv` emits a configurable column set drawn from the
Vibe PT employee summary. Pick the columns (and order) that match
your target template.

## Available columns

| Key                    | Label                | Value                                     |
| ---------------------- | -------------------- | ----------------------------------------- |
| `employee_number`      | Employee #           | `employees.employee_number` (fallback id) |
| `last_name`            | Last name            | `employees.last_name`                     |
| `first_name`           | First name           | `employees.first_name`                    |
| `email`                | Email                | `employees.email`                         |
| `regular_hours`        | Regular hours        | Period regular hours (2 decimals)         |
| `overtime_hours`       | Overtime hours       | Period OT hours                           |
| `break_hours`          | Break hours          | Period break hours                        |
| `total_hours`          | Total hours          | Period worked hours (time off excluded)   |
| `pto_hours`            | PTO hours            | PTO, paid or not                          |
| `sick_hours`           | Sick hours           | Sick time                                 |
| `holiday_hours`        | Holiday hours        | Holiday time                              |
| `other_time_off_hours` | Other time off hours | "Other" time-off codes                    |
| `unpaid_hours`         | Unpaid leave hours   | Every unpaid time-off code                |
| `paid_time_off_hours`  | Paid time off hours  | Every paid time-off code                  |
| `total_paid_hours`     | Total paid hours     | Worked + paid time off                    |
| `job_breakdown_json`   | Job breakdown        | JSON `[{jobCode, hours}]` per job         |
| `period_start`         | Period start         | ISO date                                  |
| `period_end`           | Period end           | ISO date                                  |

If no columns are specified, Vibe PT defaults to a reasonable payroll
set: employee number, last/first name, regular, overtime, total.

## Templates

Phase 9 ships the run-time column picker. Per-company saved templates
(name + column list) are slated for a follow-up iteration — the UI
affordance is there in the API but not yet persisted.
