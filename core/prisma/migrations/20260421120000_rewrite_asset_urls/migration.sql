-- rewrite asset URLs from assets.app.pubpub.org to assets.pubstar.org
-- in action_runs.result (jsonb) and pub_values.value (jsonb)
--
-- pub_values has a history trigger that requires lastModifiedBy to carry
-- a fresh timestamp on every update (format: "{type}:{id}|{timestamp}")
-- normalize s3 virtual-hosted style URLs first
-- assets.app.pubpub.org.s3.us-east-1.amazonaws.com -> assets.app.pubpub.org
UPDATE
    action_runs
SET
    result = replace(result::text, 'assets.app.pubpub.org.s3.us-east-1.amazonaws.com', 'assets.app.pubpub.org')::jsonb
WHERE
    result::text LIKE '%assets.app.pubpub.org.s3.us-east-1.amazonaws.com%';

UPDATE
    pub_values
SET
    value = replace(value::text, 'assets.app.pubpub.org.s3.us-east-1.amazonaws.com', 'assets.app.pubpub.org')::jsonb,
    "lastModifiedBy" = 'system|' || FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::text
WHERE
    value::text LIKE '%assets.app.pubpub.org.s3.us-east-1.amazonaws.com%';

-- normalize s3 path-style URLs
-- s3.us-east-1.amazonaws.com/assets.app.pubpub.org -> assets.app.pubpub.org
UPDATE
    action_runs
SET
    result = replace(result::text, 's3.us-east-1.amazonaws.com/assets.app.pubpub.org', 'assets.app.pubpub.org')::jsonb
WHERE
    result::text LIKE '%s3.us-east-1.amazonaws.com/assets.app.pubpub.org%';

UPDATE
    pub_values
SET
    value = replace(value::text, 's3.us-east-1.amazonaws.com/assets.app.pubpub.org', 'assets.app.pubpub.org')::jsonb,
    "lastModifiedBy" = 'system|' || FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::text
WHERE
    value::text LIKE '%s3.us-east-1.amazonaws.com/assets.app.pubpub.org%';

-- rewrite the canonical domain
UPDATE
    action_runs
SET
    result = replace(result::text, 'assets.app.pubpub.org', 'assets.pubstar.org')::jsonb
WHERE
    result::text LIKE '%assets.app.pubpub.org%';

UPDATE
    pub_values
SET
    value = replace(value::text, 'assets.app.pubpub.org', 'assets.pubstar.org')::jsonb,
    "lastModifiedBy" = 'system|' || FLOOR(EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::text
WHERE
    value::text LIKE '%assets.app.pubpub.org%';

