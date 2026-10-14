-- Optional temporary test-user feature. No cleartext credentials are stored.
CREATE TABLE test_user_batches (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  credentials_hash CHAR(64) NOT NULL,
  accounts_json JSON NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  disabled_at VARCHAR(32) NULL,
  INDEX test_user_batches_actor_created (actor_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin ROW_FORMAT=DYNAMIC;
