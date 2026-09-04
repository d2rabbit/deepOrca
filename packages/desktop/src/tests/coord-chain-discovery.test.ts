// Discovery pure-logic tests (the mDNS socket path needs a real LAN — the
// loopback probe confirmed multicast is unreachable on lo; these tests seal
// every automatable part: TXT record parsing and theme/version isolation).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildInviteCode,
  filterMatchingChains,
  parseInviteCode,
  parseTxtRecords,
} from "../main/coord-chain/discovery.js";

test("discovery: TXT records parse into the advertised fields", () => {
  const fields = parseTxtRecords(["wt=wt:ca12001", "cid=orca1abcd", "v=1", "port=9001"]);
  assert.equal(fields.wt, "wt:ca12001");
  assert.equal(fields.cid, "orca1abcd");
  assert.equal(fields.v, "1");
  assert.equal(fields.port, "9001");
  // Malformed entries (no '=') are ignored, not fatal.
  assert.deepEqual(parseTxtRecords(["garbage", "a=b=c"]), { a: "b=c" });
});

test("discovery: isolation filter admits only SAME theme + current version (R25)", () => {
  const same = { host: "a", port: 1, themeShort: "wt:ca12001", chainShort: "c1", version: 1 };
  const otherTheme = { host: "b", port: 2, themeShort: "wt:zzzzzzz", chainShort: "c2", version: 1 };
  const oldVersion = { host: "c", port: 3, themeShort: "wt:ca12001", chainShort: "c3", version: 0 };

  assert.deepEqual(filterMatchingChains([same, otherTheme, oldVersion], "wt:ca12001"), [same]);
  assert.deepEqual(
    filterMatchingChains([otherTheme], "wt:ca12001"),
    [],
    "cross-theme NEVER surfaces (discovery-level isolation)"
  );
});

test("discovery: invite codes round-trip with and without signature (R4 fallback)", () => {
  const plain = parseInviteCode(buildInviteCode({ host: "192.168.1.5", port: 4455, themeId: "wt:ca12001" }));
  assert.deepEqual(plain, { host: "192.168.1.5", port: 4455, themeId: "wt:ca12001" });

  const signed = buildInviteCode({ host: "10.0.0.2", port: 9000, themeId: "wt:beef1234", sig: "c2lnbmF0dXJl" });
  assert.equal(signed, "deeporca-chain://10.0.0.2:9000/wt:beef1234?sig=c2lnbmF0dXJl");
  assert.deepEqual(parseInviteCode(signed), {
    host: "10.0.0.2",
    port: 9000,
    themeId: "wt:beef1234",
    sig: "c2lnbmF0dXJl",
  });

  assert.equal(parseInviteCode("https://example.com/x"), null);
  assert.equal(parseInviteCode("deeporca-chain://host:0/"), null, "themeId is required");
});
