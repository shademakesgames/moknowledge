# Storage and Supabase design

The running app uses validated JSON in `localStorage` under `moknowledge.records.v1`. It has no authentication and no cross-device synchronization. Save updates the local record and increments its version; local storage retains the latest version only. Export creates a portable snapshot; import validates schema version and asks before replacing an existing ID.

`database.sql` is the proposed Supabase schema and RLS design, not an applied migration. It has not been executed against a Supabase instance.

## Relationships

- Organizations have multiple members and companies.
- Companies have immutable knowledge versions and crawl runs.
- Crawl runs have source pages.
- A knowledge version stores the entire validated knowledge object in `data jsonb`, including the evidence excerpts used at that moment. A later crawl cannot rewrite old evidence.

The SQL defines UUID keys, timestamp fields, foreign keys, indexes, uniqueness of company/version, and role-based access. The database accepts JSON objects; the application must enforce the full Zod knowledge schema before writes.

## Version allocation

Use a transaction or reviewed RPC that checks editor membership, locks the company row with `SELECT ... FOR UPDATE`, reads its latest version, and inserts version + 1. The unique company/version constraint catches collisions. Do not allocate versions through an unlocked client-side MAX query. To prevent overwriting unseen work, include the expected prior version and reject conflicts.

Use the highest version for the default read, or add a published-version pointer with a composite foreign key ensuring the snapshot belongs to that company. Schema version and record version serve different purposes.

## Tenant isolation

Membership is read through tightly scoped security-definer helpers to avoid recursive membership RLS. Helpers use `auth.uid()`, fully qualified objects, and an empty search path; anonymous execution is revoked. All exposed tables enable RLS. Editors may write companies and append knowledge snapshots; viewers only read. Organization creation and membership changes belong to a trusted provisioning backend, avoiding self-enrollment or role escalation.

Server crawl workers write run/source rows only after validating the requesting user's company membership. Keep service credentials off the client. Add integration tests using users from two organizations before deploying this SQL. Test SELECT, INSERT, UPDATE, DELETE, and attempted tenant reassignment independently.

## Retention and deletion

Snapshots are append-only for clients. Admin deletion of a company cascades to versions, runs, and sources; a production product should decide whether to soft-delete first and establish a retention period. Evidence excerpts are stored in snapshots, so source-page retention can be shorter than version retention. Raw HTML need not be retained indefinitely.
