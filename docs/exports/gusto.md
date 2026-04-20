# Gusto export

Gusto's "Hours Worked" CSV importer matches employees by email (best)
or by name. Vibe PT emits both.

## Columns

| Column                | Value                                              |
| --------------------- | -------------------------------------------------- |
| first_name            | `employees.first_name`                             |
| last_name             | `employees.last_name`                              |
| email                 | `employees.email` (blank if not on file)          |
| regular_hours         | Period regular hours (2 decimals)                  |
| overtime_hours        | Period overtime hours                              |
| double_overtime_hours | `0.00` (Vibe PT has no double-OT concept)          |
| pto_hours             | `0.00` (no PTO accrual in v1)                      |
| holiday_hours         | `0.00`                                             |
| sick_hours            | `0.00`                                             |

Employees with zero work hours are omitted.

## Verification

Gusto's import console validates the column order exactly. If Gusto
updates their template, this exporter needs a matching release. Firms
can work around a mismatch by using `generic_csv` with a custom
column set.
