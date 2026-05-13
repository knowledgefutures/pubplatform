-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM(
    'pending',
    'in_progress',
    'completed',
    'failed'
);

-- CreateTable
CREATE TABLE "backup_records"(
    "id" text NOT NULL DEFAULT gen_random_uuid(),
    "filename" text NOT NULL,
    "s3Key" text NOT NULL,
    "sizeBytes" bigint,
    "status" "BackupStatus" NOT NULL DEFAULT 'pending',
    "error" text,
    "startedAt" timestamp(3),
    "completedAt" timestamp(3),
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_config"(
    "id" text NOT NULL DEFAULT gen_random_uuid(),
    "enabled" boolean NOT NULL DEFAULT FALSE,
    "intervalHours" integer NOT NULL DEFAULT 24,
    "retentionDays" integer NOT NULL DEFAULT 14,
    "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_records_createdAt_idx" ON "backup_records"("createdAt");

