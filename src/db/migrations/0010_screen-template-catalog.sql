CREATE TABLE `screen_template_elements` (
	`element_id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`element_type` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	`rotation_deg` real NOT NULL,
	`order_index` integer NOT NULL,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `screen_templates`(`template_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "screen_template_elements_type_check" CHECK("screen_template_elements"."element_type" IN ('dialogue-window', 'section-title', 'character-visual', 'content-slot')),
	CONSTRAINT "screen_template_elements_geometry_check" CHECK("screen_template_elements"."x" = "screen_template_elements"."x" AND "screen_template_elements"."y" = "screen_template_elements"."y" AND "screen_template_elements"."width" = "screen_template_elements"."width" AND "screen_template_elements"."height" = "screen_template_elements"."height" AND "screen_template_elements"."rotation_deg" = "screen_template_elements"."rotation_deg" AND "screen_template_elements"."x" >= 0 AND "screen_template_elements"."y" >= 0 AND "screen_template_elements"."width" > 0 AND "screen_template_elements"."height" > 0 AND "screen_template_elements"."x" + "screen_template_elements"."width" <= 1 AND "screen_template_elements"."y" + "screen_template_elements"."height" <= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `screen_template_elements_template_order_uq` ON `screen_template_elements` (`template_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `screen_template_elements_template_id_idx` ON `screen_template_elements` (`template_id`);--> statement-breakpoint
CREATE TABLE `screen_templates` (
	`template_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`canvas_width` integer NOT NULL,
	`canvas_height` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "screen_templates_status_check" CHECK("screen_templates"."status" IN ('active', 'inactive')),
	CONSTRAINT "screen_templates_canvas_check" CHECK("screen_templates"."canvas_width" = 1920 AND "screen_templates"."canvas_height" = 1080),
	CONSTRAINT "screen_templates_revision_check" CHECK("screen_templates"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `screen_templates_status_idx` ON `screen_templates` (`status`);
