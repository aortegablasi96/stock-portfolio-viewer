CREATE TABLE `instrument_classifications` (
	`conid` integer PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`sector` text NOT NULL,
	`industry` text NOT NULL,
	`source` text DEFAULT 'ibkr' NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_instrument_classifications_symbol` ON `instrument_classifications` (`symbol`);