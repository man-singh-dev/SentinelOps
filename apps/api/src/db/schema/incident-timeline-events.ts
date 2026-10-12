// This file is superseded by incident-timeline.ts which uses the correct
// table name, column names, and payload type from the README ER diagram.
// Kept as a forwarding re-export so any stale imports don't break immediately.
// TODO: Remove this file once all import sites have been updated to
//       import from "./incident-timeline" instead.
export * from "./incident-timeline";
