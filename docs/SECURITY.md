# Security model

## Read-only is enforced by the database, not by this app

`jde_query` rejects statements that do not start with `SELECT`/`WITH` and flags
stacked statements and obvious DML/DDL keywords. **Treat that as a convenience
and an early-fail, not as a security boundary.** It is string matching, not a SQL
parser, and it can be bypassed. For example, on DB2 for i a user-defined function
or table function declared `MODIFIES SQL DATA` can be invoked from inside a plain
`SELECT` (`SELECT * FROM TABLE(some_writing_function())`) and would pass the check
while still writing.

**The real read-only guarantee must live in IBM i object authority.** Run the
LIVE connection under a profile that has read (`*USE` / `SELECT`) authority on the
data library and **no** add/update/delete authority (`*ADD`, `*UPD`, `*DLT`) on
its objects. With that in place, even a query that slips past the string check
cannot mutate anything, because the database itself refuses the write.

## Defense in depth (layers, strongest first)

1. **IBM i object authority (the wall).** A profile with no write authority on the
   data library. This is the control a security review should verify.
2. **Least privilege.** A dedicated service profile, not a person's, scoped to
   exactly the libraries the agent needs. Rotate its password; never commit it.
3. **App-level check (courtesy).** `assertReadOnly` in the open core: fails fast
   on the common mistakes and keeps honest queries honest. Not a boundary.
4. **Deployment mode.** The open core ships read-only; the controlled-write tools
   are a separate module and absent here entirely.

## What to verify before trusting a deployment

- The connecting profile cannot `INSERT`/`UPDATE`/`DELETE`/`CALL` against the data
  library. Confirm with the authority catalog, e.g.
  `SELECT * FROM QSYS2.OBJECT_PRIVILEGES WHERE SYSTEM_OBJECT_SCHEMA = 'JDFDATA'`.
- Credentials come from the environment, never from the repo.
- Network access to the IBM i / Mapepire daemon is restricted to the host running
  the server.

## Reporting

Found a way around any of this? Open a private security advisory on the
repository rather than a public issue.
