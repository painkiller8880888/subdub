PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TRIGGER IF EXISTS `asset_search_assets_ai`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `asset_search_assets_au`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `asset_search_assets_ad`;--> statement-breakpoint
CREATE TABLE `__new_assets` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`confidentiality` text DEFAULT 'internal' NOT NULL,
	`department` text,
	`system` text,
	`status` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "assets_kind_check" CHECK("__new_assets"."kind" IN ('video', 'bgm', 'photo', 'document_scan', 'sound_effect')),
	CONSTRAINT "assets_status_check" CHECK("__new_assets"."status" IN ('processing', 'active', 'inactive', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_assets`(
	`asset_id`,
	`kind`,
	`title`,
	`description`,
	`confidentiality`,
	`department`,
	`system`,
	`status`,
	`error_code`,
	`error_message`,
	`created_at`,
	`updated_at`
)
SELECT
	`asset_id`,
	`kind`,
	`title`,
	`description`,
	`confidentiality`,
	`department`,
	`system`,
	`status`,
	`error_code`,
	`error_message`,
	`created_at`,
	`updated_at`
FROM `assets`;
--> statement-breakpoint
DROP TABLE `assets`;--> statement-breakpoint
ALTER TABLE `__new_assets` RENAME TO `assets`;--> statement-breakpoint
CREATE INDEX `assets_status_idx` ON `assets` (`status`);--> statement-breakpoint
CREATE TRIGGER `asset_search_assets_ai`
AFTER INSERT ON assets
BEGIN
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id = NEW.asset_id;
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_assets_au`
AFTER UPDATE ON assets
BEGIN
	DELETE FROM asset_search WHERE asset_id = OLD.asset_id;
	INSERT INTO asset_search (asset_id, title, description, department, system, tags)
	SELECT asset_id, title, description, department, system, tags
	FROM asset_search_documents
	WHERE asset_id = NEW.asset_id;
END;
--> statement-breakpoint
CREATE TRIGGER `asset_search_assets_ad`
AFTER DELETE ON assets
BEGIN
	DELETE FROM asset_search WHERE asset_id = OLD.asset_id;
END;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
