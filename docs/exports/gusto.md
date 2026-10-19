# Gusto export

Gusto's "Hours Worked" CSV importer matches employees by email (best)
or by name. Vibe PT emits both.

## Columns

| Column                | Value                                     |
| --------------------- | ----------------------------------------- |
| first_name            | `employees.first_name`                    |
| last_name             | `employees.last_name`                     |
| email                 | `employees.email` (blank if not on file)  |
| regular_hours         | Period regular hours (2 decimals)         |
| overtime_hours        | Period overtime hours                     |
| double_overtime_hours | `0.00` (Vibe PT has no double-OT concept) |
| pto_hours             | Paid PTO + paid "other" time off          |
| holiday_hours         | Paid holiday hours                        |
| sick_hours            | Paid sick hours                           |

Time-off hours come from time-off codes (Settings → Time off, or a
code marked "time off" on the Jobs page). Paid codes in the "other"
category (bereavement, jury duty, …) have no Gusto column of their
own, so they are added to `pto_hours`. Unpaid leave is not exported.
Time off never counts toward `overtime_hours`.

Employees with no worked hours and no paid time off are omitted.

## Verification

Gusto's import console validates the column order exactly. If Gusto
updates their template, this exporter needs a matching release. Firms
can work around a mismatch by using `generic_csv` with a custom
column set.
