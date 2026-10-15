import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Credential } from "@opencode/schema/credential"
import { SessionUpdatePayload } from "../src/groups/session.js"

describe("session credential binding update payload", () => {
  test("accepts null to clear a binding and omission to leave it unchanged", () => {
    expect(Schema.decodeUnknownSync(SessionUpdatePayload)({ credentialID: null })).toEqual({ credentialID: null })
    expect(Schema.decodeUnknownSync(SessionUpdatePayload)({})).toEqual({})
    expect(
      Schema.decodeUnknownSync(SessionUpdatePayload)({ credentialID: Credential.ID.make("cred_example") }),
    ).toEqual({ credentialID: Credential.ID.make("cred_example") })
  })
})
