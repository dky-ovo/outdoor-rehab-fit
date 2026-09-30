CREATE TABLE IF NOT EXISTS account_documents (
 user_id VARCHAR(64) NOT NULL,
 collection VARCHAR(32) NOT NULL,
 record_id VARCHAR(256) NOT NULL,
 value_json MEDIUMTEXT NULL,
 deleted TINYINT NOT NULL,
 revision BIGINT NOT NULL,
 last_operation VARCHAR(160) NOT NULL,
 PRIMARY KEY (user_id, collection, record_id),
 UNIQUE KEY account_documents_cursor (user_id, collection, revision)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
