/*
 Warnings:

 - The values [buildJournalSite] on the enum `Action` will be removed. If these variants are still used in the database, this will fail.
 */
-- Delete buildJournalSite action instances
DELETE FROM "action_instances"
WHERE "action" = 'buildJournalSite';

DELETE FROM "action_config_defaults"
WHERE "action" = 'buildJournalSite';

-- AlterEnum
BEGIN;
CREATE TYPE "Action_new" AS ENUM(
  'log',
  'email',
  'http',
  'move',
  'googleDriveImport',
  'datacite',
  'buildSite',
  'createPub'
);
ALTER TABLE "action_instances"
  ALTER COLUMN "action" TYPE "Action_new"
  USING ("action"::text::"Action_new");
ALTER TABLE "action_config_defaults"
  ALTER COLUMN "action" TYPE "Action_new"
  USING ("action"::text::"Action_new");
ALTER TYPE "Action" RENAME TO "Action_old";
ALTER TYPE "Action_new" RENAME TO "Action";
DROP TYPE "Action_old" CASCADE;
COMMIT;

