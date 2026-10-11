-- Add quota and expiration to subscriptions table
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS quota_remaining INTEGER NOT NULL DEFAULT 0;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Create an RPC to safely consume quota atomically
CREATE OR REPLACE FUNCTION consume_subscription_quota(
  p_user_uid TEXT,
  p_required_quota INTEGER DEFAULT 1
) RETURNS JSONB AS $$
DECLARE
  v_sub subscriptions%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- Lock the row for update to prevent concurrent race conditions
  SELECT * INTO v_sub 
  FROM subscriptions 
  WHERE user_uid = p_user_uid 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'No active subscription found.');
  END IF;

  IF v_sub.status != 'active' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Subscription is not active.');
  END IF;

  IF v_sub.expires_at IS NOT NULL AND v_sub.expires_at < v_now THEN
    -- Auto-expire the subscription
    UPDATE subscriptions SET status = 'expired', updated_at = v_now WHERE user_uid = p_user_uid;
    RETURN jsonb_build_object('allowed', false, 'reason', 'Subscription has expired.');
  END IF;

  IF v_sub.quota_remaining < p_required_quota THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Insufficient quota remaining.');
  END IF;

  -- Consume quota
  UPDATE subscriptions 
  SET 
    quota_remaining = quota_remaining - p_required_quota,
    updated_at = v_now
  WHERE user_uid = p_user_uid;

  RETURN jsonb_build_object(
    'allowed', true, 
    'remaining', v_sub.quota_remaining - p_required_quota,
    'plan_id', v_sub.plan_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create an RPC to safely restore quota atomically (e.g. on generation failure)
CREATE OR REPLACE FUNCTION restore_subscription_quota(
  p_user_uid TEXT,
  p_restored_quota INTEGER DEFAULT 1
) RETURNS JSONB AS $$
DECLARE
  v_sub subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_sub 
  FROM subscriptions 
  WHERE user_uid = p_user_uid 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'No active subscription found.');
  END IF;

  UPDATE subscriptions 
  SET 
    quota_remaining = quota_remaining + p_restored_quota,
    updated_at = NOW()
  WHERE user_uid = p_user_uid;

  RETURN jsonb_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
