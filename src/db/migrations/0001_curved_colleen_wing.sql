CREATE TABLE `terminology_terms` (
	`term_id` text PRIMARY KEY NOT NULL,
	`surface` text NOT NULL,
	`normalized_surface` text NOT NULL,
	`reading_katakana` text NOT NULL,
	`category` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "terminology_terms_status_check" CHECK("terminology_terms"."status" IN ('active', 'inactive'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terminology_terms_surface_uq` ON `terminology_terms` (`normalized_surface`);--> statement-breakpoint
CREATE INDEX `terminology_terms_status_idx` ON `terminology_terms` (`status`);