CREATE TABLE `scheduler_workspace_creation_limits` (
	`bucket_hash` text NOT NULL,
	`window_start` integer NOT NULL,
	`attempts` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_scheduler_workspace_creation_limits_bucket_window` ON `scheduler_workspace_creation_limits` (`bucket_hash`,`window_start`);--> statement-breakpoint
CREATE INDEX `idx_scheduler_workspace_creation_limits_window_start` ON `scheduler_workspace_creation_limits` (`window_start`);