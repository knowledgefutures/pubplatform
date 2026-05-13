-- generator-version: 1.0.0

-- Model member_groups comments



-- Model community_memberships comments



-- Model pub_memberships comments



-- Model stage_memberships comments



-- Model membership_capabilities comments



-- Model invites_history comments



-- Model pub_values_history comments



-- Model users comments

COMMENT ON COLUMN "users"."isProvisional" IS 'Indicates whether a user is provisional, meaning they were added through an invite and need to accept it to become a full user';


-- Model sessions comments

COMMENT ON COLUMN "sessions"."type" IS 'With what type of token is this session created? Used for determining on a page-by-page basis whether to allow a certain session to access it. For instance, a verify email token/session should not allow you to access the password reset page.';


-- Model auth_tokens comments



-- Model communities comments



-- Model pubs comments



-- Model pub_fields comments



-- Model PubFieldSchema comments

COMMENT ON COLUMN "PubFieldSchema"."schema" IS '@type(JSONSchemaType<any>, ''ajv'', true, false, true)';


-- Model pub_values comments

COMMENT ON COLUMN "pub_values"."lastModifiedBy" IS '@type(LastModifiedBy, ''../types'', true, false, true)';


-- Model pub_types comments



-- Model _PubFieldToPubType comments



-- Model stages comments



-- Model PubsInStages comments



-- Model move_constraint comments



-- Model action_instances comments

COMMENT ON COLUMN "action_instances"."config" IS '@type(BaseActionInstanceConfig, ''../types'', true, false, true)';


-- Model action_config_defaults comments



-- Model automation_runs comments



-- Model action_runs comments



-- Model automations comments

COMMENT ON COLUMN "automations"."icon" IS '@type(IconConfig, ''../types'', true, false, true)';


-- Model automation_triggers comments



-- Model automation_condition_blocks comments



-- Model automation_conditions comments



-- Model forms comments



-- Model form_elements comments



-- Model api_access_tokens comments



-- Model api_access_logs comments



-- Model api_access_permissions comments

COMMENT ON COLUMN "api_access_permissions"."constraints" IS '@type(ApiAccessPermissionConstraints, ''../types'', true, false, true)';


-- Model invites comments

COMMENT ON COLUMN "invites"."lastModifiedBy" IS '@type(LastModifiedBy, ''../types'', true, false, true)';


-- Model invite_forms comments



-- Model backup_records comments



-- Model backup_config comments



-- Enum Capabilities comments




-- Enum MemberRole comments




-- Enum MembershipType comments




-- Enum AuthTokenType comments

COMMENT ON TYPE "AuthTokenType" IS '@property generic - For most use-cases. This will just authenticate you with a regular session.
@property passwordReset - For resetting your password only
@property signup - For signing up, but also when you''re invited to a community
@property verifyEmail - For verifying your email address';


-- Enum CoreSchemaType comments




-- Enum OperationType comments




-- Enum Action comments




-- Enum ActionRunStatus comments




-- Enum AutomationEvent comments




-- Enum ConditionEvaluationTiming comments




-- Enum AutomationConditionBlockType comments




-- Enum AutomationConditionType comments




-- Enum FormAccessType comments




-- Enum StructuralFormElement comments




-- Enum ElementType comments




-- Enum InputComponent comments




-- Enum ApiAccessType comments




-- Enum ApiAccessScope comments




-- Enum InviteStatus comments

COMMENT ON TYPE "InviteStatus" IS 'Status of an invite
@property created - The invite has been created, but not yet sent
@property pending - The invite has been sent, but not yet accepted
@property accepted - The invite has been accepted, but the relevant signup step has not been completed
@property completed - The invite has been accepted, and the relevant signup step has been completed
@property rejected - The invite has been rejected
@property revoked - The invite has been revoked by the user who created it, or by a sufficient authority';


-- Enum BackupStatus comments


