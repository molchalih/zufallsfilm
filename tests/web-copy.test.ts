import { expect, test } from "bun:test";
import { copyFor, OFFLINE } from "../src/web/copy";
import { errorPage } from "../src/web/errorPage";

test("a known reason wins over its status", () => {
  expect(copyFor(404, "user_not_found")).toEqual({
    code: "404",
    headline: "no such member.",
  });
  expect(copyFor(404, "watchlist_empty").headline).toBe("an empty watchlist.");
});

test("an unknown reason falls back to the status", () => {
  expect(copyFor(404, "something_new")).toEqual({ code: "404", headline: "scene missing." });
  expect(copyFor(404)).toEqual({ code: "404", headline: "scene missing." });
});

test("a proxy's own error document still gets the app's words", () => {
  // A gateway timeout from nginx is HTML, so `api.ts` reaches copyFor with a
  // status and no reason. Every status the API can produce needs a row.
  expect(copyFor(504).headline).toBe("the reel ran long.");
  expect(copyFor(429).headline).toBe("too fast. take an intermission.");
  expect(copyFor(413).headline).toBe("too many films to shuffle.");
  expect(copyFor(403).headline).toBe("this one is private.");
});

test("every reason DESIGN.md lists has words of its own", async () => {
  const design = await Bun.file("docs/DESIGN.md").text();
  // Rows of § Error reasons: a backticked reason, then its status.
  const rows = [...design.matchAll(/^\| `(\w+)` \| (\d{3}) \|/gm)];
  expect(rows.length).toBeGreaterThan(10);
  for (const [, reason, status] of rows) {
    // 599 has no BY_STATUS row, so a reason with no headline of its own would
    // fall through to the generic string.
    expect(`${reason}: ${copyFor(599, reason).headline}`).not.toBe(`${reason}: something broke.`);
    // And it reads correctly under the status the table gives it.
    expect(copyFor(Number(status), reason).code).toBe(status);
  }
});

test("the code shown is the status that came back, not the reason's own", () => {
  // A reason returned under an undocumented status must not print a number the
  // response never carried.
  expect(copyFor(500, "user_not_found")).toEqual({ code: "500", headline: "no such member." });
});

test("an unmapped status still yields renderable copy", () => {
  const c = copyFor(418);
  expect(c.code).toBe("418");
  expect(c.headline.length).toBeGreaterThan(0);
});

test("a failed fetch has no status to show", () => {
  expect(OFFLINE.code).not.toMatch(/\d/);
});

test("the error document is self-contained and scriptless", () => {
  const html = errorPage(502, "upstream_blocked");
  expect(html).toStartWith("<!DOCTYPE html>");
  expect(html).toContain("502");
  expect(html).toContain("projector failure.");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<link");
});

test("the error document escapes what it interpolates", () => {
  // No caller passes markup today; the escape is what keeps that true.
  const html = errorPage(404, '"><script>alert(1)</script>');
  expect(html).not.toContain("<script>alert(1)</script>");
});
