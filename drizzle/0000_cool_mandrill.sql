CREATE TABLE `scheduler_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `scheduler_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scheduler_sessions_workspace_id` ON `scheduler_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_scheduler_sessions_expires_at` ON `scheduler_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `scheduler_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`state_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scheduler_workspaces_code_hash` ON `scheduler_workspaces` (`code_hash`);