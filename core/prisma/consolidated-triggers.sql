-- Consolidated triggers and functions

-- Table: PubsInStages

CREATE OR REPLACE FUNCTION cancel_scheduled_automations_on_pub_leave()
    RETURNS TRIGGER
    AS $$
DECLARE
    scheduled_run RECORD;
    community RECORD;
BEGIN
    -- only handle DELETE operations
    IF TG_OP != 'DELETE' THEN
        RETURN OLD;
    END IF;
    -- get community information
    SELECT
        c.id,
        c.slug INTO community
    FROM
        pubs p
        JOIN communities c ON p."communityId" = c.id
    WHERE
        p.id = OLD."pubId";
    -- loop through all scheduled action runs for this pub on this stage
    -- we need to traverse: action_runs -> automation_runs -> automations to find the stage
    FOR scheduled_run IN
    SELECT
        ar.id AS "actionRunId",
        arun.id AS "automationRunId",
        arun."automationId",
        a."stageId"
    FROM
        action_runs ar
        INNER JOIN automation_runs arun ON arun.id = ar."automationRunId"
        INNER JOIN automations a ON a.id = arun."automationId"
    WHERE
        ar."pubId" = OLD."pubId"
        AND a."stageId" = OLD."stageId"
        AND ar.status = 'scheduled'
        AND ar.event = 'pubInStageForDuration' LOOP
            -- emit cancellation event for each scheduled run
            PERFORM
                graphile_worker.add_job('emitEvent', json_build_object('type', 'CancelScheduledAutomation', 'automationRunId', scheduled_run."automationRunId", 'pubId', OLD."pubId", 'stageId', OLD."stageId", 'community', community));
        END LOOP;
    RETURN OLD;
END;
$$
LANGUAGE plpgsql
VOLATILE;


CREATE OR REPLACE FUNCTION emit_pub_stage_change_event()
    RETURNS TRIGGER
    AS $$
DECLARE
    automation RECORD;
    community RECORD;
    target_event "AutomationEvent";
BEGIN
    -- determine the event type based on operation
    IF TG_OP = 'INSERT' THEN
        target_event := 'pubEnteredStage';
    ELSIF TG_OP = 'DELETE' THEN
        target_event := 'pubLeftStage';
    ELSE
        RETURN NULL;
    END IF;
    -- get community information
    IF TG_OP = 'INSERT' THEN
        SELECT
            c.id,
            c.slug INTO community
        FROM
            pubs p
            JOIN communities c ON p."communityId" = c.id
        WHERE
            p.id = NEW."pubId";
    ELSIF TG_OP = 'DELETE' THEN
        SELECT
            c.id,
            c.slug INTO community
        FROM
            pubs p
            JOIN communities c ON p."communityId" = c.id
        WHERE
            p.id = OLD."pubId";
    END IF;
    -- loop through all automation triggers for this stage with the matching event
    FOR automation IN SELECT DISTINCT
        a.id AS "automationId",
        a."stageId"
    FROM
        automations a
        INNER JOIN automation_triggers at ON at."automationId" = a.id
    WHERE
        a."stageId" = CASE WHEN TG_OP = 'INSERT' THEN
            NEW."stageId"
        WHEN TG_OP = 'DELETE' THEN
            OLD."stageId"
        END
        AND at.event = target_event LOOP
            -- emit an event for each automation
            PERFORM
                graphile_worker.add_job('emitEvent', json_build_object('type', 'RunAutomation', 'automationId', automation."automationId", 'pubId', CASE WHEN TG_OP = 'INSERT' THEN
                            NEW."pubId"
                        WHEN TG_OP = 'DELETE' THEN
                            OLD."pubId"
                        END, 'stageId', CASE WHEN TG_OP = 'INSERT' THEN
                            NEW."stageId"
                        WHEN TG_OP = 'DELETE' THEN
                            OLD."stageId"
                        END, 'trigger', json_build_object('event', target_event, 'config', NULL), 'community', community, 'stack', '[]'::json));
        END LOOP;
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    ELSE
        RETURN OLD;
    END IF;
END;
$$
LANGUAGE plpgsql
VOLATILE;


CREATE OR REPLACE FUNCTION schedule_pub_in_stage_for_duration()
    RETURNS TRIGGER
    AS $$
DECLARE
    automation RECORD;
    community RECORD;
BEGIN
    -- only handle INSERT operations
    IF TG_OP != 'INSERT' THEN
        RETURN NEW;
    END IF;
    -- get community information
    SELECT
        c.id,
        c.slug INTO community
    FROM
        pubs p
        JOIN communities c ON p."communityId" = c.id
    WHERE
        p.id = NEW."pubId";
    -- loop through all pubInStageForDuration automation triggers on this stage
    FOR automation IN SELECT DISTINCT
        a.id AS "automationId"
    FROM
        automations a
        INNER JOIN automation_triggers at ON at."automationId" = a.id
    WHERE
        a."stageId" = NEW."stageId"
        AND at.event = 'pubInStageForDuration' LOOP
            -- emit a scheduling event for each specific automation
            PERFORM
                graphile_worker.add_job('emitEvent', json_build_object('type', 'ScheduleDelayedAutomation', 'automationId', automation."automationId", 'pubId', NEW."pubId", 'stageId', NEW."stageId", 'trigger', json_build_object('event', 'pubInStageForDuration', 'config', NULL), 'community', community, 'stack', '[]'::json));
        END LOOP;
    RETURN NEW;
END;
$$
LANGUAGE plpgsql
VOLATILE;


CREATE OR REPLACE FUNCTION update_pub_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE "pubs"
    -- it's fine to use CURRENT_TIMESTAMP here because we're inside a transaction
    -- and the timestamp will be the same for all rows in the transaction
    SET "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = CASE
        WHEN TG_OP = 'DELETE' THEN OLD."pubId"
        ELSE NEW."pubId"
    END;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER trigger_pubs_in_stages_update_pub
    AFTER INSERT OR UPDATE OR DELETE ON "PubsInStages"
    FOR EACH ROW
    EXECUTE FUNCTION update_pub_updated_at();

CREATE TRIGGER pub_stage_change
    AFTER INSERT OR DELETE ON "PubsInStages"
    FOR EACH ROW
    EXECUTE FUNCTION emit_pub_stage_change_event();

CREATE TRIGGER schedule_duration_automations
    AFTER INSERT ON "PubsInStages"
    FOR EACH ROW
    EXECUTE FUNCTION schedule_pub_in_stage_for_duration();

CREATE TRIGGER cancel_scheduled_on_leave
    AFTER DELETE ON "PubsInStages"
    FOR EACH ROW
    EXECUTE FUNCTION cancel_scheduled_automations_on_pub_leave();


-- Table: _PubFieldToPubType

CREATE OR REPLACE FUNCTION update_pub_title_for_pub_type() RETURNS TRIGGER AS $$
BEGIN

    UPDATE "pubs"
    SET "title" = title_values.value
    FROM (
        SELECT DISTINCT ON (p.id)
            p.id as pub_id,
            (
                SELECT pv.value #>> '{}'
                FROM "pub_values" pv
                JOIN "_PubFieldToPubType" pft ON 
                    pft."A" = pv."fieldId" AND
                    pft."B" = p."pubTypeId" AND
                    pft."isTitle" = true
                WHERE pv."pubId" = p.id
            ) as value
        FROM "pubs" p
        WHERE p."pubTypeId" = COALESCE(NEW."B", OLD."B")
    ) title_values
    WHERE "pubs"."id" = title_values.pub_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER trigger_pub_field_to_pub_type_insert_pub_title
AFTER INSERT ON "_PubFieldToPubType"
FOR EACH ROW
WHEN (NEW."isTitle" IS TRUE)
EXECUTE FUNCTION update_pub_title_for_pub_type();

CREATE TRIGGER trigger_pub_field_to_pub_type_update_pub_title
AFTER UPDATE ON "_PubFieldToPubType"
FOR EACH ROW
WHEN (NEW."isTitle" IS DISTINCT FROM OLD."isTitle")
EXECUTE FUNCTION update_pub_title_for_pub_type();

CREATE TRIGGER trigger_pub_field_to_pub_type_delete_pub_title
AFTER DELETE ON "_PubFieldToPubType"
FOR EACH ROW
WHEN (OLD."isTitle" IS TRUE)
EXECUTE FUNCTION update_pub_title_for_pub_type();


-- Table: action_runs

CREATE OR REPLACE FUNCTION compute_automation_run_status()
  RETURNS TRIGGER
  AS $$
DECLARE
  new_status "ActionRunStatus";
  old_status "ActionRunStatus";
  target_event "AutomationEvent";
  community RECORD;
  action_stack text[];
  source_automation_id text;
  source_automation_run_id text := NULL;
  watched_automation RECORD;
BEGIN
  -- early returns: skip if no automation run or status unchanged
  IF NEW."automationRunId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;
  -- get current status before update
  SELECT
    status INTO old_status
  FROM
    automation_runs
  WHERE
    id = NEW."automationRunId";
  -- compute new status from all action_runs
  SELECT
    CASE WHEN COUNT(*) FILTER (WHERE status = 'failure') > 0 THEN
      'failure'::"ActionRunStatus"
    WHEN COUNT(*) = COUNT(*) FILTER (WHERE status = 'success') THEN
      'success'::"ActionRunStatus"
    WHEN COUNT(*) = COUNT(*) FILTER (WHERE status = 'scheduled') THEN
      'scheduled'::"ActionRunStatus"
    WHEN COUNT(*) = COUNT(*) FILTER (WHERE status = 'pending') THEN
      'pending'::"ActionRunStatus"
    ELSE
      'pending'::"ActionRunStatus"
    END INTO new_status
  FROM
    action_runs
  WHERE
    "automationRunId" = NEW."automationRunId";
  -- if no action runs exist, leave status as null
  IF new_status IS NULL THEN
    RETURN NEW;
  END IF;
  -- update automation_run status
  UPDATE
    automation_runs
  SET
    status = new_status
  WHERE
    id = NEW."automationRunId";
  -- emit sequential automation events on terminal status
  IF new_status IN ('success', 'failure') AND (old_status IS NULL OR old_status != new_status) THEN
    -- determine event type
    target_event := CASE WHEN new_status = 'success' THEN
      'automationSucceeded'
    ELSE
      'automationFailed'
    END;
    SELECT
      ar."sourceAutomationRunId" INTO source_automation_run_id
    FROM
      automation_runs ar
    WHERE
      ar.id = NEW."automationRunId";
    -- get automation and community info
    SELECT
      "automationId" INTO source_automation_id
    FROM
      automation_runs
    WHERE
      id = NEW."automationRunId";
    IF source_automation_id IS NULL THEN
      RETURN NEW;
    END IF;
    SELECT
      c.id,
      c.slug INTO community
    FROM
      automations a
      JOIN communities c ON a."communityId" = c.id
    WHERE
      a.id = source_automation_id;
    -- build stack recursively from sourceAutomationRunId chain
    action_stack := build_automation_run_stack(NEW."automationRunId");
    -- emit event for each watching automation
    FOR watched_automation IN SELECT DISTINCT
      a.id AS "automationId",
      a."stageId"
    FROM
      automations a
      INNER JOIN automation_triggers at ON at."automationId" = a.id
    WHERE
      at."sourceAutomationId" = source_automation_id
      AND at.event = target_event LOOP
        PERFORM
          graphile_worker.add_job('emitEvent', json_build_object('type', 'RunAutomation', 'automationId', watched_automation."automationId", 'sourceAutomationRunId', source_automation_run_id, 'automationRunId', NEW."automationRunId", 'pubId', NEW."pubId", 'stageId', watched_automation."stageId", 'trigger', json_build_object('event', target_event, 'config', NULL), 'community', community, 'stack', action_stack || ARRAY[NEW."automationRunId"]));
      END LOOP;
  END IF;
  RETURN NEW;
END;
$$
LANGUAGE plpgsql
VOLATILE;


CREATE TRIGGER compute_automation_run_status_trigger
  AFTER INSERT OR UPDATE ON action_runs
  FOR EACH ROW
  EXECUTE FUNCTION compute_automation_run_status();


-- Table: automations

CREATE OR REPLACE FUNCTION reparent_automation_runs_on_delete()
  RETURNS TRIGGER
  AS $$
DECLARE
  dummy_automation_id text;
BEGIN
  -- don't reparent if we're deleting the dummy itself
  IF OLD."stageId" IS NULL AND OLD.name = 'Deleted Automations' THEN
    RETURN OLD;
  END IF;
  -- find the dummy automation for this community
  SELECT
    a.id INTO dummy_automation_id
  FROM
    "automations" a
  WHERE
    a."communityId" = OLD."communityId"
    AND a."stageId" IS NULL
    AND a.name = 'Deleted Automations'
  LIMIT 1;
  -- re-parent all automation_runs from the deleted automation to the dummy
  IF dummy_automation_id IS NOT NULL THEN
    UPDATE
      "automation_runs"
    SET
      "automationId" = dummy_automation_id
    WHERE
      "automationId" = OLD.id;
  END IF;
  RETURN OLD;
END;
$$
LANGUAGE plpgsql;


CREATE TRIGGER reparent_automation_runs_before_automation_delete
  BEFORE DELETE ON "automations"
  FOR EACH ROW
  EXECUTE FUNCTION reparent_automation_runs_on_delete();


-- Table: communities

CREATE OR REPLACE FUNCTION create_dummy_automation_for_community()
  RETURNS TRIGGER
  AS $$
BEGIN
  INSERT INTO "automations"(id, name, description, "communityId", "stageId", "createdAt", "updatedAt")
    VALUES(gen_random_uuid(), 'Deleted Automations', 'Placeholder automation for re-parenting runs from deleted automations', NEW.id, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  RETURN NEW;
END;
$$
LANGUAGE plpgsql;


CREATE TRIGGER create_dummy_automation_after_community_insert
  AFTER INSERT ON "communities"
  FOR EACH ROW
  EXECUTE FUNCTION create_dummy_automation_for_community();


-- Table: invite_forms

CREATE OR REPLACE FUNCTION check_invite_pubtype_agreement () RETURNS TRIGGER AS $$
    DECLARE
        pub_pub_type RECORD;
        form_pub_type RECORD;
    BEGIN
        IF (NEW.type != 'pub') THEN
            RETURN NEW;
        END IF;

        SELECT pt.id, pt.name INTO pub_pub_type FROM invites
        JOIN pubs ON invites."pubId" = pubs.id
        JOIN pub_types pt ON pt.id = pubs."pubTypeId"
        WHERE invites.id = NEW."inviteId";

        SELECT pt.id, pt.name INTO form_pub_type
        FROM forms JOIN pub_types pt ON pt.id = forms."pubTypeId"
        WHERE forms.id = NEW."formId";

        IF (pub_pub_type.id != form_pub_type.id) THEN
            RAISE EXCEPTION 'Invitation failed. The specified form is for % pubs but this pub''s type is %', form_pub_type.name, pub_pub_type.name;
        END IF;
        RETURN NEW;
    END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER check_invite_pubtype_agreement
AFTER INSERT ON "invite_forms" FOR EACH ROW
EXECUTE FUNCTION check_invite_pubtype_agreement ();


-- Table: invites

CREATE OR REPLACE FUNCTION f_generic_history()
    RETURNS TRIGGER
    AS $$
DECLARE
    v_primary_key_column_name text := TG_ARGV[0];
    vc_insert_sql constant text := 'insert into ' || TG_TABLE_NAME || '_history ( "operationType", "oldRowData", "newRowData",  "' || v_primary_key_column_name || '", "userId", "apiAccessTokenId", "actionRunId", "other" ) values ( $1, $2, $3, $4, $5, $6, $7, $8 )';
    v_message text;
    v_detail text;
    v_hint text;
    v_last_modified_by_minus_timestamp text;
    v_type text;
    v_id text;
    v_userId text;
    v_apiAccessTokenId text;
    v_actionRunId text;
    v_other text;
    v_oldRowData json;
    v_operationType "OperationType";
    v_timestamp_new text;
    v_timestamp_old text;
BEGIN
    v_last_modified_by_minus_timestamp := split_part(NEW."lastModifiedBy", '|', 1);
    v_type := split_part(v_last_modified_by_minus_timestamp, ':', 1);
    v_id := split_part(v_last_modified_by_minus_timestamp, ':', 2);
    v_timestamp_new := split_part(NEW."lastModifiedBy", '|', 2);
    v_timestamp_old := split_part(OLD."lastModifiedBy", '|', 2);
    CASE v_type
    WHEN 'user' THEN
        v_userId := v_id;
    WHEN 'api-access-token' THEN
        v_apiAccessTokenId := v_id;
    WHEN 'action-run' THEN
        v_actionRunId := v_id;
    ELSE
        IF v_last_modified_by_minus_timestamp = 'system' THEN
                v_other := 'system';
    ELSIF v_last_modified_by_minus_timestamp = 'unknown' THEN
                v_other := NULL;
    ELSE
        RAISE EXCEPTION 'Invalid lastModifiedBy: %', NEW."lastModifiedBy";
            END IF;
    END CASE;
    IF TG_OP = 'INSERT' THEN
        EXECUTE vc_insert_sql
        USING 'insert'::"OperationType", NULL::json, row_to_json(NEW), NEW."id", v_userId, v_apiAccessTokenId, v_actionRunId, v_other;
    ELSIF (TG_OP = 'UPDATE'
            AND OLD IS DISTINCT FROM NEW) THEN
        -- check if the timestamp is the same (indicating no explicit lastModifiedBy was set)
        IF v_timestamp_new = v_timestamp_old THEN
            -- check if this is an automated update (foreign key cascade set null)
            -- by looking for id columns that changed from not-null to null
            IF EXISTS (
                SELECT
                    1
                FROM
                    json_each_text(row_to_json(OLD)) old_vals
                    JOIN json_each_text(row_to_json(NEW)) new_vals ON old_vals.key = new_vals.key
                WHERE
                    old_vals.key LIKE '%Id'
                    AND old_vals.value IS NOT NULL
                    AND new_vals.value IS NULL) THEN
            -- this is an automated update, set to system, all the other values are the old values
            v_userId := NULL;
            v_apiAccessTokenId := NULL;
            v_actionRunId := NULL;
            v_other := 'system';
        ELSE
            -- this is a missing lastModifiedBy, throw error
            RAISE EXCEPTION 'lastModifiedBy must be explicitly set in UPDATE';
        END IF;
    END IF;
        EXECUTE vc_insert_sql
        USING 'update'::"OperationType", row_to_json(OLD), row_to_json(NEW), NEW."id", v_userId, v_apiAccessTokenId, v_actionRunId, v_other;
    END IF;
        RETURN NULL;
END;
$$
LANGUAGE plpgsql;


CREATE TRIGGER trigger_invites_history
  AFTER INSERT OR UPDATE ON invites
  FOR EACH ROW
  EXECUTE FUNCTION f_generic_history('inviteId');


-- Table: pub_memberships

CREATE OR REPLACE FUNCTION check_pub_membership_pubtype_agreement () RETURNS TRIGGER AS $$
    DECLARE
        pub_pub_type RECORD;
        form_pub_type RECORD;
    BEGIN
        IF (NEW."formId" IS NULL) THEN
            RETURN NEW;
        END IF;

        SELECT pt.id, pt.name INTO pub_pub_type
        FROM pubs JOIN pub_types pt ON pt.id = pubs."pubTypeId"
        WHERE pubs.id = NEW."pubId";

        SELECT pt.id, pt.name INTO form_pub_type
        FROM forms JOIN pub_types pt ON pt.id = forms."pubTypeId"
        WHERE forms.id = NEW."formId";

        IF (pub_pub_type.id != form_pub_type.id) THEN
            RAISE EXCEPTION 'Pub membership creation failed. The specified form is for % pubs but this pub''s type is %', form_pub_type.name, pub_pub_type.name;
        END IF;
        RETURN NEW;
    END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER check_pub_membership_pubtype_agreement
AFTER INSERT ON "pub_memberships" FOR EACH ROW
EXECUTE FUNCTION check_pub_membership_pubtype_agreement ();


-- Table: pub_values

CREATE OR REPLACE FUNCTION f_generic_history()
    RETURNS TRIGGER
    AS $$
DECLARE
    v_primary_key_column_name text := TG_ARGV[0];
    vc_insert_sql constant text := 'insert into ' || TG_TABLE_NAME || '_history ( "operationType", "oldRowData", "newRowData",  "' || v_primary_key_column_name || '", "userId", "apiAccessTokenId", "actionRunId", "other" ) values ( $1, $2, $3, $4, $5, $6, $7, $8 )';
    v_message text;
    v_detail text;
    v_hint text;
    v_last_modified_by_minus_timestamp text;
    v_type text;
    v_id text;
    v_userId text;
    v_apiAccessTokenId text;
    v_actionRunId text;
    v_other text;
    v_oldRowData json;
    v_operationType "OperationType";
    v_timestamp_new text;
    v_timestamp_old text;
BEGIN
    v_last_modified_by_minus_timestamp := split_part(NEW."lastModifiedBy", '|', 1);
    v_type := split_part(v_last_modified_by_minus_timestamp, ':', 1);
    v_id := split_part(v_last_modified_by_minus_timestamp, ':', 2);
    v_timestamp_new := split_part(NEW."lastModifiedBy", '|', 2);
    v_timestamp_old := split_part(OLD."lastModifiedBy", '|', 2);
    CASE v_type
    WHEN 'user' THEN
        v_userId := v_id;
    WHEN 'api-access-token' THEN
        v_apiAccessTokenId := v_id;
    WHEN 'action-run' THEN
        v_actionRunId := v_id;
    ELSE
        IF v_last_modified_by_minus_timestamp = 'system' THEN
                v_other := 'system';
    ELSIF v_last_modified_by_minus_timestamp = 'unknown' THEN
                v_other := NULL;
    ELSE
        RAISE EXCEPTION 'Invalid lastModifiedBy: %', NEW."lastModifiedBy";
            END IF;
    END CASE;
    IF TG_OP = 'INSERT' THEN
        EXECUTE vc_insert_sql
        USING 'insert'::"OperationType", NULL::json, row_to_json(NEW), NEW."id", v_userId, v_apiAccessTokenId, v_actionRunId, v_other;
    ELSIF (TG_OP = 'UPDATE'
            AND OLD IS DISTINCT FROM NEW) THEN
        -- check if the timestamp is the same (indicating no explicit lastModifiedBy was set)
        IF v_timestamp_new = v_timestamp_old THEN
            -- check if this is an automated update (foreign key cascade set null)
            -- by looking for id columns that changed from not-null to null
            IF EXISTS (
                SELECT
                    1
                FROM
                    json_each_text(row_to_json(OLD)) old_vals
                    JOIN json_each_text(row_to_json(NEW)) new_vals ON old_vals.key = new_vals.key
                WHERE
                    old_vals.key LIKE '%Id'
                    AND old_vals.value IS NOT NULL
                    AND new_vals.value IS NULL) THEN
            -- this is an automated update, set to system, all the other values are the old values
            v_userId := NULL;
            v_apiAccessTokenId := NULL;
            v_actionRunId := NULL;
            v_other := 'system';
        ELSE
            -- this is a missing lastModifiedBy, throw error
            RAISE EXCEPTION 'lastModifiedBy must be explicitly set in UPDATE';
        END IF;
    END IF;
        EXECUTE vc_insert_sql
        USING 'update'::"OperationType", row_to_json(OLD), row_to_json(NEW), NEW."id", v_userId, v_apiAccessTokenId, v_actionRunId, v_other;
    END IF;
        RETURN NULL;
END;
$$
LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION update_pub_for_value_changes()
    RETURNS TRIGGER
    AS $$
BEGIN
    CREATE TEMP TABLE IF NOT EXISTS tmp_affected_pubs(
        "pubId" text PRIMARY KEY,
        "value" text
    ) ON COMMIT DROP;
    WITH tf AS (
        SELECT DISTINCT ON (inserted_updated_deleted_rows."pubId")
            inserted_updated_deleted_rows."pubId",
            inserted_updated_deleted_rows."value",
            CASE WHEN inserted_updated_deleted_rows."value" IS NULL THEN
                TRUE
            ELSE
                FALSE
            END AS is_null_value
        FROM
            inserted_updated_deleted_rows
            JOIN "pubs" p ON inserted_updated_deleted_rows."pubId" = p."id"
            JOIN "_PubFieldToPubType" pft ON pft."A" = inserted_updated_deleted_rows."fieldId"
                AND pft."B" = p."pubTypeId"
                AND pft."isTitle" = TRUE
    )
    INSERT INTO tmp_affected_pubs("pubId", "value")
    SELECT DISTINCT
        "pubId",
        CASE WHEN is_null_value THEN
            NULL
        ELSE
            ("value" #>> '{}')
        END
    FROM tf
    -- this is to handle edge cases which mostly happen during "UPDATE"s in transactions
    ON CONFLICT("pubId")
        DO UPDATE SET
            "value" = CASE WHEN EXCLUDED."value" IS NULL THEN
                NULL
            ELSE
                EXCLUDED."value"
            END;


    -- this is to handle 
    -- - the actual update of the title
    -- - the actual update of the searchVector
    -- - to ensure that the updatedAt is updated
    -- we first do this CTE to get the new title, bc we want to use it in the searchVector as well
    WITH updates AS (
        SELECT 
            affected."pubId",
            CASE 
                WHEN tmp."pubId" IS NULL THEN pubs."title"
                WHEN TG_OP = 'DELETE' OR tmp."value" IS NULL THEN NULL
                ELSE tmp."value"
            END AS new_title
        FROM (
            SELECT DISTINCT "pubId"
            FROM inserted_updated_deleted_rows
        ) AS affected
        LEFT JOIN tmp_affected_pubs tmp ON tmp."pubId" = affected."pubId"
        JOIN pubs ON pubs.id = affected."pubId"
    )
    UPDATE "pubs"
    SET
        "updatedAt" = CURRENT_TIMESTAMP,
        "title" = updates.new_title,
        -- we weight the searchVector based on the title and its values
        "searchVector" = (
            SELECT 
                generate_pub_search_vector(updates.new_title, updates."pubId")
        )
    FROM updates
    WHERE "pubs"."id" = updates."pubId";

    RETURN NULL;
END;
$$
LANGUAGE plpgsql;


CREATE TRIGGER trigger_pub_values_insert_pub
    AFTER INSERT ON "pub_values" REFERENCING NEW TABLE AS inserted_updated_deleted_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION update_pub_for_value_changes();

CREATE TRIGGER trigger_pub_values_delete_pub
    AFTER DELETE ON "pub_values" REFERENCING OLD TABLE AS inserted_updated_deleted_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION update_pub_for_value_changes();

CREATE TRIGGER trigger_pub_values_history
  AFTER INSERT OR UPDATE ON pub_values
  FOR EACH ROW
  EXECUTE FUNCTION f_generic_history('pubValueId');


-- Table: unknown

CREATE OR REPLACE FUNCTION notify_change_automation_runs()
    RETURNS TRIGGER
    AS $$
DECLARE
    correct_row jsonb;
    community_id text;
BEGIN
    -- -- Changed the first part of this conditional to return early if the operation is deleting a pub
    -- IF (NEW."pubId" IS NULL) THEN
    --     RETURN NEW;
    -- ELSE
    --     correct_row = to_jsonb(NEW);
    -- END IF;
    SELECT
        INTO community_id "automations"."communityId"
    FROM
        "automation_runs"
        INNER JOIN "automations" ON "automation_runs"."automationId" = "automations"."id"
    WHERE
        "automation_runs"."id" = NEW."id";
    PERFORM
        notify_change(correct_row, community_id, TG_TABLE_NAME, TG_OP);
    RETURN NEW;
END;
$$
LANGUAGE plpgsql;


CREATE OR REPLACE TRIGGER automation_runs_change_trigger
    AFTER INSERT OR UPDATE -- Removed delete
    ON automation_runs
    FOR EACH ROW
    EXECUTE FUNCTION notify_change_automation_runs();


-- Standalone functions

CREATE OR REPLACE FUNCTION build_automation_run_stack(run_id text)
  RETURNS text[]
  AS $$
DECLARE
  path text[];
  current_run_id text := run_id;
  source_run_id text;
BEGIN
  -- recursively build stack by following sourceAutomationRunId backwards
  -- returns array of ancestor run IDs (not including the current run)
  WITH RECURSIVE automation_run_stack AS (
    -- base case: start with the immediate source if it exists
    SELECT
      source_ar.id,
      source_ar."sourceAutomationRunId",
      ARRAY[source_ar.id] AS "path",
      0 AS "depth"
    FROM
      automation_runs ar
      INNER JOIN automation_runs source_ar ON source_ar.id = ar."sourceAutomationRunId"
    WHERE
      ar.id = run_id
      -- recursive case: walk backwards through the chain
    UNION ALL
    SELECT
      ar.id,
      ar."sourceAutomationRunId",
      ARRAY[ar.id] || "automation_run_stack"."path" AS "path",
      "automation_run_stack"."depth" + 1 AS "depth"
    FROM
      automation_runs ar
      INNER JOIN automation_run_stack ON ar."id" = "automation_run_stack"."sourceAutomationRunId"
    WHERE
      "automation_run_stack"."depth" < 20
      AND NOT ar."id" = ANY ("automation_run_stack"."path"))
  SELECT
    automation_run_stack."path" INTO path
  FROM
    automation_run_stack
  ORDER BY
    automation_run_stack."depth" DESC
  LIMIT 1;
  -- if no path found, return empty array
  IF path IS NULL THEN
    path := ARRAY[]::text[];
  END IF;
  RETURN path;
END;
$$
LANGUAGE plpgsql
STABLE;


CREATE OR REPLACE FUNCTION check_invite_has_pub_or_stage(type "MembershipType", invite_id TEXT) 
RETURNS BOOLEAN AS $$
BEGIN
  RETURN CASE 
    WHEN "type" = 'pub'::"MembershipType" THEN EXISTS (
      SELECT 1 FROM "invites" 
      WHERE "invites"."id" = invite_id 
      AND "invites"."pubId" IS NOT NULL
    )
    WHEN "type" = 'stage'::"MembershipType" THEN EXISTS (
      SELECT 1 FROM "invites" 
      WHERE "invites"."id" = invite_id 
      AND "invites"."stageId" IS NOT NULL
    )
    ELSE TRUE
  END;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION emit_event()
    RETURNS TRIGGER AS 
$$
DECLARE
    community RECORD;
BEGIN
    -- Determine the community from the Pubs or Stages table
    IF TG_OP = 'INSERT' THEN
        SELECT c.id, c.slug INTO community
        FROM pubs p
        JOIN communities c ON p."communityId" = c.id
        WHERE p.id = NEW."pubId";
    ELSIF TG_OP = 'DELETE' THEN
        SELECT c.id, c.slug INTO community
        FROM pubs p
        JOIN communities c ON p."communityId" = c.id
        WHERE p.id = OLD."pubId";
    END IF;

    PERFORM
        graphile_worker.add_job(
            'emitEvent',
            json_build_object(
                'table', TG_TABLE_NAME,
                'operation', TG_OP,
                'new', NEW,
                'old', OLD,
                'community', community
            )
        );
    RETURN NEW;
END;
$$
LANGUAGE plpgsql
VOLATILE;


CREATE OR REPLACE FUNCTION generate_pub_search_vector(new_title text, pub_id text)
RETURNS tsvector AS $$
BEGIN
    RETURN setweight(to_tsvector('english', COALESCE(new_title, '')), 'A') ||
           setweight(to_tsvector('english', COALESCE(
               get_pub_values_text(pub_id),
               ''
           )), 'B');
END;
$$ LANGUAGE plpgsql STABLE;


CREATE OR REPLACE FUNCTION get_pub_values_text(pub_id text)
RETURNS text AS $$
    SELECT string_agg(
        CASE 
            -- When the field is RichText, strip HTML tags
            WHEN pf."schemaName" = 'RichText'::"CoreSchemaType" THEN 
                strip_html_tags(CAST(pv.value #>> '{}' AS TEXT))
            -- For all other fields, just get the raw value
            ELSE 
                CAST(pv.value #>> '{}' AS TEXT)
        END,
        ' '
    )
    FROM pub_values pv
    JOIN pub_fields pf ON pv."fieldId" = pf.id
    WHERE pv."pubId" = pub_id;
$$ LANGUAGE sql STABLE;


CREATE OR REPLACE FUNCTION migrate_action_instance_pubfields(config_json jsonb)
    RETURNS jsonb
    AS $$
DECLARE
    new_config jsonb;
    pub_fields jsonb;
    key text;
    field_array jsonb;
    field_slug text;
    full_field_slug text;
    current_value jsonb;
    fallback_str text;
    interpolation text;
BEGIN
    new_config := config_json;
    pub_fields := config_json -> 'pubFields';
    IF pub_fields IS NULL OR pub_fields = '{}'::jsonb THEN
        RETURN config_json;
    END IF;
    FOR key,
    field_array IN
    SELECT
        *
    FROM
        jsonb_each(pub_fields)
        LOOP
            -- skip if the value is not an array or is an empty array: means it's not set
            IF jsonb_typeof(field_array) != 'array' OR jsonb_array_length(field_array) = 0 THEN
                CONTINUE;
            END IF;
            -- we're not going to honor multiple pubfields
            full_field_slug := field_array ->> 0;
            field_slug := split_part(full_field_slug, ':', 2);
            -- get the current value for this key in config (this becomes the fallback)
            current_value := config_json -> key;
            IF current_value IS NOT NULL AND current_value != '""'::jsonb THEN
                fallback_str := current_value::text;
                -- we use ?? rather than :?, bc it's somewhat likely empty strings are set as values, but we don't want to use those
                interpolation := '<<<$.pub.values.' || field_slug || ' ?? ' || fallback_str || '>>>';
            ELSE
                interpolation := '<<<$.pub.values.' || field_slug || '>>>';
            END IF;
            new_config := jsonb_set(new_config, ARRAY[key], to_jsonb(interpolation));
        END LOOP;
    -- remove pubFields from the config
    new_config := new_config - 'pubFields';
    RETURN new_config;
END;
$$
LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION notify_change(
    correct_row jsonb,
    community_id text,
    table_name text,
    operation text
)
    RETURNS void AS
$$
DECLARE
    channel_name text;
BEGIN
    -- Changed to concat to avoid errors if commmunity_id or table_name are null
    channel_name = CONCAT('change', '_', community_id, '_', table_name);

    -- construct the notification payload
    PERFORM pg_notify(
        channel_name,
        json_build_object(
            'table', table_name,
            'operation', operation,
            'row', correct_row
        )::text
    );
END;
$$
LANGUAGE plpgsql;


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


CREATE OR REPLACE FUNCTION notify_change_generic()
    RETURNS TRIGGER AS 
$$
DECLARE
    correct_row jsonb;
    community_id text;
    channel_name text;
BEGIN
    -- check if tg_argv[0] and tg_argv[1] are defined
    IF (TG_OP = 'UPDATE') THEN
            correct_row = to_jsonb(NEW);
            community_id = NEW."communityId";
    ELSIF (TG_OP = 'INSERT') THEN
            correct_row = to_jsonb(NEW);
            community_id = NEW."communityId";
    ELSIF (TG_OP = 'DELETE') THEN
            correct_row = to_jsonb(OLD);
            community_id = OLD."communityId";
    END IF;

    -- construct the notification payload
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


CREATE OR REPLACE FUNCTION strip_html_tags(text_with_tags text)
RETURNS text AS $$
BEGIN
    RETURN regexp_replace(
        regexp_replace(
            regexp_replace(
                text_with_tags,
                '<[^>]+>', -- removes HTML tags
                ' ',
                'gi'
            ),
            '&[^;]+;', -- removes HTML entities
            ' ',
            'gi'
        ),
        '\s+', -- collapse multiple spaces
        ' ',
        'g'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

