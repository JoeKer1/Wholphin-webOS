const { test } = require("node:test");
const assert = require("node:assert/strict");
const C = require("../app/core.js");
test("profile holiday themes use bounded windows and reset outside them", () => {
  for (const [date, theme] of [
    ["2026-10-16", ""],
    ["2026-10-17", "harvest"],
    ["2026-11-01", "harvest"],
    ["2026-11-03", ""],
    ["2026-11-12", "harvest"],
    ["2026-11-28", "harvest"],
    ["2026-11-29", ""],
    ["2026-12-11", "snowfall"],
    ["2027-01-02", "snowfall"],
    ["2027-01-03", ""],
    ["2026-03-22", "bloom"],
    ["2026-04-07", "bloom"],
    ["2026-04-08", ""],
    ["2027-03-28", "bloom"],
  ])
    assert.equal(
      C.profileHolidayTheme(new Date(date + "T12:00:00")),
      theme,
      date,
    );
});
