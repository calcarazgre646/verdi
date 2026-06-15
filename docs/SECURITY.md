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

1. **IBM i object authority (the wall).** A dedicated service profile with `*USE`
   (read) on the data library and **no** `*ADD`/`*UPD`/`*DLT`/`*CHANGE`/`*ALL` on
   its `*FILE` objects. This is an OS guarantee, independent of this app, and the
   control a security review should verify.
2. **No execute on mutating routines.** A `SELECT` can invoke a UDF or stored
   procedure that writes (DB2 for i `MODIFIES SQL DATA`). Deny the profile execute
   authority on procedures/functions that mutate, so this class cannot fire.
3. **Scoped library list.** Run with a minimal `CURLIB`/library list (only the
   libraries the agent needs), so unqualified names cannot resolve to writable
   objects elsewhere.
4. **Transaction read-only.** Independently of the parser, run the session as a
   read-only transaction (`SET TRANSACTION READ ONLY` where the connection model
   allows). A second barrier that does not depend on this app's code.
5. **Least privilege + secret hygiene.** Service profile, not a person's; rotate
   the password; credentials from the environment, never the repo.
6. **App-level check (courtesy).** `assertReadOnly` in the open core fails fast on
   the common mistakes with a clean message. **Not a boundary** (string matching,
   not a parser). If you ever promote it to a real control, replace the regex with
   a true SQL parser that walks the tree and rejects any non-`SELECT`/`WITH` node,
   including CTE bodies and routine calls.
7. **Deployment mode.** The open core ships read-only; the controlled-write tools
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
