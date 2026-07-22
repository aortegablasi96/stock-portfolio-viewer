CREATE TABLE `flex_prior_period_positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`conid` integer,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`asset_category` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_to_base` real NOT NULL,
	`date` integer NOT NULL,
	`price` real,
	`prior_mtm_pnl` real NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flex_prior_period_positions_statement_id` ON `flex_prior_period_positions` (`statement_id`);--> statement-breakpoint
CREATE INDEX `idx_flex_prior_period_positions_date` ON `flex_prior_period_positions` (`date`);