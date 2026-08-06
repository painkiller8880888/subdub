CREATE TABLE `asset_tags` (
	`asset_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`asset_id`, `tag_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`asset_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`tag_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `asset_tags_tag_id_idx` ON `asset_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `asset_versions` (
	`asset_id` text NOT NULL,
	`version` integer NOT NULL,
	`library_media_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`checksum` text,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`page_count` integer,
	`thumbnail_paths` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`asset_id`, `version`),
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`asset_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `asset_versions_asset_id_idx` ON `asset_versions` (`asset_id`);--> statement-breakpoint
CREATE TABLE `assets` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`confidentiality` text DEFAULT 'internal' NOT NULL,
	`department` text,
	`system` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "assets_kind_check" CHECK("assets"."kind" IN ('video', 'photo', 'document_scan', 'sound_effect')),
	CONSTRAINT "assets_status_check" CHECK("assets"."status" IN ('processing', 'active', 'inactive', 'error'))
);
--> statement-breakpoint
CREATE INDEX `assets_status_idx` ON `assets` (`status`);--> statement-breakpoint
CREATE TABLE `tag_aliases` (
	`alias_id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`tag_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_aliases_tag_alias_uq` ON `tag_aliases` (`tag_id`,`normalized_alias`);--> statement-breakpoint
CREATE INDEX `tag_aliases_tag_id_idx` ON `tag_aliases` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`tag_id` text PRIMARY KEY NOT NULL,
	`axis` text NOT NULL,
	`canonical_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "tags_axis_check" CHECK("tags"."axis" IN ('department', 'system', 'task', 'action', 'object', 'location', 'documentType', 'status')),
	CONSTRAINT "tags_status_check" CHECK("tags"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_normalized_name_uq` ON `tags` (`normalized_name`);--> statement-breakpoint
CREATE INDEX `tags_status_idx` ON `tags` (`status`);