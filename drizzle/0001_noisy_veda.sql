CREATE TABLE `code_pools` (
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`name` text NOT NULL,
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
	`id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
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
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distributor_spaces_key_hash_unique` ON `distributor_spaces` (`key_hash`);--> statement-breakpoint
CREATE TABLE `redemption_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`pool_id` text NOT NULL,
	`code` text NOT NULL,
	`claim_status` text DEFAULT 'unclaimed' NOT NULL,
	`claimed_at` integer,
	`remark` text,
	`user_marked_used` integer DEFAULT false NOT NULL,
	`user_marked_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`pool_id`) REFERENCES `code_pools`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "code_length_check" CHECK(length("redemption_codes"."code") BETWEEN 1 AND 100),
	CONSTRAINT "remark_length_check" CHECK("redemption_codes"."remark" IS NULL OR length("redemption_codes"."remark") <= 500),
	CONSTRAINT "claim_state_check" CHECK(("redemption_codes"."claim_status" = 'unclaimed' AND "redemption_codes"."claimed_at" IS NULL AND "redemption_codes"."remark" IS NULL) OR ("redemption_codes"."claim_status" = 'claimed' AND "redemption_codes"."claimed_at" IS NOT NULL)),
	CONSTRAINT "used_state_check" CHECK(("redemption_codes"."user_marked_used" = 0 AND "redemption_codes"."user_marked_used_at" IS NULL) OR ("redemption_codes"."user_marked_used" = 1 AND "redemption_codes"."user_marked_used_at" IS NOT NULL AND "redemption_codes"."claim_status" = 'claimed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codes_pool_code_unique` ON `redemption_codes` (`pool_id`,`code`);--> statement-breakpoint
CREATE INDEX `codes_pool_status_idx` ON `redemption_codes` (`pool_id`,`claim_status`);