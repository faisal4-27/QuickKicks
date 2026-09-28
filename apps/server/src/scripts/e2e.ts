/**
 * Headless end-to-end smoke test: drives a whole game over the real HTTP + websocket surface.
 *
 * Everything the unit tests cannot reach lives here — the gateway, the Redis fan-out, the match
 * clock, and the ordering guarantees between them. It plays a full match with three managers:
 * draft, power-up, swap, trade, full time, recap.
 *
 *   npm run e2e                 # against an already-running `npm run dev`
 *   npm run e2e -- --managers 4
 *
 * Exits non-zero on the first failed check, so it works as a CI gate.
 */
import type {
  ClientToServerEvents,
  DraftPickView,
  FixtureView,
  MatchRecap,
  RoomSnapshot,
  ServerToClientEvents,
  StandingRow,
} from '@quickkicks/shared';
import { io, type Socket } from 'socket.io-client';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Options {
  apiUrl: string;
  managers: number;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    apiUrl: process.env.E2E_API_URL ?? 'http://localhost:4000',
    managers: 3,
    // A full match at the default MATCH_MS_PER_MINUTE=2000 alone takes over three minutes.
    timeoutMs: 600_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === '--api' && next) { options.apiUrl = next; i += 1; }
    else if (arg === '--managers' && next) { options.managers = Math.max(2, Number(next) || 3); i += 1; }
    else if (arg === '--timeout' && next) { options.timeoutMs = Math.max(10_000, Number(next) || 600_000); i += 1; }
  }
  return options;
}

let passed = 0;
/** Actions the script deliberately gets refused; each refusal also pushes an action:error toast. */
const expectedRefusals: string[] = [];
const failures: string[] = [];

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function step(label: string): void {
  console.log(`\n${label}`);
}

/** One manager: an HTTP session cookie plus the socket that cookie authenticates. */
interface Manager {
  name: string;
  cookie: string;
  userId: string;
  memberId: string;
  socket: ClientSocket;
  snapshot: RoomSnapshot | null;
  feedCount: number;
  errors: string[];
}

async function api(
  options: Options,
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: any; setCookie: string | null }> {
  const response = await fetch(`${options.apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, setCookie: response.headers.get('set-cookie') };
}

/** Emits and resolves with the ack, so a rejected action fails loudly instead of hanging. */
function emit<E extends keyof ClientToServerEvents>(
  socket: ClientSocket,
  event: E,
  payload: Parameters<ClientToServerEvents[E]>[0],
): Promise<{ ok: true } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, message: `ack timeout for ${String(event)}` }), 15_000);
    (socket.emit as any)(event, payload, (result: { ok: true } | { ok: false; message: string }) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

function waitFor<T>(
  label: string,
  timeoutMs: number,
  register: (resolve: (value: T) => void) => () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    const cleanup = register((value) => {
      clearTimeout(timer);
      cleanup();
      resolve(value);
    });
  });
}

async function createManager(options: Options, name: string): Promise<Omit<Manager, 'memberId' | 'socket' | 'snapshot' | 'feedCount' | 'errors'>> {
  const created = await api(options, '/api/session', { method: 'POST', body: { displayName: name } });
  if (created.status !== 200 || !created.setCookie) {
    throw new Error(`Failed to create session for ${name}: ${created.status} ${JSON.stringify(created.body)}`);
  }
  // Keep just the name=value pair; the attributes are for a browser, not for us.
  const cookie = created.setCookie.split(';')[0]!;
  return { name, cookie, userId: created.body.user.id as string };
}

function connect(options: Options, cookie: string): Promise<ClientSocket> {
  const socket: ClientSocket = io(options.apiUrl, {
    transports: ['websocket'],
    extraHeaders: { cookie },
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 15_000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (error) => {
      clearTimeout(timer);
      reject(new Error(`socket connect_error: ${error.message}`));
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const hardStop = setTimeout(() => {
    console.error(`\nE2E exceeded ${options.timeoutMs}ms. Failing.`);
    process.exit(1);
  }, options.timeoutMs);
  hardStop.unref?.();

  console.log(`QuickKicks end-to-end smoke test`);
  console.log(`API ${options.apiUrl}, ${options.managers} managers`);

  step('Health');
  const health = await api(options, '/api/health');
  check('GET /api/health returns ok', health.status === 200 && health.body?.ok === true, JSON.stringify(health.body));

  step('Sessions');
  const names = Array.from({ length: options.managers }, (_, i) => `Tester ${i + 1}`);
  const bases = [];
  for (const name of names) bases.push(await createManager(options, name));
  check(`created ${options.managers} sessions`, bases.length === options.managers);
  check('sessions have distinct user ids', new Set(bases.map((b) => b.userId)).size === bases.length);

  step('Room');
  const fixtureList = await api(options, '/api/fixtures', { cookie: bases[0]!.cookie });
  const fixtures = (fixtureList.body?.fixtures ?? []) as FixtureView[];
  check('fixtures are listed for the host to pick from', fixtureList.status === 200 && fixtures.length > 0,
    JSON.stringify(fixtureList.body));
  const fixture = fixtures.find((f) => f.lineupsAnnounced);
  if (!fixture) throw new Error('No fixture has announced lineups. Run `npm run seed`.');

  const noFixture = await api(options, '/api/rooms', { method: 'POST', body: {}, cookie: bases[0]!.cookie });
  check('creating a room without picking a match is a 400', noFixture.status === 400, `got ${noFixture.status}`);

  const createdRoom = await api(options, '/api/rooms', {
    method: 'POST',
    body: { fixtureId: fixture.id },
    cookie: bases[0]!.cookie,
  });
  check('host creates a room', createdRoom.status === 200 && !!createdRoom.body?.roomId, JSON.stringify(createdRoom.body));
  const roomId = createdRoom.body.roomId as string;
  const joinCode = createdRoom.body.joinCode as string;
  check('join code is six characters', typeof joinCode === 'string' && joinCode.length === 6, joinCode);

  const memberIds: string[] = [createdRoom.body.memberId as string];
  for (const base of bases.slice(1)) {
    const joined = await api(options, '/api/rooms/join', { method: 'POST', body: { joinCode }, cookie: base.cookie });
    if (joined.status !== 200) throw new Error(`${base.name} could not join: ${JSON.stringify(joined.body)}`);
    memberIds.push(joined.body.memberId as string);
  }
  check('every manager joined', memberIds.length === options.managers && new Set(memberIds).size === options.managers);

  const rejoin = await api(options, '/api/rooms/join', { method: 'POST', body: { joinCode }, cookie: bases[1]!.cookie });
  check('rejoining returns the same seat', rejoin.status === 200 && rejoin.body.memberId === memberIds[1]);

  const badJoin = await api(options, '/api/rooms/join', { method: 'POST', body: { joinCode: 'ZZZZZZ' }, cookie: bases[0]!.cookie });
  check('unknown join code is a 404', badJoin.status === 404, `got ${badJoin.status}`);

  const anon = await api(options, '/api/rooms', { method: 'POST', body: { fixtureId: fixture.id } });
  check('creating a room without a session is a 401', anon.status === 401, `got ${anon.status}`);

  step('Sockets');
  const managers: Manager[] = [];
  for (const [index, base] of bases.entries()) {
    const socket = await connect(options, base.cookie);
    const manager: Manager = {
      ...base,
      memberId: memberIds[index]!,
      socket,
      snapshot: null,
      feedCount: 0,
      errors: [],
    };
    socket.on('room:snapshot', (snapshot) => { manager.snapshot = snapshot; });
    socket.on('members:update', ({ members }) => {
      if (manager.snapshot) manager.snapshot = { ...manager.snapshot, members };
    });
    socket.on('presence:update', ({ connectedMemberIds }) => {
      if (!manager.snapshot) return;
      const online = new Set(connectedMemberIds);
      const members = manager.snapshot.members.map((m) => ({ ...m, connected: online.has(m.id) }));
      manager.snapshot = { ...manager.snapshot, members };
    });
    socket.on('match:events', ({ items }) => { manager.feedCount += items.length; });
    socket.on('action:error', ({ action, message }) => { manager.errors.push(`${action}: ${message}`); });
    managers.push(manager);
  }
  check('all sockets connected', managers.every((m) => m.socket.connected));

  for (const manager of managers) {
    const ack = await emit(manager.socket, 'room:subscribe', { roomId });
    if (!ack.ok) throw new Error(`${manager.name} could not subscribe: ${ack.message}`);
  }
  await new Promise((r) => setTimeout(r, 500));
  check('every manager got a snapshot', managers.every((m) => m.snapshot !== null));

  const host = managers[0]!;
  check('snapshot starts in lobby', host.snapshot?.room.status === 'lobby', host.snapshot?.room.status);
  check('draft pool is the 22 starters', host.snapshot?.draft.availablePlayerIds.length === 22, String(host.snapshot?.draft.availablePlayerIds.length));
  check('both squads are in the snapshot', (host.snapshot?.players.length ?? 0) === 32, String(host.snapshot?.players.length));
  check('presence shows everyone connected', (host.snapshot?.members.filter((m) => m.connected).length ?? 0) === options.managers);

  const nonHostStart = await emit(managers[1]!.socket, 'room:start-draft', {});
  check('a non-host cannot start the draft', !nonHostStart.ok, JSON.stringify(nonHostStart));
  expectedRefusals.push('room:start-draft');

  step('Draft');
  // Each manager answers its own turn; the room drives the order.
  const totalPicks = options.managers * (host.snapshot?.draft.rounds ?? 2);
  const picks: DraftPickView[] = [];
  let available: string[] = [...(host.snapshot?.draft.availablePlayerIds ?? [])];

  for (const manager of managers) {
    manager.socket.on('draft:pick-made', ({ pick, availablePlayerIds }) => {
      available = availablePlayerIds;
      if (manager === host) picks.push(pick);
    });
  }

  const draftDone = waitFor<DraftPickView[]>('draft:complete', 90_000, (resolve) => {
    const handler = ({ picks: finalPicks }: { picks: DraftPickView[] }) => resolve(finalPicks);
    host.socket.on('draft:complete', handler);
    return () => host.socket.off('draft:complete', handler);
  });

  for (const manager of managers) {
    manager.socket.on('draft:turn', (turn) => {
      if (turn.memberId !== manager.memberId) return;
      // Pick promptly so the autopick timer never fires.
      const choice = available[0];
      if (!choice) return;
      void emit(manager.socket, 'draft:pick', { playerId: choice });
    });
  }

  const startAck = await emit(host.socket, 'room:start-draft', {});
  check('host starts the draft', startAck.ok, JSON.stringify(startAck));

  const finalPicks = await draftDone;
  check(`draft completed with ${totalPicks} picks`, finalPicks.length === totalPicks, String(finalPicks.length));
  check('no player was drafted twice', new Set(finalPicks.map((p) => p.playerId)).size === finalPicks.length);
  check('pick numbers are 1..n with no gaps',
    finalPicks.map((p) => p.pickNumber).sort((a, b) => a - b).every((n, i) => n === i + 1));

  const snakeRounds = finalPicks.filter((p) => p.round === 1).map((p) => p.memberId);
  const snakeRound2 = finalPicks.filter((p) => p.round === 2).map((p) => p.memberId);
  check('round 2 reverses round 1 (snake order)',
    JSON.stringify(snakeRound2) === JSON.stringify([...snakeRounds].reverse()),
    `r1=${snakeRounds.length} r2=${snakeRound2.length}`);

  step('Kick off');
  const liveTick = await waitFor<{ minute: number }>('first match:tick', 30_000, (resolve) => {
    const handler = (match: { minute: number }) => { if (match.minute >= 1) resolve(match); };
    host.socket.on('match:tick', handler);
    return () => host.socket.off('match:tick', handler);
  });
  check('match clock started', liveTick.minute >= 1, `minute ${liveTick.minute}`);

  // Refresh snapshots now that rosters exist.
  for (const manager of managers) {
    const fresh = await api(options, `/api/rooms/${roomId}`, { cookie: manager.cookie });
    manager.snapshot = fresh.body as RoomSnapshot;
  }
  check('every manager holds two players',
    managers.every((m) => (m.snapshot?.members.find((x) => x.id === m.memberId)?.roster.length ?? 0) === 2));

  step('Power-ups');
  const hostRoster = host.snapshot?.members.find((m) => m.id === host.memberId)?.roster ?? [];
  const [first, second] = hostRoster.map((r) => r.playerId);
  const someoneElses = managers[1]!.snapshot?.members
    .find((m) => m.id === managers[1]!.memberId)?.roster[0]?.playerId;
  if (!first || !second || !someoneElses) throw new Error('rosters are not ready for power-ups');

  const puFirst = await emit(host.socket, 'powerup:activate', { kind: 'double_goals', playerId: first });
  check('host powers up their first player', puFirst.ok, JSON.stringify(puFirst));

  const puReuse = await emit(host.socket, 'powerup:activate', { kind: 'double_goals', playerId: second });
  check('the same power-up cannot be used twice', !puReuse.ok, JSON.stringify(puReuse));
  expectedRefusals.push('powerup:activate');

  const puStack = await emit(host.socket, 'powerup:activate', { kind: 'double_passes', playerId: first });
  check('one player cannot carry two power-ups at once', !puStack.ok, JSON.stringify(puStack));
  expectedRefusals.push('powerup:activate');

  const puSecond = await emit(host.socket, 'powerup:activate', { kind: 'double_passes', playerId: second });
  check('both players can be powered up at the same time', puSecond.ok, JSON.stringify(puSecond));

  const puForeign = await emit(host.socket, 'powerup:activate', { kind: 'double_all', playerId: someoneElses });
  check("cannot power up another manager's player", !puForeign.ok, JSON.stringify(puForeign));
  expectedRefusals.push('powerup:activate');

  const boosted = await api(options, `/api/rooms/${roomId}`, { cookie: host.cookie });
  const hostPowerUps = (boosted.body as RoomSnapshot).members.find((m) => m.id === host.memberId)?.powerUps ?? [];
  check('snapshot shows each power-up on its own player',
    hostPowerUps.filter((p) => p.active).map((p) => p.playerId).sort().join() === [first, second].sort().join(),
    JSON.stringify(hostPowerUps));

  // The third power-up needs a free player, so wait for the first boost to run out.
  const firstExpiry = hostPowerUps.find((p) => p.playerId === first)?.expiresAtMinute ?? 0;
  const msPerMinute = host.snapshot?.room.msPerMatchMinute ?? 2000;
  await waitFor<void>('first power-up to expire', (firstExpiry + 2) * msPerMinute + 10_000, (resolve) => {
    const handler = ({ minute }: { minute: number }) => { if (minute >= firstExpiry) resolve(); };
    host.socket.on('match:tick', handler);
    return () => host.socket.off('match:tick', handler);
  });
  const puThird = await emit(host.socket, 'powerup:activate', { kind: 'double_all', playerId: first });
  check('the third power-up can go on a player once their boost has ended', puThird.ok, JSON.stringify(puThird));

  step('Swap');
  const swapper = managers[1]!;
  const myRoster = swapper.snapshot?.members.find((m) => m.id === swapper.memberId)?.roster ?? [];
  const outPlayer = myRoster[0]?.playerId;
  const freeAgent = available.find((id) => !myRoster.some((r) => r.playerId === id));
  check('there is a free agent to swap for', !!outPlayer && !!freeAgent);
  if (outPlayer && freeAgent) {
    const swapAck = await emit(swapper.socket, 'swap:execute', { outPlayerId: outPlayer, inPlayerId: freeAgent });
    check('manager swaps a player', swapAck.ok, JSON.stringify(swapAck));
    const swapAgain = await emit(swapper.socket, 'swap:execute', { outPlayerId: freeAgent, inPlayerId: outPlayer });
    check('a second swap is refused (one per manager)', !swapAgain.ok, JSON.stringify(swapAgain));
    expectedRefusals.push('swap:execute');
  }

  step('Trade');
  const proposer = managers[0]!;
  const receiver = managers[2] ?? managers[1]!;
  const proposerRoster = proposer.snapshot?.members.find((m) => m.id === proposer.memberId)?.roster ?? [];
  const receiverFresh = await api(options, `/api/rooms/${roomId}`, { cookie: receiver.cookie });
  receiver.snapshot = receiverFresh.body as RoomSnapshot;
  const receiverRoster = receiver.snapshot?.members.find((m) => m.id === receiver.memberId)?.roster ?? [];

  const offered = proposerRoster[0]?.playerId;
  const requested = receiverRoster[0]?.playerId;
  check('both sides have a player to trade', !!offered && !!requested);

  if (offered && requested) {
    const tradeProposed = waitFor<{ trade: { id: string } }>('trade:proposed', 20_000, (resolve) => {
      const handler = (payload: { trade: { id: string } }) => resolve(payload);
      receiver.socket.on('trade:proposed', handler as any);
      return () => receiver.socket.off('trade:proposed', handler as any);
    });
    const proposeAck = await emit(proposer.socket, 'trade:propose', {
      toMemberId: receiver.memberId,
      offeredPlayerId: offered,
      requestedPlayerId: requested,
    });
    check('trade offer sent', proposeAck.ok, JSON.stringify(proposeAck));

    if (proposeAck.ok) {
      const { trade } = await tradeProposed;
      check('receiver was notified of the offer', !!trade.id);

      const wrongResponder = await emit(proposer.socket, 'trade:respond', { tradeId: trade.id, accept: true });
      check('only the receiver can accept an offer', !wrongResponder.ok, JSON.stringify(wrongResponder));
      expectedRefusals.push('trade:respond');

      const acceptAck = await emit(receiver.socket, 'trade:respond', { tradeId: trade.id, accept: true });
      check('receiver accepts the trade', acceptAck.ok, JSON.stringify(acceptAck));

      await new Promise((r) => setTimeout(r, 800));
      const afterTrade = await api(options, `/api/rooms/${roomId}`, { cookie: proposer.cookie });
      const snap = afterTrade.body as RoomSnapshot;
      const proposerNow = snap.members.find((m) => m.id === proposer.memberId)?.roster.map((r) => r.playerId) ?? [];
      const receiverNow = snap.members.find((m) => m.id === receiver.memberId)?.roster.map((r) => r.playerId) ?? [];
      check('traded player moved to the proposer', proposerNow.includes(requested), proposerNow.join(','));
      check('offered player moved to the receiver', receiverNow.includes(offered), receiverNow.join(','));
      check('rosters are still two players each',
        proposerNow.length === 2 && receiverNow.length === 2, `${proposerNow.length}/${receiverNow.length}`);
    }
  }

  step('Full time');
  // 90' plus half time and stoppage, at whatever speed this server runs the clock.
  const fullTimeMs = 100 * (host.snapshot?.room.msPerMatchMinute ?? 2000) + 30_000;
  const recap = await waitFor<MatchRecap>('match:finished', fullTimeMs, (resolve) => {
    const handler = ({ recap: r }: { recap: MatchRecap }) => resolve(r);
    host.socket.on('match:finished', handler);
    return () => host.socket.off('match:finished', handler);
  });
  check('match finished and produced a recap', !!recap);

  let finalStandings: StandingRow[] = [];
  const standingsHandler = ({ standings }: { standings: StandingRow[] }) => { finalStandings = standings; };
  host.socket.on('score:update', standingsHandler);
  await new Promise((r) => setTimeout(r, 500));

  const finalSnapshot = (await api(options, `/api/rooms/${roomId}`, { cookie: host.cookie })).body as RoomSnapshot;
  check('room status is finished', finalSnapshot.room.status === 'finished', finalSnapshot.room.status);
  check('clock reached full time', finalSnapshot.match.minute >= 90, String(finalSnapshot.match.minute));
  check('events were fed to clients', managers.every((m) => m.feedCount > 0),
    managers.map((m) => m.feedCount).join(','));

  const recapApi = await api(options, `/api/rooms/${roomId}/recap`, { cookie: host.cookie });
  check('recap endpoint responds', recapApi.status === 200 && !!recapApi.body?.recap);

  const standings = finalStandings.length > 0 ? finalStandings : [];
  const ledgerTotal = finalSnapshot.members.reduce((sum, m) => sum + m.points, 0);
  check('somebody scored points', ledgerTotal !== 0, String(ledgerTotal));

  if (standings.length > 0) {
    const ranks = standings.map((s) => s.rank);
    check('standings are ranked from 1', Math.min(...ranks) === 1);
    const sorted = [...standings].sort((a, b) => a.rank - b.rank);
    check('standings are ordered by points',
      sorted.every((row, i) => i === 0 || sorted[i - 1]!.points >= row.points));
  }

  // The leaderboard and the member list are written by different code paths; if they disagree
  // the UI shows two different numbers for the same manager.
  const memberPoints = new Map(finalSnapshot.members.map((m) => [m.id, m.points]));
  check('leaderboard agrees with member totals',
    standings.every((row) => Math.abs((memberPoints.get(row.memberId) ?? 0) - row.points) < 0.011),
    standings.map((r) => `${r.displayName}:${r.points}/${memberPoints.get(r.memberId)}`).join(' '));

  // Each deliberate refusal accounts for exactly one toast; anything left over is unexpected.
  const pending = [...expectedRefusals];
  const unexpected = managers.flatMap((m) => m.errors).filter((error) => {
    const i = pending.indexOf(error.split(':').slice(0, 2).join(':'));
    if (i === -1) return true;
    pending.splice(i, 1);
    return false;
  });
  check('no unexpected action:error pushed to clients', unexpected.length === 0, unexpected.join(' | '));

  step('Result');
  console.log(`\nFinal score: ${finalSnapshot.fixture.homeTeam.shortName} ${finalSnapshot.match.homeGoals} - ${finalSnapshot.match.awayGoals} ${finalSnapshot.fixture.awayTeam.shortName}`);
  for (const row of [...finalSnapshot.members].sort((a, b) => b.points - a.points)) {
    console.log(`  ${row.displayName.padEnd(12)} ${String(row.points).padStart(7)}`);
  }

  for (const manager of managers) manager.socket.disconnect();
  clearTimeout(hardStop);

  console.log(`\n${passed} checks passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log('Failed:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log('End-to-end run is green.');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('\nE2E aborted:', error);
  process.exit(1);
});
