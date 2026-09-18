CREATE TABLE `code_pools` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`space_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`claim_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `distributor_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pool_name_check" CHECK(length("code_pools"."name") > 0),
	CONSTRAINT "pool_status_check" CHECK("code_pools"."status" IN ('active', 'stopped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `code_pools_claim_key_unique` ON `code_pools` (`claim_key`);--> statement-breakpoint
CREATE INDEX `pools_space_idx` ON `code_pools` (`space_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pools_space_name_unique` ON `code_pools` (`space_id`,`name`);--> statement-breakpoint
CREATE TABLE `distributor_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`space_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`space_id`) REFERENCES `distributor_spaces`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_expiry_check" CHECK("distributor_sessions"."expires_at" > "distributor_sessions"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distributor_sessions_token_hash_unique` ON `distributor_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_space_idx` ON `distributor_sessions` (`space_id`);--> statement-breakpoint
CREATE INDEX `sessions_expiry_idx` ON `distributor_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `distributor_spaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distributor_spaces_key_hash_unique` ON `distributor_spaces` (`key_hash`);--> statement-breakpoint
CREATE TABLE `redemption_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pool_id` integer NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'unclaimed' NOT NULL,
	`claimed_at` integer,
	`remark` text,
	`redeemed_marked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `code_pools`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "code_length_check" CHECK(length("redemption_codes"."code") BETWEEN 1 AND 100),
	CONSTRAINT "remark_length_check" CHECK("redemption_codes"."remark" IS NULL OR length("redemption_codes"."remark") <= 500),
	CONSTRAINT "code_status_check" CHECK("redemption_codes"."status" IN ('unclaimed', 'claimed', 'redeemed')),
	CONSTRAINT "claim_state_check" CHECK(("redemption_codes"."status" != 'unclaimed' OR "redemption_codes"."claimed_at" IS NULL) AND ("redemption_codes"."status" != 'claimed' OR "redemption_codes"."claimed_at" IS NOT NULL) AND ("redemption_codes"."claimed_at" IS NOT NULL OR "redemption_codes"."remark" IS NULL)),
	CONSTRAINT "redeemed_state_check" CHECK(("redemption_codes"."status" = 'redeemed' AND "redemption_codes"."redeemed_marked_at" IS NOT NULL) OR ("redemption_codes"."status" != 'redeemed' AND "redemption_codes"."redeemed_marked_at" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codes_pool_code_unique` ON `redemption_codes` (`pool_id`,`code`);--> statement-breakpoint
CREATE INDEX `codes_pool_status_idx` ON `redemption_codes` (`pool_id`,`status`);
