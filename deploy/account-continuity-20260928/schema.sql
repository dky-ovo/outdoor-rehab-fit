CREATE TABLE IF NOT EXISTS account_bookmarks (
 user_id VARCHAR(64) NOT NULL,
 equipment_id VARCHAR(200) NOT NULL,
 selected TINYINT NOT NULL,
 version BIGINT NOT NULL,
 last_operation VARCHAR(160) NOT NULL,
 PRIMARY KEY (user_id, equipment_id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
CREATE TABLE IF NOT EXISTS assistant_jobs (
 id VARCHAR(160) NOT NULL PRIMARY KEY,
 user_id VARCHAR(64) NOT NULL,
 status VARCHAR(16) NOT NULL,
 request_json MEDIUMTEXT NULL,
 result_json MEDIUMTEXT NULL,
 error_code VARCHAR(64) NULL,
 created_at BIGINT NOT NULL,
 completed_at BIGINT NULL,
 INDEX assistant_jobs_owner (user_id, created_at),
 INDEX assistant_jobs_queue (status, created_at),
 INDEX assistant_jobs_retention (completed_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin;
