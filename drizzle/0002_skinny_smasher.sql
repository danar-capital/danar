CREATE TABLE `scheduler_google_connections` (
	`workspace_id` text NOT NULL,
	`interviewer_id` text NOT NULL,
	`google_email` text NOT NULL,
	`access_token_cipher` text NOT NULL,
	`access_token_iv` text NOT NULL,
	`refresh_token_cipher` text,
	`refresh_token_iv` text,
	`expires_at` integer NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`workspace_id`, `interviewer_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `scheduler_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scheduler_google_connections_workspace` ON `scheduler_google_connections` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `scheduler_google_meetings` (
	`workspace_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`interviewer_id` text NOT NULL,
	`google_event_id` text NOT NULL,
	`meet_link` text DEFAULT '' NOT NULL,
	`calendar_link` text DEFAULT '' NOT NULL,
	`sync_status` text DEFAULT 'pending' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`scheduled_start` text NOT NULL,
	`scheduled_end` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`workspace_id`, `schedule_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `scheduler_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scheduler_google_meetings_interviewer` ON `scheduler_google_meetings` (`workspace_id`,`interviewer_id`);--> statement-breakpoint
CREATE INDEX `idx_scheduler_google_meetings_status` ON `scheduler_google_meetings` (`workspace_id`,`sync_status`);--> statement-breakpoint
CREATE TABLE `scheduler_google_oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`interviewer_id` text NOT NULL,
	`login_hint` text DEFAULT '' NOT NULL,
	`code_verifier` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `scheduler_workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scheduler_google_oauth_states_workspace` ON `scheduler_google_oauth_states` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_scheduler_google_oauth_states_expires` ON `scheduler_google_oauth_states` (`expires_at`);