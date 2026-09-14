import type { ParticipantDTO } from '@vcr/shared';
import { describe, expect, it } from 'vitest';
import type { AppAction, JoinFailure } from '../src/state/actions';
import { appReducer, initialAppState, type AppState } from '../src/state/appReducer';
import { selectIsSelf, selectParticipants, selectSelf } from '../src/state/selectors';

const alex: ParticipantDTO = { id: 'p-alex', name: 'Алекс', joinedAt: 1_000 };
const maria: ParticipantDTO = { id: 'p-maria', name: 'Мария', joinedAt: 2_000 };
const boris: ParticipantDTO = { id: 'p-boris', name: 'Борис', joinedAt: 3_000 };

function reduce(state: AppState, ...actions: AppAction[]): AppState {
  return actions.reduce(appReducer, state);
}

const joining = reduce(initialAppState, { type: 'JOIN_REQUESTED', roomId: 'room1', name: 'Алекс' });
const joined = reduce(joining, {
  type: 'JOIN_SUCCEEDED',
  self: alex,
  participants: [maria, alex],
});

describe('appReducer', () => {
  describe('initial state', () => {
    it('is idle without a name, room or participants', () => {
      expect(initialAppState).toEqual({
        displayName: null,
        roomId: null,
        phase: { kind: 'idle' },
        selfId: null,
        participantIds: [],
        participantsById: {},
      });
    });
  });

  describe('JOIN_REQUESTED', () => {
    it('idle → joining, remembers the name and the room', () => {
      expect(joining).toEqual({
        ...initialAppState,
        displayName: 'Алекс',
        roomId: 'room1',
        phase: { kind: 'joining' },
      });
    });

    it.each<[string, AppState]>([
      ['failed', reduce(joining, { type: 'JOIN_FAILED', reason: 'ROOM_FULL' })],
      ['connection-lost', reduce(joined, { type: 'CONNECTION_LOST' })],
    ])('%s → joining («Повторить вход» / «Войти снова»)', (_label, state) => {
      const next = appReducer(state, { type: 'JOIN_REQUESTED', roomId: 'room1', name: 'Алекс' });
      expect(next.phase).toEqual({ kind: 'joining' });
      expect(next.participantIds).toEqual([]);
    });

    it.each<[string, AppState]>([
      ['joining', joining],
      ['joined', joined],
    ])('is ignored in %s (double click, already in a room)', (_label, state) => {
      expect(appReducer(state, { type: 'JOIN_REQUESTED', roomId: 'other', name: 'X' })).toBe(state);
    });
  });

  describe('JOIN_SUCCEEDED', () => {
    it('joining → joined with self and participants in server order', () => {
      expect(joined).toEqual({
        displayName: 'Алекс',
        roomId: 'room1',
        phase: { kind: 'joined' },
        selfId: alex.id,
        participantIds: [maria.id, alex.id],
        participantsById: { [maria.id]: maria, [alex.id]: alex },
      });
    });

    it('adds self if the server list does not contain it', () => {
      const next = appReducer(joining, {
        type: 'JOIN_SUCCEEDED',
        self: alex,
        participants: [maria],
      });
      expect(next.participantIds).toEqual([maria.id, alex.id]);
    });

    it('does not duplicate repeated ids', () => {
      const next = appReducer(joining, {
        type: 'JOIN_SUCCEEDED',
        self: alex,
        participants: [maria, alex, maria],
      });
      expect(next.participantIds).toEqual([maria.id, alex.id]);
    });

    it.each<[string, AppState]>([
      ['idle', initialAppState],
      ['joined', joined],
      ['failed', reduce(joining, { type: 'JOIN_FAILED', reason: 'INTERNAL' })],
    ])('is ignored in %s (stale ack)', (_label, state) => {
      expect(
        appReducer(state, { type: 'JOIN_SUCCEEDED', self: boris, participants: [boris] }),
      ).toBe(state);
    });
  });

  describe('JOIN_FAILED', () => {
    it.each<JoinFailure>(['ROOM_FULL', 'SERVER_UNAVAILABLE', 'INVALID_NAME', 'INTERNAL'])(
      'joining → failed(%s), keeps displayName and roomId',
      (reason) => {
        const next = appReducer(joining, { type: 'JOIN_FAILED', reason });
        expect(next).toEqual({
          ...initialAppState,
          displayName: 'Алекс',
          roomId: 'room1',
          phase: { kind: 'failed', reason },
        });
      },
    );

    it.each<[string, AppState]>([
      ['idle', initialAppState],
      ['joined', joined],
    ])('is ignored in %s', (_label, state) => {
      expect(appReducer(state, { type: 'JOIN_FAILED', reason: 'ROOM_FULL' })).toBe(state);
    });
  });

  describe('PARTICIPANT_JOINED', () => {
    it('appends a new participant in joined', () => {
      const next = appReducer(joined, { type: 'PARTICIPANT_JOINED', participant: boris });
      expect(next.participantIds).toEqual([maria.id, alex.id, boris.id]);
      expect(next.participantsById[boris.id]).toEqual(boris);
    });

    it('upserts a known participant without changing the order', () => {
      const renamed = { ...maria, name: 'Мария И.' };
      const next = appReducer(joined, { type: 'PARTICIPANT_JOINED', participant: renamed });
      expect(next.participantIds).toEqual([maria.id, alex.id]);
      expect(next.participantsById[maria.id]).toEqual(renamed);
    });

    it('allows duplicate names with different ids', () => {
      const twin = { ...alex, id: 'p-alex-2', joinedAt: 4_000 };
      const next = appReducer(joined, { type: 'PARTICIPANT_JOINED', participant: twin });
      expect(selectParticipants(next).map((p) => p.name)).toEqual(['Мария', 'Алекс', 'Алекс']);
    });

    it.each<[string, AppState]>([
      ['idle', initialAppState],
      ['joining', joining],
      ['failed', reduce(joining, { type: 'JOIN_FAILED', reason: 'ROOM_FULL' })],
      ['connection-lost', reduce(joined, { type: 'CONNECTION_LOST' })],
    ])('is ignored in %s', (_label, state) => {
      expect(appReducer(state, { type: 'PARTICIPANT_JOINED', participant: boris })).toBe(state);
    });
  });

  describe('PARTICIPANT_LEFT', () => {
    it('removes a participant in joined', () => {
      const next = appReducer(joined, { type: 'PARTICIPANT_LEFT', participantId: maria.id });
      expect(next.participantIds).toEqual([alex.id]);
      expect(next.participantsById).toEqual({ [alex.id]: alex });
    });

    it('is a no-op for an unknown id', () => {
      expect(appReducer(joined, { type: 'PARTICIPANT_LEFT', participantId: 'ghost' })).toBe(joined);
    });

    it.each<[string, AppState]>([
      ['idle', initialAppState],
      ['joining', joining],
    ])('is ignored in %s', (_label, state) => {
      expect(appReducer(state, { type: 'PARTICIPANT_LEFT', participantId: maria.id })).toBe(state);
    });
  });

  describe('CONNECTION_LOST', () => {
    it('joined → connection-lost, clears participants, keeps name and room', () => {
      expect(appReducer(joined, { type: 'CONNECTION_LOST' })).toEqual({
        ...initialAppState,
        displayName: 'Алекс',
        roomId: 'room1',
        phase: { kind: 'connection-lost' },
      });
    });

    it.each<[string, AppState]>([
      ['idle', initialAppState],
      ['joining', joining],
    ])('is ignored in %s', (_label, state) => {
      expect(appReducer(state, { type: 'CONNECTION_LOST' })).toBe(state);
    });
  });

  describe('LEFT_ROOM', () => {
    it.each<[string, AppState]>([
      ['joined', joined],
      ['joining', joining],
      ['failed', reduce(joining, { type: 'JOIN_FAILED', reason: 'ROOM_FULL' })],
      ['connection-lost', reduce(joined, { type: 'CONNECTION_LOST' })],
    ])('%s → idle, resets room and participants, keeps displayName', (_label, state) => {
      expect(appReducer(state, { type: 'LEFT_ROOM' })).toEqual({
        ...initialAppState,
        displayName: 'Алекс',
      });
    });

    it('is a no-op in the initial idle state', () => {
      expect(appReducer(initialAppState, { type: 'LEFT_ROOM' })).toBe(initialAppState);
    });

    it('ignores a late ack after leaving during joining', () => {
      const next = reduce(
        joining,
        { type: 'LEFT_ROOM' },
        { type: 'JOIN_SUCCEEDED', self: alex, participants: [alex] },
      );
      expect(next.phase).toEqual({ kind: 'idle' });
      expect(next.participantIds).toEqual([]);
    });
  });

  it('full cycle: create → join → others come and go → leave → join again', () => {
    const state = reduce(
      initialAppState,
      { type: 'JOIN_REQUESTED', roomId: 'room1', name: 'Алекс' },
      { type: 'JOIN_SUCCEEDED', self: alex, participants: [alex] },
      { type: 'PARTICIPANT_JOINED', participant: maria },
      { type: 'PARTICIPANT_JOINED', participant: boris },
      { type: 'PARTICIPANT_LEFT', participantId: maria.id },
      { type: 'LEFT_ROOM' },
      { type: 'JOIN_REQUESTED', roomId: 'room2', name: 'Алекс' },
    );
    expect(state).toEqual({
      ...initialAppState,
      displayName: 'Алекс',
      roomId: 'room2',
      phase: { kind: 'joining' },
    });
  });

  it('keeps state serializable', () => {
    expect(JSON.parse(JSON.stringify(joined))).toEqual(joined);
  });
});

describe('selectors', () => {
  it('selectParticipants returns participants in order', () => {
    expect(selectParticipants(joined)).toEqual([maria, alex]);
    expect(selectParticipants(initialAppState)).toEqual([]);
  });

  it('selectSelf returns the own participant or null', () => {
    expect(selectSelf(joined)).toEqual(alex);
    expect(selectSelf(initialAppState)).toBeNull();
  });

  it('selectIsSelf compares with selfId', () => {
    expect(selectIsSelf(joined, alex.id)).toBe(true);
    expect(selectIsSelf(joined, maria.id)).toBe(false);
  });
});
