CREATE TABLE `flex_open_dividend_accruals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`conid` integer,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`asset_category` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_to_base` real NOT NULL,
	`ex_date` integer,
	`pay_date` integer,
	`quantity` real NOT NULL,
	`gross_rate` real,
	`gross_amount` real NOT NULL,
	`tax` real NOT NULL,
	`fee` real NOT NULL,
	`net_amount` real NOT NULL,
	`code` text NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flex_open_dividend_accruals_statement_id` ON `flex_open_dividend_accruals` (`statement_id`);--> statement-breakpoint
CREATE INDEX `idx_flex_open_dividend_accruals_pay_date` ON `flex_open_dividend_accruals` (`pay_date`);