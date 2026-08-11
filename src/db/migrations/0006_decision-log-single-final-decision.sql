DROP INDEX `improvement_decisions_candidate_decision_uq`;--> statement-breakpoint
CREATE UNIQUE INDEX `improvement_decisions_candidate_uq` ON `improvement_decisions` (`candidate_id`);