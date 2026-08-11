-- DEADZONE weekly ranking hardening for PostgreSQL/Neon.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS weekly_rankings_audit (
  id bigserial PRIMARY KEY,
  week_start date NOT NULL,
  player_key varchar(64) NOT NULL,
  old_row jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_rankings_audit_lookup
  ON weekly_rankings_audit (week_start, player_key, changed_at DESC);

CREATE OR REPLACE FUNCTION deadzone_audit_weekly_ranking_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO weekly_rankings_audit (week_start, player_key, old_row)
  VALUES (OLD.week_start, OLD.player_key, to_jsonb(OLD));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deadzone_audit_weekly_ranking_update ON weekly_rankings;
CREATE TRIGGER trg_deadzone_audit_weekly_ranking_update
AFTER UPDATE ON weekly_rankings
FOR EACH ROW
EXECUTE FUNCTION deadzone_audit_weekly_ranking_update();

CREATE OR REPLACE FUNCTION deadzone_block_ranking_destructive_action()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'DEADZONE ranking protection: DELETE/TRUNCATE is blocked. Use a controlled recovery procedure.';
END;
$$;

DROP TRIGGER IF EXISTS trg_deadzone_block_weekly_rankings_delete ON weekly_rankings;
CREATE TRIGGER trg_deadzone_block_weekly_rankings_delete
BEFORE DELETE OR TRUNCATE ON weekly_rankings
FOR EACH STATEMENT
EXECUTE FUNCTION deadzone_block_ranking_destructive_action();

DROP TRIGGER IF EXISTS trg_deadzone_block_round_awards_delete ON weekly_round_awards;
CREATE TRIGGER trg_deadzone_block_round_awards_delete
BEFORE DELETE OR TRUNCATE ON weekly_round_awards
FOR EACH STATEMENT
EXECUTE FUNCTION deadzone_block_ranking_destructive_action();

COMMENT ON TABLE weekly_rankings_audit IS
  'Append-only audit snapshots of weekly_rankings before updates. Used for recovery and troubleshooting.';
