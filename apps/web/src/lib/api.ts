import type { MatchRecap, RoomSnapshot, SessionUser } from '@quickkicks/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function getSession(): Promise<{ user: SessionUser }> {
  return request('/api/session');
}

export function setName(displayName: string): Promise<{ user: SessionUser }> {
  return request('/api/session', { method: 'POST', body: JSON.stringify({ displayName }) });
}

export function clearSession(): Promise<{ ok: true }> {
  return request('/api/session', { method: 'DELETE' });
}

export interface CreateRoomOptions {
  rounds?: number;
  pickTimerSeconds?: number;
  maxManagers?: number;
}

export function createRoom(
  options: CreateRoomOptions = {},
): Promise<{ roomId: string; joinCode: string; memberId: string }> {
  return request('/api/rooms', { method: 'POST', body: JSON.stringify(options) });
}

export function joinRoom(
  joinCode: string,
): Promise<{ roomId: string; memberId: string; joinCode: string }> {
  return request('/api/rooms/join', { method: 'POST', body: JSON.stringify({ joinCode }) });
}

export type RoomPayload = RoomSnapshot & { myMemberId?: string | null };

export function fetchRoom(roomId: string): Promise<RoomPayload> {
  return request(`/api/rooms/${roomId}`);
}

export function fetchRecap(roomId: string): Promise<{ recap: MatchRecap }> {
  return request(`/api/rooms/${roomId}/recap`);
}

const MEMBER_KEY = 'qk:member';

export function rememberMember(roomId: string, memberId: string): void {
  sessionStorage.setItem(`${MEMBER_KEY}:${roomId}`, memberId);
}

export function rememberedMember(roomId: string): string | null {
  return sessionStorage.getItem(`${MEMBER_KEY}:${roomId}`);
}
