USE little_table;

-- Keep the user's estimated allowance bounded per template. Existing balances
-- above the new ceiling are reduced so the client will stop requesting grants.
UPDATE wechat_subscription_credits
SET available_count = 10
WHERE available_count > 10;
