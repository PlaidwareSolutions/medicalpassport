# V2 runbooks

Extends `docs/30-operational-runbooks.md` (R1–R13). Each runbook states preconditions, procedure, verification, rollback, and keeps a log table.

| ID | Runbook | Status |
|---|---|---|
| [R-KEY-1](R-KEY-1-field-encryption-rotation.md) | Field-encryption key rotation (keyring) | written; dev execution pending on a scratch DB |
| [R-DR-3](R-DR-3-backup-key-custody.md) | Backup key custody outside Railway and restore with the offline key | written; execution needs production access |
| [R-REGION-1](R-REGION-1-region-move.md) | Move compute + data to another region/provider | written; desk-check pending Architecture Board |
| R-MIG-1 | Backfill resume | to write with the first production backfill (P1) |
| R-MIG-2 | Sunset migration go/no-go | to write before V2.5 |
| R-ABDM-1/2/3 | Gateway credentials, callback outage, consent-expiry erase failure | to write with M8A–M8D |
| R-DOC-1 | Extraction provider outage | to write with P3 |
| R-PROV-1 | Provider account compromise | to write with P11 |
| R-BG-1 | Break-glass review | to write with the admin break-glass duty (P0/P1) |
