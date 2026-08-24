ALTER TABLE `assets` ADD `revision` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `assets` ADD `current_version` integer;
--> statement-breakpoint
ALTER TABLE `asset_versions` ADD `status` text NOT NULL DEFAULT 'processing';
--> statement-breakpoint
ALTER TABLE `asset_versions` ADD `base_revision` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `asset_versions` ADD `base_current_version` integer;
--> statement-breakpoint
ALTER TABLE `asset_versions` ADD `staging_path` text;
--> statement-breakpoint
ALTER TABLE `asset_versions` ADD `error_code` text;
--> statement-breakpoint
ALTER TABLE `asset_versions` ADD `error_message` text;
--> statement-breakpoint

UPDATE `assets`
SET `revision` = 1,
    `current_version` = CASE
      WHEN `status` IN ('active', 'inactive') THEN (
        SELECT MAX(completed.version)
        FROM `asset_versions` AS completed
        WHERE completed.asset_id = assets.asset_id
          AND completed.checksum IS NOT NULL
      )
      ELSE NULL
    END;
--> statement-breakpoint

UPDATE `asset_versions`
SET `status` = CASE
      WHEN EXISTS (
        SELECT 1
        FROM `assets`
        WHERE assets.asset_id = asset_versions.asset_id
          AND assets.status = 'error'
          AND asset_versions.version = (
            SELECT MAX(latest.version)
            FROM asset_versions AS latest
            WHERE latest.asset_id = asset_versions.asset_id
          )
      ) THEN 'error'
      WHEN `checksum` IS NOT NULL THEN 'ready'
      WHEN EXISTS (
        SELECT 1
        FROM `assets`
        WHERE assets.asset_id = asset_versions.asset_id
          AND assets.status = 'error'
      ) THEN 'error'
      ELSE 'processing'
    END,
    `base_revision` = 1,
    `base_current_version` = (
      SELECT assets.current_version
      FROM `assets`
      WHERE assets.asset_id = asset_versions.asset_id
    ),
    `staging_path` = NULL;
--> statement-breakpoint

UPDATE `asset_versions`
SET `error_code` = (
      SELECT assets.error_code
      FROM `assets`
      WHERE assets.asset_id = asset_versions.asset_id
        AND assets.status = 'error'
        AND asset_versions.version = (
          SELECT MAX(latest.version)
          FROM asset_versions AS latest
          WHERE latest.asset_id = asset_versions.asset_id
        )
    ),
    `error_message` = (
      SELECT assets.error_message
      FROM `assets`
      WHERE assets.asset_id = asset_versions.asset_id
        AND assets.status = 'error'
        AND asset_versions.version = (
          SELECT MAX(latest.version)
          FROM asset_versions AS latest
          WHERE latest.asset_id = asset_versions.asset_id
        )
    )
WHERE EXISTS (
  SELECT 1
  FROM assets
  WHERE assets.asset_id = asset_versions.asset_id
    AND assets.status = 'error'
);
--> statement-breakpoint

CREATE INDEX `asset_versions_status_idx` ON `asset_versions` (`status`);
--> statement-breakpoint

CREATE TRIGGER `assets_revision_guard_insert`
BEFORE INSERT ON `assets`
WHEN NEW.revision <= 0 OR (NEW.current_version IS NOT NULL AND NEW.current_version <= 0)
BEGIN
  SELECT RAISE(ABORT, 'assets revision/current_version must be positive');
END;
--> statement-breakpoint
CREATE TRIGGER `assets_revision_guard_update`
BEFORE UPDATE OF revision, current_version ON `assets`
WHEN NEW.revision <= 0 OR (NEW.current_version IS NOT NULL AND NEW.current_version <= 0)
BEGIN
  SELECT RAISE(ABORT, 'assets revision/current_version must be positive');
END;
--> statement-breakpoint
CREATE TRIGGER `asset_versions_status_guard_insert`
BEFORE INSERT ON `asset_versions`
WHEN NEW.status NOT IN ('processing', 'ready', 'error')
  OR NEW.version <= 0
  OR NEW.base_revision <= 0
  OR (NEW.base_current_version IS NOT NULL AND NEW.base_current_version <= 0)
BEGIN
  SELECT RAISE(ABORT, 'asset_versions status/version/base values are invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `asset_versions_status_guard_update`
BEFORE UPDATE OF status, version, base_revision, base_current_version ON `asset_versions`
WHEN NEW.status NOT IN ('processing', 'ready', 'error')
  OR NEW.version <= 0
  OR NEW.base_revision <= 0
  OR (NEW.base_current_version IS NOT NULL AND NEW.base_current_version <= 0)
BEGIN
  SELECT RAISE(ABORT, 'asset_versions status/version/base values are invalid');
END;
--> statement-breakpoint

-- Legacy callers inserted a version without the new status fields. Treat a
-- version inserted for an already usable asset as a completed historical row;
-- replacement candidates always carry a persisted staging_path and remain
-- processing.
CREATE TRIGGER `asset_versions_legacy_ready_insert`
AFTER INSERT ON `asset_versions`
WHEN NEW.status = 'processing'
  AND NEW.staging_path IS NULL
  AND EXISTS (
    SELECT 1
    FROM assets
    WHERE assets.asset_id = NEW.asset_id
      AND assets.status IN ('active', 'inactive')
  )
BEGIN
  UPDATE asset_versions
  SET status = 'ready'
  WHERE asset_id = NEW.asset_id
    AND version = NEW.version;
END;
