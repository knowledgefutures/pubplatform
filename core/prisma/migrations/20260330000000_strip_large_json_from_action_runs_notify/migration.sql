-- Strip large JSON columns (config, result, json, params) from the action_runs
-- notify payload to avoid exceeding pg_notify's 8000 byte limit.
CREATE OR REPLACE FUNCTION notify_change_action_runs()
    RETURNS TRIGGER AS
$$
DECLARE
    correct_row jsonb;
    community_id text;
BEGIN

    IF (NEW."pubId" IS NULL) THEN
        RETURN NEW;
    ELSE
        correct_row = to_jsonb(NEW) - 'config' - 'result' - 'json' - 'params';
    END IF;

    select into community_id "communityId" from "pubs" where "id" = correct_row->>'pubId'::text;

    PERFORM notify_change(
        correct_row,
        community_id,
        TG_TABLE_NAME,
        TG_OP
    );

    RETURN NEW;
END;
$$
LANGUAGE plpgsql;
