CREATE TABLE `snapshot_holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`conid` integer NOT NULL,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real NOT NULL,
	`average_cost` integer,
	`market_price` integer,
	`market_value` integer NOT NULL,
	`currency` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_snapshot_holdings_snapshot_id` ON `snapshot_holdings` (`snapshot_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` integer NOT NULL,
	`source` text DEFAULT 'ibkr' NOT NULL,
	`base_currency` text NOT NULL,
	`total_market_value` integer NOT NULL,
	`net_liquidation` integer NOT NULL,
	`total_cash` integer NOT NULL,
	`holdings_count` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_snapshots_captured_at` ON `snapshots` (`captured_at`);