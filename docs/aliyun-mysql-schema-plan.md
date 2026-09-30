# Alibaba MySQL 8 schema implementation contract

Status: generated and verified on RDS MySQL 8.0.36, 2026-09-24. All 38 tables and 33 foreign keys were created; read-only verification passed with fingerprint `8b67ce16f43f3f82f9d03a9d4be1eec219d942951a44cf19249c71d68a561cb6`. The application still uses SQLite. Business data has not yet been imported into the rehearsal tables; see `aliyun-migration-progress.md` for current execution status.

Evidence: `aliyun-source-schema-audit.json`, `aliyun-source-column-profile.json`, and current `server/src`. The source SHA256 is `9e01e2f4d5b0e05cb0dac415ccffa4179e42105a76efc42df7e3788c9e46933d`: 38 tables, 324 columns, 32,314 rows, 33 declared foreign keys, zero foreign-key violations. Schema comparison found only column-order differences in `app_equipment_items`; always import with explicit column names. The current RDS report is MySQL 8.0.36, strict SQL mode, an empty test database, and availability of `utf8mb4_0900_bin` / `NO PAD`. TLS remains a separate connection verification gate.

## 1. Deterministic type rules

Apply these rules in order; the per-table exceptions below override generic rules.

| Source/role | Target | Contract |
| --- | --- | --- |
| Every `INTEGER` | signed `BIGINT` | Includes milliseconds, counters, booleans, revisions, and `schema_migrations.version`. Retain existing CHECK expressions; do not add unsigned or Boolean coercion. Preserve 0, 1 and NULL. |
| Every `REAL` | `DOUBLE` | Only the four latitude/longitude fields currently use it. Retain declared range checks. Reject non-finite values before insertion. |
| TEXT timestamps (`*_at`, `event_time`) | `VARCHAR(32)` | Keep exact UTC ISO strings, NULL and empty strings; no DATETIME conversion. INTEGER timestamps are handled first. All observed nonempty timestamp strings fit, but final preflight must check all values. |
| Ordinary generated identifiers and references | `VARCHAR(100)` | Applies only to the explicit ID column set implied by the table inventory and FK graph, not every arbitrary text ending in `_id`. Preserve original spelling. UUIDs, named built-ins and category-prefixed UUIDs fit. Explicit exceptions below. |
| All other TEXT | `MEDIUMTEXT` | Preserve strings byte-for-byte in UTF-8. All `*_json`, avatar data, text content, secrets, URLs, hashes not explicitly bounded, and unindexed descriptive values follow this rule. |

Use `ENGINE=InnoDB ROW_FORMAT=DYNAMIC`, and explicitly set every table and relevant connection to `utf8mb4` / `utf8mb4_0900_bin`; do not inherit the current database's `utf8mb4_0900_ai_ci`. The source's indexed text uses SQLite BINARY comparison. `0900_bin` avoids case/accent folding and trailing-space padding, but query-level SQLite `NOCASE`, LIKE and Unicode ordering still need application tests; a table collation alone does not port those SQL operations. [MySQL binary collations](https://dev.mysql.com/doc/refman/8.0/en/charset-binary-collations.html)

Keep JSON as strings in this first port. Native MySQL JSON would normalize representation and change driver return types. Do not silently convert, reserialize, omit keys, or truncate JSON. `MEDIUMTEXT` has a finite 16,777,215-byte ceiling: validate byte sizes in the importer and relevant application writes; fail explicitly if exceeded. Current values exceeding ordinary TEXT capacity are `system_logs.metadata_json` (508,268 bytes), `users.avatar_data` (508,019), `equipment_document_previews.payload_json` (95,627), and `messages.metadata_json` (88,611).

Preserve the source's nullability and defaults. Target PK columns must explicitly be NOT NULL; SQLite TEXT primary keys technically permit NULL, but this backup has none and the application must keep supplying IDs. Nullable email, optional relationships, `tcm_enabled`, JSON/text overrides and deletion timestamps remain nullable. Empty `media_folders.parent_id`, `media_files.folder_id`, and `facility_learning_progress.learning_date` are meaningful and must not become NULL. For MEDIUMTEXT defaults, emit expression defaults such as `DEFAULT ('')`, `DEFAULT ('{}')`, `DEFAULT ('[]')`; MySQL 8.0.36 supports them. Never turn a missing default into an empty-string default. [MySQL defaults](https://dev.mysql.com/doc/refman/8.0/en/data-type-defaults.html)

## 2. Complete table inventory and exceptions

`I` means VARCHAR(100), `T` means timestamp VARCHAR(32), `M` means MEDIUMTEXT, and `Vn` means VARCHAR(n), all with the table collation. Unlisted scalar text follows M; unlisted INTEGER/REAL follows the rules above. Every FK column must use exactly the parent's mapped type, charset and collation. Internal digest/row-ID columns described later are additions, not replacements for exported business values.

| Table | IDs, indexed text and exceptions |
| --- | --- |
| `admin_accounts` | `user_id,created_by` I; `system_role` V32; timestamps T |
| `ai_configuration` | `id,updated_by` I; provider/base_url/model/api_key M |
| `app_equipment_items` | `id` V200; `created_by` I; all teaching text, image/video URLs and categories JSON M |
| `app_sessions` | `id,user_id` I; timestamps T; optional metadata/device/version text M |
| `app_text_overrides` | `text_key` V200; `updated_by` I; `zh,en` nullable M; current catalog max key length 77; validate future catalogs at startup |
| `content_items` | `id,created_by` I; `page_key` V80; remaining content M |
| `conversation_members` | `conversation_id,user_id` I; PK unchanged; role M; `joined_at` T |
| `conversations` | `id,created_by` I; type/title M |
| `equipment_categories` | `id` I (custom ID is `category-` + UUID, not only a short built-in code) |
| `equipment_document_commits` | `idempotency_key` V36 (API allows 32–36 hex/hyphen characters); `actor_id,preview_id` I; unique preview_id retained; created_at BIGINT |
| `equipment_document_previews` | `id,actor_id` I; created_at/expires_at BIGINT, including indexed expires_at; payload_json M |
| `equipment_locations` | `id,created_by` I; `equipment_id` V200; no new FK to equipment is introduced |
| `equipment_tcm_content_updates` | `revision` V200 (fixed deployment revision identifier); all JSON M; validate future revisions before deployment |
| `exercise_session_revisions` | `id,user_id` I; `session_id` V100 matching session PK; retain UNIQUE(session_id,version_number) |
| `exercise_sessions` | `id` V100 (API truncates submitted ID at 100); `user_id` I; all JSON/journal M |
| `facilities` | `source_id` M plus internal surrogate PK/digest unique described below; `name_zh,district_zh` M with nonunique prefix indexes; source_name and other source text M |
| `facility_learning_progress` | `user_id` I, `equipment_id` V200, `learning_date` V10; preserve 3-column PK and empty-date sentinel; entry_json M |
| `facility_sources` | `id,updated_by` I; URLs and diagnostic text M |
| `facility_sync_runs` | `id,source_id,triggered_by` I; source_id references facility_sources, not facilities; all other text M except timestamps |
| `feedback` | `id,user_id` I; `submission_id` V128, unique (API allows 16–128); `status` V32; retain text defaults and nullable user |
| `guest_profiles` | `id` I; retain original age/gender/purpose checks |
| `media_categories` | `id` I; unique `name` V80 (API bound) |
| `media_files` | `id,category_id,created_by,folder_id` I; `name` V200; `kind` V16; url M plus digest unique; storage/hash metadata M; empty folder_id retained |
| `media_folders` | `id,parent_id` I; `name` V200; active-name generated key below; no new parent FK |
| `media_seed_folders` | `import_id` V100, `folder_id` I; `folder_path` M plus internal surrogate PK/digest unique below |
| `media_seed_items` | `import_id` V100; `file_name` V255; `file_id` I; original 2-column PK retained; validate local seed filename bytes before DB access (existing regular files on target Linux fit this component bound) |
| `media_seed_video_bindings` | `import_id` V100; bindings/before JSON M; validate tooling-generated import IDs at entry |
| `message_reactions` | `message_id,user_id` I; `emoji` V32; existing fixed reaction set fits; PK unchanged |
| `messages` | `id,conversation_id,sender_id` I; body/metadata_json M |
| `push_tokens` | `id,user_id` I; `expo_push_token` M plus digest unique; existing regex has no length limit, so do not silently substitute V255 |
| `registration_codes` | `id,created_by,used_by,revoked_by` I; `code_hash` V64 unique; `phone` V64; active-phone generated key below |
| `research_consents` | `id,user_id` I; consent/status text M |
| `research_events` | `id,participant_id` I; event_time T; event/version/JSON text M |
| `schema_migrations` | `version` signed BIGINT PK, no automatic numbering needed by existing writes; preserve 23 historical rows |
| `sms_verifications` | `id` I; indexed `phone` V64; remaining text M except timestamps |
| `system_logs` | `id,actor_user_id` I; `target_id` M because it may be a filename/business key, not a UUID; large JSON M |
| `users` | `id` I; `phone` V64 unique (deleted-account value is `deleted-` + UUID, observed length 44); nullable `email` M plus nullable digest unique; password salt/hash and avatar_data M |
| `volunteer_participants` | both user references I; original composite PK retained |

The existing admin-user email API checks format but not length; V254 would introduce a new rejection. The facility source parser similarly has no limit on source_id or source names. The above M/digest/prefix choices preserve their accepted string lengths up to the explicit M ceiling. Do not derive future field sizes only from observed historical maxima.

## 3. Partial unique indexes and long unique strings

Translate the two partial indexes using STORED nullable generated columns, not a Boolean flag with value 0 for inactive rows:

- `media_folders.active_name` V200 = `CASE WHEN deleted_at IS NULL THEN name ELSE NULL END`; unique `(parent_id,active_name)`. Deleted siblings may share names; an active sibling cannot.
- `registration_codes.active_phone` V64 = `CASE WHEN used_at IS NULL AND revoked_at IS NULL THEN phone ELSE NULL END`; unique `(active_phone)`. Used/revoked codes no longer reserve a phone.

These expressions preserve the source predicate and NULL behavior. Generated columns must inherit/declare the same binary collation as the source columns. Keep original query predicates; the generated columns are internal. [MySQL generated columns](https://dev.mysql.com/doc/refman/8.0/en/create-table-generated-columns.html)

For long unique strings, keep the complete original M field and add a STORED generated `BINARY(32)` digest of its UTF-8 bytes, conceptually `UNHEX(SHA2(CAST(field AS BINARY),256))`. Unique-index the digest; a nullable original email produces NULL digest and permits multiple absent emails. Apply to `media_files.url`, `users.email`, `push_tokens.expo_push_token`, and `facilities.source_id`. Do not use a unique prefix index, lowercase/normalize the URL, or make the full field ASCII. `safeMediaUrl` accepts up to 2,048 JS code units and can accept Unicode; 2,048 × 4-byte text does not fit a full 3,072-byte index.

`facilities` currently has no incoming FK. Give it an internal BIGINT AUTO_INCREMENT PK, while original source_id stays NOT NULL and digest-unique. All application reads/upserts continue using original source_id plus its computed digest. Do not expose or reuse the internal numeric key as a facility ID.

`media_seed_folders.folder_path` allows 32 × 200 characters plus 31 separators (6,431 characters), so its original composite PK cannot simply be converted to a full text index. Keep import_id V100 and full folder_path M; add internal BIGINT AUTO_INCREMENT PK and generated path digest, with UNIQUE(import_id,path_digest). No incoming FK depends on the old PK. SELECT/import-ignore lookup must compare the complete path as well as the digest. Normal seed file names are single real filesystem components; use the smaller exact composite key for `media_seed_items` above.

**Digest uniqueness is not mathematically equivalent to original-string uniqueness.** Different strings with the same digest will be rejected. This is an explicit, extremely unlikely additional failure mode, never a reason to overwrite/merge an unrelated row. All affected writes, including import/seed and push-token upserts, need this algorithm:

1. Compute/query the digest and fetch the existing full string inside the same transaction where relevant.
2. Equal original UTF-8 bytes: apply the original duplicate/update behavior. Different bytes: abort with a distinct internal collision error; report table/key name without business values.
3. On an insert race / duplicate-key error, fetch and compare again; if no matching original exists, abort. Never blanket-map every duplicate key to a normal duplicate or use unguarded `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE`.
4. On an update, enforce the same comparison. Compare bytes, not a client-side locale-aware comparison. Test the collision branch by injecting a digest test double; a real SHA-256 collision is not needed.

Use stored generated digests so direct DML cannot supply a stale digest. The two internal numeric PKs provide compact, stable clustering independently of the business digest. Generated function/unique-index syntax must be exercised against MySQL 8.0.36 before final DDL is accepted.

## 4. Index budget and FK preservation

Assume 16 KiB InnoDB pages only after querying `@@innodb_page_size`. Set DYNAMIC explicitly. Maximum declared UTF-8 key bytes below are computed as 4 × VARCHAR width plus 8 per BIGINT; binary SHA256 is 32. Secondary-index PK storage is additional overhead; the conservative last column adds missing PK payload even where the SQL key-length limit measures only declared key parts. The largest proposed key remains below 3,072 bytes. Smaller page sizes require recalculation. [MySQL InnoDB limits](https://dev.mysql.com/doc/refman/8.0/en/innodb-limits.html)

| Index family / largest example | Declared bytes | Including missing PK payload, at most |
| --- | ---: | ---: |
| media_seed_items PK(import_id,file_name) | 1,420 | 1,420 |
| learning progress PK(user_id,equipment_id,learning_date) | 1,240 | 1,240 |
| media folder active unique(parent_id,active_name) | 1,200 | 1,600 |
| media files folder(folder_id,deleted_at,name) | 1,328 | 1,728 |
| equipment locations(equipment_id,is_active,sort_order,created_at) | 944 | 1,344 |
| message reactions PK(message_id,user_id,emoji) | 928 | 928 |
| conversation members / volunteer relationship PK | 800 | 800 |
| media category/kind/archive/time | 600 | 1,000 |
| feedback status/time/id | 656 | 656 |
| ordinary user/time index | 528 | 928 |
| media seed folder UNIQUE(import_id,path_digest) | 432 | 440 |
| long-field digest UNIQUE | 32 | 432 (or 40 for internal BIGINT PK) |

Retain all other source indexes with their key order, uniqueness, and DESC directions. SQLite autoindex names are implementation details: name MySQL unique indexes explicitly and deterministically; do not create a redundant unique index for an existing primary key. For the two nonunique facility text indexes use `name_zh(191)` and `(is_active,district_zh(191))`: this changes an access path, not full-value equality, ordering or uniqueness. Keep SQL comparisons and ORDER BY on the full columns. The maximum conservative payload is 780 bytes including the numeric PK.

Copy all 33 FKs and exact ON DELETE/ON UPDATE actions from the audited graph; do not invent missing FKs on media folder sentinels, equipment IDs or ledger references. Parent/child string widths are identical: users I, conversations I, messages I, exercise_sessions V100, media_categories I, facility_sources I. InnoDB may create supporting child indexes where SQLite did not; explicitly name them if generating a repeatable schema. Load parents before children with FK checks enabled. Re-enabling `FOREIGN_KEY_CHECKS` after an unchecked load is not a substitute for validation.

Port existing enum/range CHECKs literally where syntax allows. The implemented learning_date CHECK uses the empty-string sentinel or `CHAR_LENGTH(...)=10`, `SUBSTRING` hyphen positions and explicit ASCII digit membership at the remaining positions. This preserves the SQLite stored-format constraint without relying on REGEXP functions in CHECK; the existing application performs actual calendar validation. Constraint names are table-prefixed to avoid schema-level collisions. Keep source schema_migrations as historical evidence and use separate MySQL-specific migration tracking; do not rerun the SQLite seed/migration chain.

## 5. Acceptance gates for implementation

- Compile a reviewed, explicit 324-column manifest from this mapping; reject any unmapped indexed text and unexpected source schema/hash. Import original columns only; ignore generated/internal columns in source-to-target row comparisons.
- Preflight every new snapshot for mapped lengths/bytes, nullable PKs, valid UTF-8, expected storage classes, finite REAL values, signed BIGINT range, full-string uniqueness, digest collisions and FK violations. Never silently narrow/truncate/replace. SQLite INTEGER affinity can accept REAL/text; strict MySQL cannot, so new mismatches must block with aggregate diagnostics.
- DDL rehearsal on actual MySQL 8.0.36: verify generated CASE/SHA2 columns and MEDIUMTEXT defaults; inserted values differing only in case, accent and trailing spaces remain distinct; NULL email duplicates work; both partial-unique transitions work; >65,535-byte JSON/avatar and maximum accepted IDs/Unicode URLs/6,431-character folder paths round-trip.
- The driver must return BIGINT exactly. Existing snapshot integers fit JS safe range, but app_text revision permits near-MAX_SAFE_INTEGER values; configure exact decoding and validate before Number conversion. Do not turn precision loss into successful import.
- Preserve `max_allowed_packet` within connection/driver limits, but use bounded batches (for example ≤1 MiB of encoded parameters with a separate allowance for a single larger row), not one statement for 31,162 research events. Compare all original-column values after import, per-table counts, aggregate content digests, and FK/unique results. Do not log database credentials or business rows.
- Before deploying, complete async MySQL query/transaction migration, duplicate-error handling for all digest-backed keys, same-connection transactions, affected-row semantics, JSON SQL functions, query-level NOCASE/LIKE behavior, and concurrency tests. Schema/import success alone does not establish that the app can run on RDS.
