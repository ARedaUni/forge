export const CONNECTOR_NAME = 'tinderclone-matches'

type ConnectorStatus = {
  connector: { state: string }
  tasks: ReadonlyArray<{ state: string; trace?: string }>
}

const MATCHES_CONNECTOR_CONFIG: Readonly<Record<string, string>> = {
  'connector.class': 'io.debezium.connector.postgresql.PostgresConnector',
  'tasks.max': '1',

  // Wire format: bare JSON payload (no Connect schema envelope) so consumers
  // parse messages directly against MatchNotificationSchema. Set per-connector
  // because the Debezium image's env-var translation does not cover nested
  // converter properties.
  'key.converter': 'org.apache.kafka.connect.json.JsonConverter',
  'key.converter.schemas.enable': 'false',
  'value.converter': 'org.apache.kafka.connect.json.JsonConverter',
  'value.converter.schemas.enable': 'false',

  // Connect lives inside the docker network — reach Postgres by service name.
  'database.hostname': process.env['DEBEZIUM_PG_HOST'] ?? 'postgres',
  'database.port': process.env['DEBEZIUM_PG_PORT'] ?? '5432',
  'database.user': process.env['POSTGRES_USER'] ?? 'tinderclone',
  'database.password': process.env['POSTGRES_PASSWORD'] ?? 'tinderclone',
  'database.dbname': process.env['POSTGRES_DB'] ?? 'tinderclone',

  'table.include.list': 'public.matches',
  'topic.prefix': 'tinderclone',

  // pgoutput = Postgres' built-in logical decoder; no plugin install needed.
  'plugin.name': 'pgoutput',
  'slot.name': 'tinderclone_matches_slot',
  'publication.name': 'tinderclone_matches_pub',
  'publication.autocreate.mode': 'filtered',
  'snapshot.mode': 'never',

  // Key by user_id only so all events for one user share a partition (ordering).
  'message.key.columns': 'public.matches:user_id',

  // SMT chain: envelope → bare row → rename topic → add type → rename fields.
  transforms: 'unwrap,route,addType,renameFields',
  'transforms.unwrap.type': 'io.debezium.transforms.ExtractNewRecordState',
  'transforms.unwrap.drop.tombstones': 'true',
  'transforms.unwrap.delete.handling.mode': 'drop',
  'transforms.route.type': 'org.apache.kafka.connect.transforms.RegexRouter',
  'transforms.route.regex': 'tinderclone\\.public\\.matches',
  'transforms.route.replacement': 'notifications',
  'transforms.addType.type': 'org.apache.kafka.connect.transforms.InsertField$Value',
  'transforms.addType.static.field': 'type',
  'transforms.addType.static.value': 'match',
  'transforms.renameFields.type':
    'org.apache.kafka.connect.transforms.ReplaceField$Value',
  'transforms.renameFields.renames':
    'user_id:userId,other_user_id:otherUserId,matched_at:matchedAt',
}

export async function registerMatchesConnector(connectUrl: string): Promise<void> {
  const putUrl = `${connectUrl}/connectors/${CONNECTOR_NAME}/config`
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(MATCHES_CONNECTOR_CONFIG),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`failed to register ${CONNECTOR_NAME}: ${res.status} ${body}`)
  }

  await waitForRunning(connectUrl)
}

async function waitForRunning(connectUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const res = await fetch(`${connectUrl}/connectors/${CONNECTOR_NAME}/status`)
    if (res.ok) {
      const status = (await res.json()) as ConnectorStatus
      const taskState = status.tasks[0]?.state
      if (status.connector.state === 'FAILED' || taskState === 'FAILED') {
        const trace = status.tasks[0]?.trace ?? '(no task trace)'
        throw new Error(`${CONNECTOR_NAME} entered FAILED state: ${trace}`)
      }
      if (status.connector.state === 'RUNNING' && taskState === 'RUNNING') {
        return
      }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${CONNECTOR_NAME} did not reach RUNNING within 30s`)
}
