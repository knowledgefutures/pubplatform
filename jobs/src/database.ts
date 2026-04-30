import type { BackupConfigTable, BackupRecordsTable } from "db/public"

import { Kysely, PostgresDialect } from "kysely"
import pg from "pg"

const int8TypeId = 20
pg.types.setTypeParser(int8TypeId, (val) => parseInt(val, 10))

export interface BackupDatabase {
	backup_config: BackupConfigTable
	backup_records: BackupRecordsTable
}

export const createBackupDatabase = (connectionString: string) => {
	const pool = new pg.Pool({
		connectionString,
		max: 2,
	})

	const db = new Kysely<BackupDatabase>({
		dialect: new PostgresDialect({ pool }),
	})

	return { db, pool }
}
