import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

const migration: DatabaseMigration.Migration = {
  id: "20260912000000_session_credential_binding",
  up(tx) {
    return Effect.gen(function* () {
      const columns = yield* tx.all<{ name: string }>(`PRAGMA table_info(\`session_v2\`)`)
      const names = new Set(columns.map((column) => column.name))
      if (!names.has("credential_id"))
        yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`credential_id\` text;`)
      if (!names.has("task_credential_id"))
        yield* tx.run(`ALTER TABLE \`session_v2\` ADD \`task_credential_id\` text;`)
    })
  },
}

export default migration
