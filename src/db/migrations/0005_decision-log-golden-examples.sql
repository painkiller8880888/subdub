CREATE TABLE `ai_generation_candidates` (
	`candidate_id` text PRIMARY KEY NOT NULL,
	`generation_run_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_revision` integer NOT NULL,
	`task_kind` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`candidate_key` text NOT NULL,
	`candidate_json` text NOT NULL,
	`candidate_checksum` text NOT NULL,
	`model_id` text NOT NULL,
	`response_model` text,
	`prompt_version` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "ai_generation_candidates_task_kind_check" CHECK("ai_generation_candidates"."task_kind" IN ('outline_generation', 'visual_search_intent')),
	CONSTRAINT "ai_generation_candidates_target_kind_check" CHECK("ai_generation_candidates"."target_kind" IN ('outline', 'visual_line_range'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_generation_candidates_run_key_uq` ON `ai_generation_candidates` (`generation_run_id`,`candidate_key`);--> statement-breakpoint
CREATE INDEX `ai_generation_candidates_project_task_model_run_idx` ON `ai_generation_candidates` (`project_id`,`task_kind`,`model_id`,`generation_run_id`);--> statement-breakpoint
CREATE INDEX `ai_generation_candidates_project_target_idx` ON `ai_generation_candidates` (`project_id`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `golden_examples` (
	`example_id` text PRIMARY KEY NOT NULL,
	`example_kind` text NOT NULL,
	`project_id` text NOT NULL,
	`project_revision` integer NOT NULL,
	`target_id` text NOT NULL,
	`source_hash` text NOT NULL,
	`outline_hash` text,
	`payload_json` text NOT NULL,
	`payload_checksum` text NOT NULL,
	`generation_run_id` text,
	`model_id` text,
	`prompt_version` text,
	`created_at` text NOT NULL,
	CONSTRAINT "golden_examples_kind_check" CHECK("golden_examples"."example_kind" IN ('approved_outline', 'approved_script_bundle')),
	CONSTRAINT "golden_examples_generation_metadata_check" CHECK(("golden_examples"."generation_run_id" IS NULL AND "golden_examples"."model_id" IS NULL AND "golden_examples"."prompt_version" IS NULL) OR ("golden_examples"."generation_run_id" IS NOT NULL AND "golden_examples"."model_id" IS NOT NULL AND "golden_examples"."prompt_version" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `golden_examples_project_kind_payload_uq` ON `golden_examples` (`project_id`,`example_kind`,`payload_checksum`);--> statement-breakpoint
CREATE INDEX `golden_examples_project_kind_revision_idx` ON `golden_examples` (`project_id`,`example_kind`,`project_revision`);--> statement-breakpoint
CREATE INDEX `golden_examples_project_model_idx` ON `golden_examples` (`project_id`,`model_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `improvement_decisions` (
	`decision_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`project_id` text NOT NULL,
	`project_revision_before` integer NOT NULL,
	`project_revision_after` integer NOT NULL,
	`task_kind` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`decision` text NOT NULL,
	`before_json` text NOT NULL,
	`after_json` text,
	`reason` text,
	`model_id` text NOT NULL,
	`prompt_version` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `ai_generation_candidates`(`candidate_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "improvement_decisions_task_kind_check" CHECK("improvement_decisions"."task_kind" IN ('outline_generation', 'visual_search_intent')),
	CONSTRAINT "improvement_decisions_target_kind_check" CHECK("improvement_decisions"."target_kind" IN ('outline', 'visual_line_range')),
	CONSTRAINT "improvement_decisions_decision_check" CHECK("improvement_decisions"."decision" IN ('accepted', 'rejected')),
	CONSTRAINT "improvement_decisions_after_json_check" CHECK(("improvement_decisions"."decision" = 'rejected' AND "improvement_decisions"."after_json" IS NULL) OR ("improvement_decisions"."decision" = 'accepted' AND "improvement_decisions"."after_json" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `improvement_decisions_candidate_decision_uq` ON `improvement_decisions` (`candidate_id`,`decision`);--> statement-breakpoint
CREATE INDEX `improvement_decisions_project_task_idx` ON `improvement_decisions` (`project_id`,`task_kind`,`target_kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `improvement_decisions_candidate_idx` ON `improvement_decisions` (`candidate_id`);