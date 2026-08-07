ALTER TABLE `asset_versions` ADD `size_bytes` integer;--> statement-breakpoint
ALTER TABLE `assets` ADD `error_code` text;--> statement-breakpoint
ALTER TABLE `assets` ADD `error_message` text;