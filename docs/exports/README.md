# Payroll exports

Vibe PT produces payroll-ready CSV files on demand, scoped to a pay
period. An export is always preceded by a **preflight** that verifies
every employee's entries are approved, no open entries remain, and no
correction requests are still pending. The UI (Exports tab) refuses to
run until the preflight is green.

Four formats ship in v1:

| Format           | Vendor                         | Doc                                      |
| ---------------- | ------------------------------ | ---------------------------------------- |
| `payroll_relief` | Thomson Reuters Payroll Relief | [payroll-relief.md](./payroll-relief.md) |
| `gusto`          | Gusto                          | [gusto.md](./gusto.md)                   |
| `qbo_payroll`    | QuickBooks Online Payroll      | [qbo-payroll.md](./qbo-payroll.md)       |
| `generic_csv`    | Spreadsheet / firm-specific    | [generic-csv.md](./generic-csv.md)       |

> **Vendor formats evolve.** The columns and header names documented
> here were accurate at the time of implementation but are not
> contractually frozen by the vendor. Verify against the latest import
> template in the vendor's admin console before relying on a new
> mapping in production. The generic CSV exporter exists precisely so
> customers can ride out mismatches without waiting on a Vibe PT
> update.

## Storage

Generated files live under `EXPORTS_DIR` (default `./exports`), one
subdirectory per company. Filenames include the format, period start,
and a short content hash. The row in `payroll_exports` records the
full sha256 so a download can be verified against the original bytes.

Re-exporting the same (company, period, format) is allowed but must be
explicitly acknowledged in the run request. The earlier row's
`replaced_by_id` is then linked to the new row, so the history view
can show the lineage.
