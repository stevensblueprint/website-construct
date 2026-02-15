type APIGatewayProxyEvent = {
  body: string | null;
  path: string;
};

type APIGatewayProxyResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

const AWS = require("aws-sdk");

type SlotDefinition = {
  slotId: number;
  bucketName: string;
  previewUrl: string;
};

type SlotLease = {
  slotId: string;
  repoPrKey: string;
  bucketName: string;
  previewUrl: string;
  lastUsedAt?: number;
  leaseExpiresAt?: number;
  commitSha?: string;
};

const ddb = new AWS.DynamoDB.DocumentClient();
const tableName = process.env.TABLE_NAME ?? "";
const slotDefinitions: SlotDefinition[] = JSON.parse(
  process.env.SLOT_DEFINITIONS ?? "[]",
);
const maxLeaseMs = Number(process.env.MAX_LEASE_MS ?? "86400000");

const ok = (body: Record<string, unknown>): APIGatewayProxyResult => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const badRequest = (message: string): APIGatewayProxyResult => ({
  statusCode: 400,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ error: message }),
});

const conflict = (message: string): APIGatewayProxyResult => ({
  statusCode: 409,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ error: message }),
});

const toRepoPrKey = (repo: string, prNumber: number): string =>
  `${repo}#${prNumber}`;

const nowMs = (): number => Date.now();
const nowEpochSeconds = (): number => Math.floor(Date.now() / 1000);

const isConditionalCheckFailure = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return error.name === "ConditionalCheckFailedException";
};

const parseBody = (event: APIGatewayProxyEvent): Record<string, unknown> => {
  if (!event.body) return {};
  return JSON.parse(event.body) as Record<string, unknown>;
};

const getClaimBody = (body: Record<string, unknown>) => {
  const repo = typeof body.repo === "string" ? body.repo : "";
  const prNumber = Number(body.prNumber);
  const commitSha = typeof body.commitSha === "string" ? body.commitSha : "";
  return { repo, prNumber, commitSha };
};

const getReleaseBody = (body: Record<string, unknown>) => {
  const repo = typeof body.repo === "string" ? body.repo : "";
  const prNumber = Number(body.prNumber);
  return { repo, prNumber };
};

const queryLeaseByRepoPr = async (
  repoPrKey: string,
): Promise<SlotLease | null> => {
  const result = await ddb
    .query({
      TableName: tableName,
      IndexName: "RepoPrKeyIndex",
      KeyConditionExpression: "repoPrKey = :repoPrKey",
      ExpressionAttributeValues: {
        ":repoPrKey": repoPrKey,
      },
      Limit: 1,
    })
    .promise();

  if (!result.Items || result.Items.length === 0) {
    return null;
  }

  return result.Items[0] as SlotLease;
};

const loadSlots = async (): Promise<
  Array<SlotDefinition & { lease: SlotLease | null }>
> => {
  if (slotDefinitions.length === 0) {
    return [];
  }

  const result = await ddb
    .batchGet({
      RequestItems: {
        [tableName]: {
          Keys: slotDefinitions.map((slot) => ({
            slotId: String(slot.slotId),
          })),
        },
      },
    })
    .promise();

  const tableItems = (result.Responses?.[tableName] ?? []) as SlotLease[];
  const bySlotId = new Map<string, SlotLease>();
  tableItems.forEach((item) => bySlotId.set(item.slotId, item));

  return slotDefinitions.map((slot) => ({
    ...slot,
    lease: bySlotId.get(String(slot.slotId)) ?? null,
  }));
};

const chooseSlot = (
  slots: Array<SlotDefinition & { lease: SlotLease | null }>,
  repoPrKey: string,
  now: number,
): { slot: SlotDefinition & { lease: SlotLease | null }; expectedLastUsedAt: number | null } => {
  const existing = slots.find((slot) => slot.lease?.repoPrKey === repoPrKey);
  if (existing) {
    return {
      slot: existing,
      expectedLastUsedAt: Number(existing.lease?.lastUsedAt ?? 0),
    };
  }

  const available = slots
    .filter((slot) => !slot.lease || Number(slot.lease.leaseExpiresAt ?? 0) < now)
    .sort(
      (a, b) =>
        Number(a.lease?.lastUsedAt ?? 0) - Number(b.lease?.lastUsedAt ?? 0),
    );
  if (available.length > 0) {
    return {
      slot: available[0],
      expectedLastUsedAt: available[0].lease
        ? Number(available[0].lease.lastUsedAt ?? 0)
        : null,
    };
  }

  const lru = [...slots].sort(
    (a, b) =>
      Number(a.lease?.lastUsedAt ?? 0) - Number(b.lease?.lastUsedAt ?? 0),
  )[0];
  return {
    slot: lru,
    expectedLastUsedAt: Number(lru.lease?.lastUsedAt ?? 0),
  };
};

const claim = async (
  repo: string,
  prNumber: number,
  commitSha: string,
): Promise<APIGatewayProxyResult> => {
  if (!repo || !Number.isInteger(prNumber)) {
    return badRequest("repo and integer prNumber are required");
  }

  const repoPrKey = toRepoPrKey(repo, prNumber);
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const now = nowMs();
    const slots = await loadSlots();
    if (slots.length === 0) {
      return badRequest("No preview slots configured");
    }

    const selection = chooseSlot(slots, repoPrKey, now);
    const slot = selection.slot;

    const expressionAttributeValues: Record<string, unknown> = {
      ":repo": repo,
      ":prNumber": prNumber,
      ":repoPrKey": repoPrKey,
      ":commitSha": commitSha,
      ":now": now,
      ":expiresAt": now + maxLeaseMs,
      ":ttlEpochSeconds": nowEpochSeconds() + Math.floor(maxLeaseMs / 1000),
      ":bucketName": slot.bucketName,
      ":previewUrl": slot.previewUrl,
    };

    let conditionExpression = "attribute_not_exists(slotId)";
    if (selection.expectedLastUsedAt !== null) {
      conditionExpression =
        "lastUsedAt = :expectedLastUsedAt OR repoPrKey = :repoPrKey";
      expressionAttributeValues[":expectedLastUsedAt"] =
        selection.expectedLastUsedAt;
    }

    try {
      await ddb
        .update({
          TableName: tableName,
          Key: { slotId: String(slot.slotId) },
          UpdateExpression:
            "SET repo = :repo, prNumber = :prNumber, repoPrKey = :repoPrKey, commitSha = :commitSha, bucketName = :bucketName, previewUrl = :previewUrl, leasedAt = if_not_exists(leasedAt, :now), lastUsedAt = :now, leaseExpiresAt = :expiresAt, ttlEpochSeconds = :ttlEpochSeconds",
          ConditionExpression: conditionExpression,
          ExpressionAttributeValues: expressionAttributeValues,
        })
        .promise();

      return ok({
        slotId: slot.slotId,
        bucketName: slot.bucketName,
        previewUrl: slot.previewUrl,
      });
    } catch (error) {
      if (!isConditionalCheckFailure(error)) {
        throw error;
      }
    }
  }

  return conflict("Failed to claim preview slot due to concurrent updates");
};

const heartbeat = async (
  repo: string,
  prNumber: number,
  commitSha: string,
): Promise<APIGatewayProxyResult> => {
  if (!repo || !Number.isInteger(prNumber)) {
    return badRequest("repo and integer prNumber are required");
  }

  const repoPrKey = toRepoPrKey(repo, prNumber);
  const existing = await queryLeaseByRepoPr(repoPrKey);
  if (!existing) {
    return badRequest("No active lease found for this pull request");
  }

  const now = nowMs();
  await ddb
    .update({
      TableName: tableName,
      Key: { slotId: existing.slotId },
      UpdateExpression:
        "SET commitSha = :commitSha, lastUsedAt = :now, leaseExpiresAt = :expiresAt, ttlEpochSeconds = :ttlEpochSeconds",
      ConditionExpression: "repoPrKey = :repoPrKey",
      ExpressionAttributeValues: {
        ":repoPrKey": repoPrKey,
        ":commitSha": commitSha || existing.commitSha || "",
        ":now": now,
        ":expiresAt": now + maxLeaseMs,
        ":ttlEpochSeconds": nowEpochSeconds() + Math.floor(maxLeaseMs / 1000),
      },
    })
    .promise();

  return ok({
    slotId: existing.slotId,
    bucketName: existing.bucketName,
    previewUrl: existing.previewUrl,
  });
};

const release = async (
  repo: string,
  prNumber: number,
): Promise<APIGatewayProxyResult> => {
  if (!repo || !Number.isInteger(prNumber)) {
    return badRequest("repo and integer prNumber are required");
  }

  const repoPrKey = toRepoPrKey(repo, prNumber);
  const existing = await queryLeaseByRepoPr(repoPrKey);
  if (!existing) {
    return ok({ released: false });
  }

  await ddb
    .delete({
      TableName: tableName,
      Key: { slotId: existing.slotId },
      ConditionExpression: "repoPrKey = :repoPrKey",
      ExpressionAttributeValues: {
        ":repoPrKey": repoPrKey,
      },
    })
    .promise();

  return ok({ released: true, slotId: existing.slotId });
};

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const body = parseBody(event);
  const path = event.path ?? "";

  if (path.endsWith("/claim")) {
    const { repo, prNumber, commitSha } = getClaimBody(body);
    return claim(repo, prNumber, commitSha);
  }

  if (path.endsWith("/heartbeat")) {
    const { repo, prNumber, commitSha } = getClaimBody(body);
    return heartbeat(repo, prNumber, commitSha);
  }

  if (path.endsWith("/release")) {
    const { repo, prNumber } = getReleaseBody(body);
    return release(repo, prNumber);
  }

  return badRequest("Unsupported route");
};
