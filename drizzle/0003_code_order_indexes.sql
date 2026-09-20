CREATE INDEX `codes_pool_status_created_id_idx` ON `redemption_codes` (`pool_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `codes_pool_created_id_idx` ON `redemption_codes` (`pool_id`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `codes_pool_status_idx`;
