// Package root: public API contract only. The on-disk exercise record (which
// includes `solution`) is deliberately NOT exported here; it is exposed through
// the `@tutor-agent/shared/content` subpath (see content-schema.ts).
export * from './schemas';
export * from './ids';
