PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_screen_template_elements` (
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
	CONSTRAINT "screen_template_elements_type_check" CHECK("__new_screen_template_elements"."element_type" IN ('dialogue-window', 'section-title', 'character-visual', 'content-slot')),
	CONSTRAINT "screen_template_elements_geometry_check" CHECK("__new_screen_template_elements"."x" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND "__new_screen_template_elements"."y" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND "__new_screen_template_elements"."width" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND "__new_screen_template_elements"."height" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND "__new_screen_template_elements"."rotation_deg" BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308 AND "__new_screen_template_elements"."width" > 0 AND "__new_screen_template_elements"."height" > 0 AND ("__new_screen_template_elements"."element_type" = 'character-visual' OR ("__new_screen_template_elements"."x" >= 0 AND "__new_screen_template_elements"."y" >= 0 AND "__new_screen_template_elements"."x" + "__new_screen_template_elements"."width" <= 1 AND "__new_screen_template_elements"."y" + "__new_screen_template_elements"."height" <= 1)))
);
--> statement-breakpoint
INSERT INTO `__new_screen_template_elements`("element_id", "template_id", "element_type", "x", "y", "width", "height", "rotation_deg", "order_index", "config_json", "created_at", "updated_at") SELECT "element_id", "template_id", "element_type", "x", "y", "width", "height", "rotation_deg", "order_index", "config_json", "created_at", "updated_at" FROM `screen_template_elements`;--> statement-breakpoint
DROP TABLE `screen_template_elements`;--> statement-breakpoint
ALTER TABLE `__new_screen_template_elements` RENAME TO `screen_template_elements`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `screen_template_elements_template_order_uq` ON `screen_template_elements` (`template_id`,`order_index`);--> statement-breakpoint
CREATE INDEX `screen_template_elements_template_id_idx` ON `screen_template_elements` (`template_id`);
