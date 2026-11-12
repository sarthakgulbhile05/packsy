import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pinnedLookup } from "@/lib/link-preview";

// Real sockets against a throwaway server on 127.0.0.1: proves Node connects to the address our
// lookup returns (and to nothing when it refuses). ".test" names never resolve in real DNS.
let server: http.Server;
let port: number;
const seen: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push(String(req.headers.host));
    res.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = (host: string, lookup: ReturnType<typeof pinnedLookup>) =>
  new Promise<string>((resolve, reject) => {
    http.get({ host, port, agent: false, lookup }, (res) => res.resume().on("end", () => resolve("connected"))).on("error", reject);
  });

describe("pinnedLookup with real sockets", () => {
  it("never opens a connection when the answer is private", async () => {
    await expect(get("rebind.test", pinnedLookup(async () => [{ address: "127.0.0.1", family: 4 }]))).rejects.toThrow(/public website/);
    expect(seen).toEqual([]);
  });

  it("connects to exactly the address it checked, keeping the original Host name", async () => {
    let calls = 0;
    const resolve = async () => (calls++, [{ address: "127.0.0.1", family: 4 }]);
    // Test-only policy that allows loopback, so we can see where the socket really went.
    await expect(get("shop.test", pinnedLookup(resolve, () => false))).resolves.toBe("connected");
    expect(seen).toEqual([`shop.test:${port}`]);
    expect(calls).toBe(1);
  });
});
