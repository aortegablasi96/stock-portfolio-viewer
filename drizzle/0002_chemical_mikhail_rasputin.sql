CREATE TABLE `flex_cash_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`dedupe_key` text NOT NULL,
	`transaction_id` text NOT NULL,
	`conid` integer,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`asset_category` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_to_base` real NOT NULL,
	`date_time` integer,
	`settle_date` integer,
	`ex_date` integer,
	`amount` real NOT NULL,
	`type` text NOT NULL,
	`dividend_type` text NOT NULL,
	`code` text NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_flex_cash_transactions_dedupe_key` ON `flex_cash_transactions` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_flex_cash_transactions_type` ON `flex_cash_transactions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_flex_cash_transactions_date_time` ON `flex_cash_transactions` (`date_time`);--> statement-breakpoint
CREATE INDEX `idx_flex_cash_transactions_conid` ON `flex_cash_transactions` (`conid`);--> statement-breakpoint
CREATE TABLE `flex_fifo_summaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`conid` integer,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`asset_category` text NOT NULL,
	`realized_st_profit` real NOT NULL,
	`realized_st_loss` real NOT NULL,
	`realized_lt_profit` real NOT NULL,
	`realized_lt_loss` real NOT NULL,
	`total_realized_pnl` real NOT NULL,
	`unrealized_profit` real NOT NULL,
	`unrealized_loss` real NOT NULL,
	`total_unrealized_pnl` real NOT NULL,
	`total_fifo_pnl` real NOT NULL,
	`transferred_pnl` real NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flex_fifo_summaries_statement_id` ON `flex_fifo_summaries` (`statement_id`);--> statement-breakpoint
CREATE TABLE `flex_lots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`conid` integer,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_to_base` real NOT NULL,
	`date_time` integer,
	`trade_date` integer,
	`quantity` real NOT NULL,
	`trade_price` real,
	`cost` real,
	`fifo_pnl_realized` real,
	`open_close_indicator` text NOT NULL,
	`notes` text NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flex_lots_statement_id` ON `flex_lots` (`statement_id`);--> statement-breakpoint
CREATE TABLE `flex_nav_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`currency` text NOT NULL,
	`from_date` integer NOT NULL,
	`to_date` integer NOT NULL,
	`starting_value` real NOT NULL,
	`ending_value` real NOT NULL,
	`mtm` real NOT NULL,
	`deposits_withdrawals` real NOT NULL,
	`dividends` real NOT NULL,
	`withholding_tax` real NOT NULL,
	`interest` real NOT NULL,
	`commissions` real NOT NULL,
	`twr` real NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flex_nav_changes_statement_id` ON `flex_nav_changes` (`statement_id`);--> statement-breakpoint
CREATE TABLE `flex_open_positions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`conid` integer,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`asset_category` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_to_base` real NOT NULL,
	`report_date` integer,
	`position` real NOT NULL,
	`mark_price` real,
	`cost_basis_price` real,
	`cost_basis_money` real,
	`percent_of_nav` real,
	`fifo_pnl_unrealized` real,
	`side` text NOT NULL,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flex_open_positions_statement_id` ON `flex_open_positions` (`statement_id`);--> statement-breakpoint
CREATE INDEX `idx_flex_open_positions_conid` ON `flex_open_positions` (`conid`);--> statement-breakpoint
CREATE TABLE `flex_securities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`conid` integer,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`asset_category` text NOT NULL,
	`sub_category` text NOT NULL,
	`currency` text NOT NULL,
	`listing_exchange` text NOT NULL,
	`issuer_country_code` text NOT NULL,
	`isin` text NOT NULL,
	`cusip` text NOT NULL,
	`multiplier` real,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_flex_securities_statement_id` ON `flex_securities` (`statement_id`);--> statement-breakpoint
CREATE INDEX `idx_flex_securities_conid` ON `flex_securities` (`conid`);--> statement-breakpoint
CREATE TABLE `flex_statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`from_date` integer NOT NULL,
	`to_date` integer NOT NULL,
	`period` text NOT NULL,
	`when_generated` integer NOT NULL,
	`base_currency` text NOT NULL,
	`source_filename` text NOT NULL,
	`imported_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_flex_statements_identity` ON `flex_statements` (`account_id`,`from_date`,`to_date`,`when_generated`);--> statement-breakpoint
CREATE TABLE `flex_trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`statement_id` integer NOT NULL,
	`trade_key` text NOT NULL,
	`conid` integer,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`asset_category` text NOT NULL,
	`currency` text NOT NULL,
	`fx_rate_to_base` real NOT NULL,
	`date_time` integer,
	`trade_date` integer,
	`settle_date` integer,
	`transaction_type` text NOT NULL,
	`exchange` text NOT NULL,
	`quantity` real NOT NULL,
	`trade_price` real NOT NULL,
	`trade_money` real,
	`proceeds` real,
	`taxes` real,
	`ib_commission` real,
	`ib_commission_currency` text NOT NULL,
	`net_cash` real,
	`close_price` real,
	`open_close_indicator` text NOT NULL,
	`cost` real,
	`fifo_pnl_realized` real,
	`mtm_pnl` real,
	FOREIGN KEY (`statement_id`) REFERENCES `flex_statements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_flex_trades_trade_key` ON `flex_trades` (`trade_key`);--> statement-breakpoint
CREATE INDEX `idx_flex_trades_conid` ON `flex_trades` (`conid`);--> statement-breakpoint
CREATE INDEX `idx_flex_trades_date_time` ON `flex_trades` (`date_time`);