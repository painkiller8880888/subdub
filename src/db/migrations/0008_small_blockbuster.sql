PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_character_variants` (
	`variant_id` text PRIMARY KEY NOT NULL,
	`visual_id` text NOT NULL,
	`label` text NOT NULL,
	`render_type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`tags` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`visual_id`) REFERENCES `character_visuals`(`visual_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "character_variants_render_type_check" CHECK("__new_character_variants"."render_type" IN ('single-image', 'mouth-pair')),
	CONSTRAINT "character_variants_status_check" CHECK("__new_character_variants"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
INSERT INTO `__new_character_variants`("variant_id", "visual_id", "label", "render_type", "status", "tags", "created_at", "updated_at") SELECT "variant_id", "visual_id", "label", "render_type", 'active', "tags", "created_at", "updated_at" FROM `character_variants`;
--> statement-breakpoint
CREATE TABLE `__old_character_variant_files` AS SELECT * FROM `character_variant_files`;
--> statement-breakpoint
DROP TABLE `character_variant_files`;
--> statement-breakpoint
DROP TABLE `character_variants`;
--> statement-breakpoint
ALTER TABLE `__new_character_variants` RENAME TO `character_variants`;
--> statement-breakpoint
CREATE INDEX `character_variants_visual_id_idx` ON `character_variants` (`visual_id`);
--> statement-breakpoint
CREATE TABLE `character_variant_files` (
	`variant_id` text NOT NULL,
	`file_key` text NOT NULL,
	`library_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`checksum` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`variant_id`, `file_key`),
	FOREIGN KEY (`variant_id`) REFERENCES `character_variants`(`variant_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "character_variant_files_mime_type_check" CHECK("character_variant_files"."mime_type" = 'image/png'),
	CONSTRAINT "character_variant_files_checksum_check" CHECK(length("character_variant_files"."checksum") = 64),
	CONSTRAINT "character_variant_files_dimensions_check" CHECK("character_variant_files"."size_bytes" >= 0 AND "character_variant_files"."width" > 0 AND "character_variant_files"."height" > 0)
);
--> statement-breakpoint
INSERT INTO `character_variant_files`("variant_id", "file_key", "library_path", "mime_type", "checksum", "size_bytes", "width", "height", "created_at", "updated_at") SELECT "variant_id", "file_key", "library_path", "mime_type", "checksum", "size_bytes", "width", "height", "created_at", "updated_at" FROM `__old_character_variant_files`;
--> statement-breakpoint
DROP TABLE `__old_character_variant_files`;
--> statement-breakpoint
CREATE UNIQUE INDEX `character_variant_files_library_path_uq` ON `character_variant_files` (`library_path`);
--> statement-breakpoint
CREATE INDEX `character_variant_files_variant_id_idx` ON `character_variant_files` (`variant_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
