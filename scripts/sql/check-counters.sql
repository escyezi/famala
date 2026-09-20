WITH actual AS (
  SELECT p.id,
    count(r.id) AS total_count,
    coalesce(sum(r.status = 'unclaimed'), 0) AS unclaimed_count,
    coalesce(sum(r.status = 'redeemed'), 0) AS redeemed_count,
    sum(r.claimed_at IS NOT NULL) AS claimed_total_count
  FROM code_pools p
  LEFT JOIN redemption_codes r ON r.pool_id = p.id
  GROUP BY p.id
)
SELECT p.id,
  p.total_count, a.total_count AS expected_total_count,
  p.unclaimed_count, a.unclaimed_count AS expected_unclaimed_count,
  p.redeemed_count, a.redeemed_count AS expected_redeemed_count,
  p.claimed_total_count, a.claimed_total_count AS expected_claimed_total_count
FROM code_pools p JOIN actual a ON a.id = p.id
WHERE p.total_count != a.total_count
  OR p.unclaimed_count != a.unclaimed_count
  OR p.redeemed_count != a.redeemed_count
  OR p.claimed_total_count != a.claimed_total_count;
