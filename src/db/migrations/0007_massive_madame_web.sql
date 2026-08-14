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
CREATE UNIQUE INDEX `character_variant_files_library_path_uq` ON `character_variant_files` (`library_path`);--> statement-breakpoint
CREATE INDEX `character_variant_files_variant_id_idx` ON `character_variant_files` (`variant_id`);--> statement-breakpoint
CREATE TABLE `character_variants` (
	`variant_id` text PRIMARY KEY NOT NULL,
	`visual_id` text NOT NULL,
	`label` text NOT NULL,
	`render_type` text NOT NULL,
	`tags` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`visual_id`) REFERENCES `character_visuals`(`visual_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "character_variants_render_type_check" CHECK("character_variants"."render_type" IN ('single-image', 'mouth-pair'))
);
--> statement-breakpoint
CREATE INDEX `character_variants_visual_id_idx` ON `character_variants` (`visual_id`);--> statement-breakpoint
CREATE TABLE `character_visuals` (
	`visual_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`base_width` integer,
	`base_height` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "character_visuals_status_check" CHECK("character_visuals"."status" IN ('active', 'inactive')),
	CONSTRAINT "character_visuals_base_canvas_check" CHECK(("character_visuals"."base_width" IS NULL AND "character_visuals"."base_height" IS NULL) OR ("character_visuals"."base_width" IS NOT NULL AND "character_visuals"."base_height" IS NOT NULL AND "character_visuals"."base_width" > 0 AND "character_visuals"."base_height" > 0))
);
--> statement-breakpoint
CREATE INDEX `character_visuals_status_idx` ON `character_visuals` (`status`);