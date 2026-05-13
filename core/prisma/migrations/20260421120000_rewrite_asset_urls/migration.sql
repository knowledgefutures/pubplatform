-- rewrite asset URLs from assets.app.pubpub.org to assets.pubstar.org
-- in action_runs.result (jsonb) and pub_values.value (jsonb)
--
-- pub_values has a history trigger that requires lastModifiedBy to carry
-- a fresh timestamp on every update (format: "{type}:{id}|{timestamp}").
-- run one update per table so each matching row is rewritten once.
UPDATE
    action_runs
SET
    result = replace(
        replace(
            replace(
                result::text,
                'assets.app.pubpub.org.s3.us-east-1.amazonaws.com',
                'assets.app.pubpub.org'
            ),
            's3.us-east-1.amazonaws.com/assets.app.pubpub.org',
            'assets.app.pubpub.org'
        ),
        'assets.app.pubpub.org',
        'assets.pubstar.org'
    )::jsonb
WHERE
    result::text LIKE '%assets.app.pubpub.org.s3.us-east-1.amazonaws.com%'
    OR result::text LIKE '%s3.us-east-1.amazonaws.com/assets.app.pubpub.org%'
    OR result::text LIKE '%assets.app.pubpub.org%';

UPDATE
    pub_values
SET
    value = replace(
        replace(
            replace(
                value::text,
                'assets.app.pubpub.org.s3.us-east-1.amazonaws.com',
                'assets.app.pubpub.org'
            ),
            's3.us-east-1.amazonaws.com/assets.app.pubpub.org',
            'assets.app.pubpub.org'
        ),
        'assets.app.pubpub.org',
        'assets.pubstar.org'
    )::jsonb,
    "lastModifiedBy" = 'system|' || FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::text
WHERE
    value::text LIKE '%assets.app.pubpub.org.s3.us-east-1.amazonaws.com%'
    OR value::text LIKE '%s3.us-east-1.amazonaws.com/assets.app.pubpub.org%'
    OR value::text LIKE '%assets.app.pubpub.org%';

