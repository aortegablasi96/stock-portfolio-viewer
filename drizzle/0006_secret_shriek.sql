CREATE TABLE `flex_equity_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`currency` text NOT NULL,
	`report_date` integer NOT NULL,
	`cash` real NOT NULL,
	`stock` real NOT NULL,
	`options` real NOT NULL,
	`dividend_accruals` real NOT NULL,
	`interest_accruals` real NOT NULL,
	`broker_fees_accruals` real NOT NULL,
	`total` real NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flex_equity_summaries_statement_id` ON `flex_equity_summaries` (`statement_id`);--> statement-breakpoint
CREATE INDEX `idx_flex_equity_summaries_report_date` ON `flex_equity_summaries` (`report_date`);