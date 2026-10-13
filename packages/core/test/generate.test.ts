import { expect } from "bun:test"
import { LanguageModel } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { AISDK } from "@opencode/core/aisdk"
import { Generate } from "@opencode/core/generate"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { ModelResolver } from "@opencode/core/model-resolver"
import { ID, Info, Model, Ref } from "@opencode/core/model"
import { Provider } from "@opencode/core/provider"
import { Npm } from "@opencode/util/npm"
import { Cause, Effect, Exit, Layer } from "effect"
import { testEffect } from "./lib/effect"

const selected = Info.make({
  ...Info.default(Provider.ID.make("test-provider"), ID.make("gemini")),
  package: Provider.aisdk("@ai-sdk/cohere"),
})
const runtime = LanguageModel.make({ id: "gemini", provider: "test-provider", route: OpenAIChat.route })

const providers = Layer.mock(Provider.Service, {
  get: () => Effect.undefined,
})
const models = Layer.mock(Model.Service, {
  get: () => Effect.succeed(selected),
})
const integrations = Layer.mock(Integration.Service, {
  revision: () => 0,
  connection: {
    active: () => Effect.undefined,
    resolve: () => Effect.die("unused"),
    key: () => Effect.die("unused"),
    activate: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
  },
  oauth: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    complete: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
  command: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
})
const npm = Layer.mock(Npm.Service, {
  add: () => Effect.die("unused"),
  which: () => Effect.die("unused"),
})
const aisdk = Layer.mock(AISDK.Service, {
  hook: {
    sdk: () => Effect.die("unused"),
    language: () => Effect.die("unused"),
  },
  model: () => Effect.succeed(runtime),
})
const client = TestLLM.testLayer({ fallback: TestLLM.text("OK", "generate") })

const resolver = ModelResolver.layer.pipe(
  Layer.provide(Layer.mergeAll(providers, models, integrations, npm, aisdk, Layer.mock(Credential.Service, {
    get: () => Effect.undefined,
  }))),
)
const it = testEffect(Generate.layer.pipe(Layer.provide(Layer.merge(resolver, client))))
const resolverIt = testEffect(resolver)

const bindingIDs = [Credential.ID.make("cred_one"), Credential.ID.make("cred_two")]
const usedCredentials: string[] = []
let activeCredential = bindingIDs[0]!
const storedCredentials = new Map(bindingIDs.map((id) => [id, new Credential.Info({
  id, integrationID: Integration.ID.make("test-provider"), label: id,
  value: { type: "key" as const, key: "mock-only" },
})]))
const bindingCredential = Layer.mock(Credential.Service, { get: (id) => Effect.succeed(storedCredentials.get(id)) })
const bindingIntegration = Layer.mock(Integration.Service, {
  revision: () => 0,
  connection: {
    active: () => Effect.succeed({ type: "credential" as const, id: activeCredential, label: activeCredential }),
    resolve: (connection) => Effect.sync(() => {
      if (connection.type === "credential") usedCredentials.push(connection.id)
      return connection.type === "credential" && storedCredentials.has(connection.id)
        ? { type: "key" as const, key: "mock-only" }
        : undefined
    }),
    key: () => Effect.die("unused"),
    activate: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    remove: () => Effect.die("unused"),
  },
  oauth: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    complete: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
  command: {
    connect: () => Effect.die("unused"),
    status: () => Effect.die("unused"),
    cancel: () => Effect.die("unused"),
  },
})
const bindingIt = testEffect(ModelResolver.layer.pipe(
  Layer.provide(Layer.mergeAll(providers, models, bindingIntegration, bindingCredential, npm, aisdk)),
))

it.effect("loads dynamic AI SDK models", () =>
  Effect.gen(function* () {
    const generate = yield* Generate.Service
    const result = yield* generate.text({
      prompt: "Return exactly OK",
      model: Ref.make({ providerID: selected.providerID, id: selected.id }),
    })

    expect(result).toBe("OK")
  }),
)

resolverIt.effect("resolves dynamic models with their catalog metadata", () =>
  Effect.gen(function* () {
    const resolver = yield* ModelResolver.Service
    const result = yield* resolver.resolve(Ref.make({ providerID: selected.providerID, id: selected.id }))

    expect(result).toEqual({
      model: runtime,
      ref: Ref.make({ providerID: selected.providerID, id: selected.id }),
      capabilities: selected.capabilities,
      cost: selected.cost,
      limit: selected.limit,
    })
  }),
)

bindingIt.effect("uses explicit credentials for concurrent sessions despite global active changes", () =>
  Effect.gen(function* () {
    // This test uses the resolver's dependency seam: it never sends a provider request.
      const service = yield* ModelResolver.Service
      yield* Effect.all(bindingIDs.map((id) => service.resolveModel(selected, undefined, id)), { concurrency: "unbounded" })
      activeCredential = bindingIDs[1]!
      yield* service.resolveModel(selected, undefined, bindingIDs[0]!)
      expect(usedCredentials).toEqual([bindingIDs[0], bindingIDs[1], bindingIDs[0]])
      storedCredentials.delete(bindingIDs[0]!)
      const unavailable = yield* Effect.exit(service.resolveModel(selected, undefined, bindingIDs[0]!))
      expect(Exit.isFailure(unavailable)).toBe(true)
      if (Exit.isFailure(unavailable))
        expect(Cause.prettyErrors(unavailable.cause)[0]).toMatchObject({
          _tag: "ModelResolver.CredentialBindingError", reason: "credential not found",
        })
      expect(usedCredentials).toEqual([bindingIDs[0], bindingIDs[1], bindingIDs[0]])
      const other = Credential.ID.make("cred_other_provider")
      storedCredentials.set(other, new Credential.Info({
        id: other, integrationID: Integration.ID.make("unrelated-provider"), label: "other",
        value: { type: "key", key: "mock-only" },
      }))
      const mismatch = yield* Effect.exit(service.resolveModel(selected, undefined, other))
      expect(Exit.isFailure(mismatch)).toBe(true)
      if (Exit.isFailure(mismatch))
        expect(Cause.prettyErrors(mismatch.cause)[0]).toMatchObject({ reason: "credential belongs to another provider" })
      expect(usedCredentials).toEqual([bindingIDs[0], bindingIDs[1], bindingIDs[0]])
  }),
)
