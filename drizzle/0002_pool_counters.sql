ALTER TABLE `code_pools` ADD `total_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_pools` ADD `unclaimed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_pools` ADD `redeemed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `code_pools` ADD `claimed_total_count` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH counts AS MATERIALIZED (
  SELECT p.id,
    count(r.id) AS total_count,
    coalesce(sum(r.status = 'unclaimed'), 0) AS unclaimed_count,
    coalesce(sum(r.status = 'redeemed'), 0) AS redeemed_count,
    sum(r.claimed_at IS NOT NULL) AS claimed_total_count
  FROM code_pools p
  LEFT JOIN redemption_codes r ON r.pool_id = p.id
  GROUP BY p.id
)
UPDATE code_pools
SET (total_count, unclaimed_count, redeemed_count, claimed_total_count) = (
  SELECT total_count, unclaimed_count, redeemed_count, claimed_total_count
  FROM counts WHERE counts.id = code_pools.id
);
